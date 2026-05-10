/**
 * GrpAddressEnricher — enriches GRP-parsed address via Google Places API.
 *
 * Flow:
 * 1. Takes preliminary StructuredAddress from GrpAddressParser
 * 2. Builds search query from filled fields
 * 3. Calls Google Places AutocompleteSuggestion + Place.fetchFields
 * 4. VALIDATES match: Google applied only if street+city+house confirm same address
 * 5. Merges: Google fills gaps (postal_code, region, lat/lng), GRP fields preserved
 * 6. Sets google_place_id, lat, lng
 *
 * Anti-corruption: Google-specific logic stays here.
 */

import type { StructuredAddress } from './types';
import { GooglePlacesAdapter } from './adapters/GooglePlacesAdapter';
import { GOOGLE_PLACE_DETAIL_FIELDS, mapGooglePlaceDetails, reverseGeocodePostalCode } from './googlePlaceDetails';
import { formatFullAddress } from './utils';
export interface EnrichmentResult {
  address: StructuredAddress;
  enriched: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Normalization helpers for validated match
// ---------------------------------------------------------------------------

/** Strip common street prefixes for fuzzy comparison */
function normalizeStreet(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(ул\.\s*|улица\s+|пр\.\s*|пр-т\.\s*|проспект\s+|пер\.\s*|переулок\s+|б-р\.\s*|бульвар\s+|наб\.\s*|набережная\s+|ш\.\s*|шоссе\s+|пл\.\s*|площадь\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCity(c: string): string {
  return c
    .toLowerCase()
    .replace(/^(г\.\s*|город\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHouse(h: string): string {
  return h.toLowerCase().replace(/\s+/g, '').trim();
}

/**
 * Validate that Google candidate matches GRP-parsed address.
 * Returns true only if street+city confirm AND house does not conflict.
 */
function isValidatedMatch(
  preliminary: StructuredAddress,
  googleParsed: Partial<StructuredAddress>
): boolean {
  const grpStreet = normalizeStreet(preliminary.street || '');
  const grpCity = normalizeCity(preliminary.city || '');
  const grpHouse = normalizeHouse(preliminary.house || '');

  const gStreet = normalizeStreet(googleParsed.street || '');
  const gCity = normalizeCity(googleParsed.city || '');
  const gHouse = normalizeHouse(googleParsed.house || '');

  // If GRP has street and city, Google must confirm them
  if (grpStreet && gStreet && !gStreet.includes(grpStreet) && !grpStreet.includes(gStreet)) {
    return false;
  }
  if (grpCity && gCity && !gCity.includes(grpCity) && !grpCity.includes(gCity)) {
    return false;
  }

  // If GRP has house AND Google has a different house → reject entirely
  if (grpHouse && gHouse && grpHouse !== gHouse) {
    return false;
  }

  return true;
}

/**
 * Enrich a preliminary parsed address via Google Places.
 * Falls back to the original if Google is unavailable, returns nothing,
 * or the candidate does not match the GRP-parsed address.
 */
export async function enrichAddressViaGoogle(
  preliminary: StructuredAddress
): Promise<EnrichmentResult> {
  try {
    const gm = (window as any).google;
    if (!gm?.maps?.places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
      console.warn('[GrpAddressEnricher] Google Maps API not available');
      return { address: preliminary, enriched: false, error: 'Google Maps API not available' };
    }

    // Build query from preliminary address
    const query = formatFullAddress(preliminary);
    if (!query || query.length < 5) {
      return { address: preliminary, enriched: false, error: 'Query too short' };
    }

    // Fetch autocomplete suggestions
    const token = new gm.maps.places.AutocompleteSessionToken();
    const { suggestions } = await gm.maps.places.AutocompleteSuggestion
      .fetchAutocompleteSuggestions({
        input: query,
        sessionToken: token,
        includedRegionCodes: ['by'],
      });

    if (!suggestions?.length) {
      return { address: preliminary, enriched: false, error: 'No suggestions found' };
    }

    // Iterate through candidates until a validated match is found
    const maxCandidates = Math.min(suggestions.length, 5);
    for (let i = 0; i < maxCandidates; i++) {
      const suggestion = suggestions[i];
      if (!suggestion?.placePrediction) continue;

      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: [...GOOGLE_PLACE_DETAIL_FIELDS],
        });

        const details = mapGooglePlaceDetails(place);

        // Parse Google components via the same adapter used by manual autocomplete
        const googleParsed = GooglePlacesAdapter.parseComponents(
          details.addressComponents as any[]
        );

        // ===== VALIDATED MATCH CHECK =====
        if (!isValidatedMatch(preliminary, googleParsed)) {
          console.warn(`[GrpAddressEnricher] Candidate ${i} rejected: address mismatch`, {
            grp: { street: preliminary.street, house: preliminary.house, city: preliminary.city },
            google: { street: googleParsed.street, house: googleParsed.house, city: googleParsed.city },
          });
          continue; // Try next candidate
        }

        // ===== SAFE MERGE =====
        // GRP fields have absolute priority. Google only fills empty gaps.
        // IMPORTANT: For Minsk, Google returns city districts (Центральный, Фрунзенский)
        // as sublocality/settlement — save them to city_district instead.
        const cityForCheck = preliminary.city || googleParsed.city || '';
        const isMsk = /минск/i.test(cityForCheck.replace(/^(г\.|город)\s*/i, '').trim());

        // Filter out city-district values from settlement and district, save to city_district
        const CITY_DISTRICT_PATTERNS = [
          'центральн', 'ленинск', 'октябрьск', 'фрунзенск', 'московск',
          'первомайск', 'советск', 'заводск', 'партизанск', 'железнодорожн',
        ];
        const looksLikeCityDistrict = (v: string) =>
          /район/i.test(v) && CITY_DISTRICT_PATTERNS.some(p => v.toLowerCase().includes(p));

        // Extract city_district from settlement or district
        let extractedCityDistrict = preliminary.city_district || '';
        let mergedSettlement = preliminary.settlement || googleParsed.settlement || '';
        if (mergedSettlement && looksLikeCityDistrict(mergedSettlement)) {
          if (!extractedCityDistrict) extractedCityDistrict = mergedSettlement;
          mergedSettlement = '';
        }

        let mergedDistrict = preliminary.district || googleParsed.district || '';
        if (isMsk && mergedDistrict && looksLikeCityDistrict(mergedDistrict)) {
          if (!extractedCityDistrict) extractedCityDistrict = mergedDistrict;
          mergedDistrict = '';
        }

        const merged: StructuredAddress = {
          // GRP-priority fields — never overwritten by Google
          street: preliminary.street || googleParsed.street || '',
          house: preliminary.house || googleParsed.house || '',
          city: preliminary.city || googleParsed.city || '',
          building: preliminary.building || googleParsed.building || '',
          settlement: mergedSettlement,
          apartment: preliminary.apartment || googleParsed.apartment || '',
          city_district: extractedCityDistrict,
          // Google fills only empty meta-fields
          district: mergedDistrict,
          region: preliminary.region || googleParsed.region || '',
          postal_code: preliminary.postal_code || googleParsed.postal_code || '',
          country_code: preliminary.country_code || googleParsed.country_code || 'BY',
          country_name: preliminary.country_name || googleParsed.country_name || 'Беларусь',
          address_line_2: preliminary.address_line_2 || '',
          google_place_id: details.placeId || null,
          lat: details.lat,
          lng: details.lng,
        };

        // Postal-code fallback via reverse-geocode if Google didn't return one
        if (!merged.postal_code && merged.lat != null && merged.lng != null) {
          const pc = await reverseGeocodePostalCode(merged.lat, merged.lng);
          if (pc) merged.postal_code = pc;
        }

        return { address: merged, enriched: true };
      } catch (candidateErr) {
        console.warn(`[GrpAddressEnricher] Candidate ${i} fetch error:`, candidateErr);
        continue;
      }
    }

    // No validated candidate found
    return { address: preliminary, enriched: false, error: 'No validated Google candidate found' };
  } catch (err) {
    console.error('[GrpAddressEnricher] Error:', err);
    return {
      address: preliminary,
      enriched: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
