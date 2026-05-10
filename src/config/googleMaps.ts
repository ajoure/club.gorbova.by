/**
 * Google Maps API key (publishable, browser-bound).
 *
 * SAFE TO COMMIT: this is a public client-side key whose security relies on
 * HTTP referrer restrictions configured in Google Cloud Console
 * (Maps JavaScript API + Places API (New) + Geocoding API),
 * not on secrecy.
 *
 * Allowed referrers must include:
 *   - https://*.lovable.app/*
 *   - https://*.lovable.dev/*
 *   - https://gorbova.by/*  https://*.gorbova.by/*
 *
 * Override is possible via VITE_GOOGLE_MAPS_API_KEY at build time.
 */
export const GOOGLE_MAPS_API_KEY: string =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
  "AIzaSyDGx935wzOSyDxKWQ5hPve138u_zIlEMPY";
