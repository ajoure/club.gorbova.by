/**
 * cbold manifest loader.
 * Single source of visual/content truth for /cb-native-preview.
 * Produced by .lovable/discovery/cb-native/cbold_manifest.json (DOM-parsed, 73/73 recs).
 */
import manifestJson from "./cbold_manifest.json";

export interface Rec {
  order: number;
  id: string;
  inner_type: string | null;
  classes: string;
  text: string[];
  text_len: number;
  images: string[];
  anchors: string[];
  cta_links: string[];
  colors: string[];
  gradients: string[];
  borders: string[];
  fonts: string[];
  raw_bytes: number;
}

export interface Manifest {
  source_id: string;
  source_slug: string;
  html_bytes: number;
  html_md5: string;
  rec_count: number;
  recs: Rec[];
  asset_inventory?: unknown;
}

export const manifest = manifestJson as unknown as Manifest;

const byId: Map<string, Rec> = new Map();
manifest.recs.forEach((r) => byId.set(r.id, r));

export function rec(id: string): Rec {
  const r = byId.get(id);
  if (!r) {
    // Missing rec — return an inert placeholder so render doesn't crash.
    return {
      order: 0,
      id,
      inner_type: null,
      classes: "",
      text: [],
      text_len: 0,
      images: [],
      anchors: [],
      cta_links: [],
      colors: [],
      gradients: [],
      borders: [],
      fonts: [],
      raw_bytes: 0,
    };
  }
  return r;
}

// Visual identity extracted from asset_inventory.
export const CB_PALETTE = {
  bg: "#ffffff",
  bgSoft: "#f6f6f6",
  border: "#eeeeee",
  text: "#343434",
  textStrong: "#1b1b1b",
  muted: "#686868",
  accent: "#e422c2",
  accentSoft: "#f9aeff",
} as const;

export const CB_FONT_STACK =
  "'Comfortaa', 'Segoe UI', system-ui, -apple-system, sans-serif";
