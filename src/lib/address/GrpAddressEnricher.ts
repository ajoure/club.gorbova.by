/**
 * GrpAddressEnricher — enriches GRP-parsed address via Google Places API.
 *
 * Flow:
 * 1. Takes preliminary StructuredAddress from GrpAddressParser
 * 2. Builds search query from filled fields
 * 3. Calls Google Places AutocompleteSuggestion + Place.fetchFields
 * 4. Merges: Google fields fill gaps, but apartment from GRP is preserved
 * 5. Sets google_place_id, lat, lng
 *
 * Anti-corruption: Google-specific logic stays here.
 */

import type { StructuredAddress } from './types';
import { GooglePlacesAdapter } from './adapters/GooglePlacesAdapter';
import { formatFullAddress } from './utils';

export interface EnrichmentResult {
  address: StructuredAddress;
  enriched: boolean;
  error?: string;
}

/**
 * Enrich a preliminary parsed address via Google Places.
 * Falls back to the original if Google is unavailable or returns nothing.
 */
export async function enrichAddressViaGoogle(
  preliminary: StructuredAddress
): Promise<EnrichmentResult> {
  try {
    const gm = (window as any).google;
    if (!gm?.maps?.places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
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

    if (!suggestions?.length || !suggestions[0]?.placePrediction) {
      return { address: preliminary, enriched: false, error: 'No suggestions found' };
    }

    // Get place details from first suggestion
    const place = suggestions[0].placePrediction.toPlace();
    await place.fetchFields({
      fields: ['addressComponents', 'formattedAddress', 'location', 'id'],
    });

    // Parse Google components
    const googleParsed = GooglePlacesAdapter.parseComponents(
      (place.addressComponents || []) as any[]
    );

    // Merge: Google fills gaps, GRP apartment is preserved
    const grpApartment = preliminary.apartment;
    
    const merged: StructuredAddress = {
      country_code: googleParsed.country_code || preliminary.country_code || 'BY',
      country_name: googleParsed.country_name || preliminary.country_name || 'Беларусь',
      region: googleParsed.region || preliminary.region,
      district: googleParsed.district || preliminary.district,
      city: googleParsed.city || preliminary.city,
      settlement: googleParsed.settlement || preliminary.settlement,
      street: googleParsed.street || preliminary.street,
      house: googleParsed.house || preliminary.house,
      building: googleParsed.building || preliminary.building,
      // Preserve apartment from GRP (Google rarely returns office/apartment info)
      apartment: grpApartment || googleParsed.apartment || '',
      postal_code: googleParsed.postal_code || preliminary.postal_code,
      address_line_2: preliminary.address_line_2 || '',
      google_place_id: place.id || null,
      lat: place.location?.lat() ?? null,
      lng: place.location?.lng() ?? null,
    };

    return { address: merged, enriched: true };
  } catch (err) {
    console.error('[GrpAddressEnricher] Error:', err);
    return {
      address: preliminary,
      enriched: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
