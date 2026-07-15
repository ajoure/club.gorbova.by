/**
 * Site slot manifest — Phase B, Step 2.
 *
 * Bridges the linked product's tariff offers with admin-authored HTML that
 * carries `data-lovable-slot="tariff:<code>|offer:<role>"` markers. Parent
 * computes the manifest and posts it into the iframe via postMessage; the
 * bridge script rewrites labels, hides inactive slots and delegates clicks.
 *
 * INVARIANT: only active offers with a non-empty `meta.slot_role` and a valid
 * `meta.site_button_variant` are exposed. The DB trigger installed in Step 2
 * enforces this on the write path for dynamic-slot products.
 */
import type { PublicProductData } from "@/hooks/usePublicProduct";
import type { SiteBlock } from "@/services/sitePages/types";

export const SLOT_MANIFEST_VERSION = 1 as const;

export const SLOT_VARIANT_ALLOWLIST = [
  "primary",
  "outline",
  "installment",
  "legal_entity",
  "lead",
] as const;

export type SlotVariant = (typeof SLOT_VARIANT_ALLOWLIST)[number];

export interface SlotManifestOffer {
  slot_role: string;
  offer_id: string;
  button_label: string;
  variant: SlotVariant;
  sort_order: number;
  offer_type: string;
  payment_method: string | null;
  amount: number;
}

export interface SlotManifestTariff {
  tariff_id: string;
  tariff_code: string;
  offers: SlotManifestOffer[];
}

export interface SiteSlotManifest {
  version: typeof SLOT_MANIFEST_VERSION;
  product_id: string;
  tariffs: SlotManifestTariff[];
}

function isSlotVariant(v: unknown): v is SlotVariant {
  return typeof v === "string" && (SLOT_VARIANT_ALLOWLIST as readonly string[]).includes(v);
}

/** Build a manifest from public product data. Returns null when product has no slot offers. */
export function buildSlotManifest(
  data: PublicProductData | null | undefined,
): SiteSlotManifest | null {
  if (!data?.product?.id || !data.tariffs?.length) return null;

  const tariffs: SlotManifestTariff[] = [];
  for (const t of data.tariffs) {
    const offers: SlotManifestOffer[] = [];
    for (const o of t.offers || []) {
      if (o.is_active === false) continue;
      const meta = (o.meta as Record<string, unknown> | undefined) || {};
      const role = typeof meta.slot_role === "string" ? meta.slot_role.trim() : "";
      const variant = meta.site_button_variant;
      if (!role || !isSlotVariant(variant)) continue;
      offers.push({
        slot_role: role,
        offer_id: o.id,
        button_label: o.button_label,
        variant,
        sort_order: typeof o.sort_order === "number" ? o.sort_order : 0,
        offer_type: o.offer_type,
        payment_method: o.payment_method ?? null,
        amount: o.amount,
      });
    }
    if (!offers.length) continue;
    offers.sort(
      (a, b) => a.sort_order - b.sort_order || a.offer_id.localeCompare(b.offer_id),
    );
    tariffs.push({ tariff_id: t.id, tariff_code: t.code, offers });
  }

  if (!tariffs.length) return null;
  return { version: SLOT_MANIFEST_VERSION, product_id: data.product.id, tariffs };
}

/**
 * True when any block references a dynamic marker in raw HTML.
 * Includes both per-tariff slot markers and product-level lead CTA markers, so
 * polling / manifest posting turns on for pages that only carry lead CTAs.
 */
export function pageHasDynamicSlots(blocks: SiteBlock[] | null | undefined): boolean {
  if (!blocks?.length) return false;
  for (const b of blocks) {
    if (b?.type !== "html") continue;
    const code = (b.content as Record<string, unknown> | undefined)?.code;
    if (typeof code !== "string") continue;
    if (code.includes("data-lovable-slot")) return true;
    if (code.includes("data-lovable-product-lead-cta")) return true;
  }
  return false;
}
