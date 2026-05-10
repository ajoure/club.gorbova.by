/// <reference types="google.maps" />
/**
 * useGoogleMapsLoader — singleton loader for Google Maps JavaScript SDK.
 * Uses Google's recommended Dynamic Library Import (bootstrap loader) pattern.
 */
import { useEffect, useState } from "react";
import { GOOGLE_MAPS_API_KEY as CONFIGURED_GOOGLE_MAPS_API_KEY } from "@/config/googleMaps";

const GOOGLE_MAPS_API_KEY: string | undefined = CONFIGURED_GOOGLE_MAPS_API_KEY || undefined;

type LoaderState = "idle" | "loading" | "ready" | "error";

let globalState: LoaderState = "idle";
let globalError: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function isNewPlacesApiAvailable(): boolean {
  const gm = (window as any).google;
  return !!(
    gm?.maps?.places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions &&
    gm?.maps?.places?.AutocompleteSessionToken
  );
}

function injectBootstrapLoader(apiKey: string): void {
  if ((window as any).google?.maps?.importLibrary) return;

  ((g: any) => {
    let h: any, a: any, k: any;
    const p = "The Google Maps JavaScript API";
    const c = "google";
    const l = "importLibrary";
    const q = "__ib__";
    const m = document;
    let b: any = window as any;

    b = b[c] || (b[c] = {});
    const d = b.maps || (b.maps = {});
    const r = new Set();
    const e = new URLSearchParams();

    const u = () =>
      h ||
      (h = new Promise(async (f: any, n: any) => {
        await (a = m.createElement("script"));
        e.set("libraries", [...r] + "");
        for (k in g)
          e.set(k.replace(/[A-Z]/g, (t: string) => "_" + t[0].toLowerCase()), g[k]);
        e.set("callback", c + ".maps." + q);
        a.src = `https://maps.googleapis.com/maps/api/js?` + e;
        d[q] = f;
        a.onerror = () => (h = n(Error(p + " could not load.")));
        a.nonce = (m.querySelector("script[nonce]") as any)?.nonce || "";
        m.head.append(a);
      }));

    d[l]
      ? console.warn(p + " only loads once. Ignoring:", g)
      : (d[l] = (f: string, ...n: any[]) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({
    key: apiKey,
    language: "ru",
  });
}

async function loadPlacesLibrary(): Promise<boolean> {
  const gm = (window as any).google;
  if (!gm?.maps?.importLibrary) return false;

  try {
    await gm.maps.importLibrary("places");
  } catch (err) {
    console.error("[GoogleMapsLoader] importLibrary('places') failed:", err);
    return false;
  }

  if (!isNewPlacesApiAvailable()) {
    console.error("[GoogleMapsLoader] AutocompleteSuggestion/AutocompleteSessionToken not found");
    return false;
  }

  return true;
}

// HMR recovery
(function recoverState() {
  if (isNewPlacesApiAvailable()) {
    globalState = "ready";
    return;
  }
  const gm = (window as any).google;
  if (gm?.maps?.importLibrary) {
    globalState = "loading";
    loadPlacesLibrary().then((ok) => {
      globalState = ok ? "ready" : "error";
      globalError = ok ? null : "Places library import failed during recovery";
      notify();
    });
    return;
  }
  const existing = document.querySelector('script[src*="maps.googleapis.com"]');
  if (existing && GOOGLE_MAPS_API_KEY) {
    globalState = "loading";
    injectBootstrapLoader(GOOGLE_MAPS_API_KEY);
    loadPlacesLibrary().then((ok) => {
      globalState = ok ? "ready" : "error";
      globalError = ok ? null : "Places library import failed during recovery";
      notify();
    });
  }
})();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    globalState = "idle";
    globalError = null;
    listeners.clear();
  });
}

function loadScript() {
  if (globalState !== "idle") return;
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("[GoogleMapsLoader] VITE_GOOGLE_MAPS_API_KEY is not configured. Google address features disabled.");
    globalState = "error";
    globalError = "VITE_GOOGLE_MAPS_API_KEY is not configured";
    notify();
    return;
  }

  globalState = "loading";
  notify();
  injectBootstrapLoader(GOOGLE_MAPS_API_KEY);
  loadPlacesLibrary().then((ok) => {
    globalState = ok ? "ready" : "error";
    globalError = ok ? null : "Places library initialization failed";
    notify();
  });
}

export interface GoogleMapsLoaderResult {
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  hasApiKey: boolean;
}

export function useGoogleMapsLoader(): GoogleMapsLoaderResult {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    if (globalState === "idle" && GOOGLE_MAPS_API_KEY) loadScript();
    return () => { listeners.delete(listener); };
  }, []);

  return {
    isReady: globalState === "ready",
    isLoading: globalState === "loading",
    isError: globalState === "error",
    error: globalError,
    hasApiKey: !!GOOGLE_MAPS_API_KEY,
  };
}
