/**
 * GooglePlacesAdapter — maps Google Maps address_components to StructuredAddress.
 *
 * Anti-corruption layer: internal model does NOT depend on Google API format.
 * All Google-specific logic is encapsulated here.
 *
 * Fallback chains for international compatibility:
 * - city: locality → postal_town → administrative_area_level_3
 * - settlement: sublocality_level_1 → sublocality → neighborhood
 * - region: administrative_area_level_1
 * - district: administrative_area_level_2
 */

import type { StructuredAddress } from '../types';

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types: string[];
  // Legacy API shape
  long_name?: string;
  short_name?: string;
}

function getText(c: AddressComponent, mode: 'long' | 'short' = 'long'): string {
  if (mode === 'short') return c.shortText ?? c.short_name ?? c.longText ?? c.long_name ?? '';
  return c.longText ?? c.long_name ?? c.shortText ?? c.short_name ?? '';
}

function findByType(components: AddressComponent[], ...types: string[]): AddressComponent | undefined {
  for (const type of types) {
    const found = components.find((c) => c.types.includes(type));
    if (found) return found;
  }
  return undefined;
}

export class GooglePlacesAdapter {
  /**
   * Parse Google addressComponents into partial StructuredAddress fields.
   * Uses fallback chains for international compatibility.
   */
  static parseComponents(components: AddressComponent[]): Partial<StructuredAddress> {
    const result: Partial<StructuredAddress> = {};

    // Country
    const country = findByType(components, 'country');
    if (country) {
      result.country_code = getText(country, 'short').toUpperCase();
      result.country_name = getText(country, 'long');
    }

    // Region / state / province
    const region = findByType(components, 'administrative_area_level_1');
    if (region) result.region = getText(region, 'long');

    // District
    const district = findByType(components, 'administrative_area_level_2');
    if (district) result.district = getText(district, 'long');

    // City — fallback chain
    const city = findByType(components, 'locality', 'postal_town', 'administrative_area_level_3');
    if (city) result.city = getText(city, 'long');

    // Settlement / sublocality — fallback chain
    const settlement = findByType(components, 'sublocality_level_1', 'sublocality', 'neighborhood');
    if (settlement) result.settlement = getText(settlement, 'long');

    // Street
    const route = findByType(components, 'route');
    if (route) result.street = getText(route, 'long');

    // House / street number
    const streetNumber = findByType(components, 'street_number');
    if (streetNumber) result.house = getText(streetNumber, 'long');

    // Postal code
    const postalCode = findByType(components, 'postal_code');
    if (postalCode) result.postal_code = getText(postalCode, 'long');

    // Apartment / subpremise
    const subpremise = findByType(components, 'subpremise');
    if (subpremise) result.apartment = getText(subpremise, 'long');

    return result;
  }
}
