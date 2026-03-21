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
