import { GooglePlacesAdapter } from './adapters/GooglePlacesAdapter';
import type { StructuredAddress } from './types';

export const GOOGLE_PLACE_DETAIL_FIELDS = [
  'addressComponents',
  'formattedAddress',
  'location',
  'id',
] as const;

export interface GooglePlaceDetailsResult {
  formattedAddress: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  addressComponents: google.maps.places.AddressComponent[];
  structuredAddress: Partial<StructuredAddress>;
}

export function mapGooglePlaceDetails(
  place: google.maps.places.Place,
  fallbackDescription = ''
): GooglePlaceDetailsResult {
  const addressComponents = (place.addressComponents || []) as google.maps.places.AddressComponent[];

  return {
    formattedAddress: place.formattedAddress || fallbackDescription,
    placeId: place.id || '',
    lat: place.location?.lat() ?? null,
    lng: place.location?.lng() ?? null,
    addressComponents,
    structuredAddress: GooglePlacesAdapter.parseComponents(addressComponents as any[]),
  };
}

/**
 * Reverse-geocode lat/lng to fetch postal_code when Place autocomplete didn't return one.
 * Google often omits postal_code for street-level (route) selections — this fills the gap.
 * Returns null on any failure (offline, quota, no result, no postal in components).
 */
export async function reverseGeocodePostalCode(
  lat: number | null,
  lng: number | null
): Promise<string | null> {
  if (lat == null || lng == null) return null;
  try {
    const gm = (window as any).google;
    if (!gm?.maps) return null;
    // Ensure geocoding library is loaded
    if (!gm.maps.Geocoder && gm.maps.importLibrary) {
      await gm.maps.importLibrary('geocoding');
    }
    if (!gm.maps.Geocoder) return null;
    const geocoder = new gm.maps.Geocoder();
    const { results } = await geocoder.geocode({ location: { lat, lng } });
    if (!Array.isArray(results) || results.length === 0) return null;
    for (const res of results) {
      const comp = (res.address_components || []).find((c: any) =>
        Array.isArray(c.types) && c.types.includes('postal_code')
      );
      if (comp?.long_name) return String(comp.long_name);
    }
    return null;
  } catch (err) {
    console.warn('[reverseGeocodePostalCode] failed:', err);
    return null;
  }
}

