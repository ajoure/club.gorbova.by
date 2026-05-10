/// <reference types="google.maps" />
/**
 * usePlaceAutocomplete — shared low-level hook for Google Places autocomplete.
 * Works through GooglePlacesAdapter (anti-corruption layer).
 */
import { useCallback, useRef, useState } from 'react';
import { useGoogleMapsLoader } from './useGoogleMapsLoader';
import { GOOGLE_PLACE_DETAIL_FIELDS, mapGooglePlaceDetails } from '@/lib/address/googlePlaceDetails';

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  toPlace: () => google.maps.places.Place;
}

export interface PlaceDetails {
  formattedAddress: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  addressComponents: google.maps.places.AddressComponent[];
  structuredAddress: ReturnType<typeof mapGooglePlaceDetails>['structuredAddress'];
}

interface UsePlaceAutocompleteOptions {
  countries?: string[];
  debounceMs?: number;
  minQueryLength?: number;
}

const DEFAULT_DEBOUNCE = 300;
const DEFAULT_MIN_QUERY = 3;

export function usePlaceAutocomplete(options: UsePlaceAutocompleteOptions = {}) {
  const { countries, debounceMs = DEFAULT_DEBOUNCE, minQueryLength = DEFAULT_MIN_QUERY } = options;
  const { isReady } = useGoogleMapsLoader();

  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getSessionToken = useCallback(() => {
    const gm = (window as any).google;
    if (!sessionTokenRef.current && gm?.maps?.places?.AutocompleteSessionToken) {
      sessionTokenRef.current = new gm.maps.places.AutocompleteSessionToken();
    }
    return sessionTokenRef.current;
  }, []);

  const resetSessionToken = useCallback(() => {
    const gm = (window as any).google;
    if (gm?.maps?.places?.AutocompleteSessionToken) {
      sessionTokenRef.current = new gm.maps.places.AutocompleteSessionToken();
    }
  }, []);

  const isApiAvailable = useCallback(() => {
    const gm = (window as any).google;
    return !!(gm?.maps?.places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions);
  }, []);

  const fetchPredictions = useCallback(
    (input: string) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

      if (!isReady || !isApiAvailable() || input.length < minQueryLength) {
        setPredictions([]);
        setIsOpen(false);
        return;
      }

      debounceTimerRef.current = setTimeout(async () => {
        const gm = (window as any).google;
        const token = getSessionToken();

        try {
          const request: any = { input, sessionToken: token };
          if (countries && countries.length > 0) {
            request.includedRegionCodes = countries;
          }

          const { suggestions } = await gm.maps.places.AutocompleteSuggestion
            .fetchAutocompleteSuggestions(request);

          if (suggestions?.length > 0) {
            const mapped: PlacePrediction[] = suggestions
              .filter((s: any) => s.placePrediction)
              .map((s: any) => {
                const pp = s.placePrediction;
                return {
                  placeId: pp.placeId,
                  description: pp.text?.text || '',
                  mainText: pp.mainText?.text || pp.text?.text || '',
                  secondaryText: pp.secondaryText?.text || '',
                  toPlace: () => pp.toPlace(),
                };
              });
            setPredictions(mapped);
            setIsOpen(mapped.length > 0);
          } else {
            setPredictions([]);
            setIsOpen(false);
          }
        } catch (err) {
          console.error('[usePlaceAutocomplete] error:', err);
          setPredictions([]);
          setIsOpen(false);
        }
      }, debounceMs);
    },
    [isReady, countries, debounceMs, minQueryLength, getSessionToken, isApiAvailable]
  );

  const fetchPlaceDetails = useCallback(
    async (prediction: PlacePrediction): Promise<PlaceDetails | null> => {
      try {
        const place = prediction.toPlace();
        await place.fetchFields({
          fields: [...GOOGLE_PLACE_DETAIL_FIELDS],
        });
        resetSessionToken();

        const details = mapGooglePlaceDetails(place, prediction.description);
        return {
          formattedAddress: details.formattedAddress,
          placeId: details.placeId || prediction.placeId,
          lat: details.lat,
          lng: details.lng,
          addressComponents: details.addressComponents,
          structuredAddress: details.structuredAddress,
        };
      } catch (err) {
        console.error('[usePlaceAutocomplete] fetchFields error:', err);
        resetSessionToken();
        return null;
      }
    },
    [resetSessionToken]
  );

  const clearPredictions = useCallback(() => {
    setPredictions([]);
    setIsOpen(false);
  }, []);

  const cleanup = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  return {
    predictions,
    isOpen,
    setIsOpen,
    fetchPredictions,
    fetchPlaceDetails,
    clearPredictions,
    cleanup,
    isReady,
  };
}
