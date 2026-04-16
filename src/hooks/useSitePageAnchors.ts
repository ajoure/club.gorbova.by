/**
 * Реестр anchors / blocks текущей страницы для admin editor.
 *
 * Canonical правила:
 * - target ключ = stable block.id (UUID) ИЛИ anchorId (slug, validated unique per page)
 * - запрещено любое сопоставление по title/name/index/order
 * - duplicate anchor на странице → validation error на этом уровне
 */
import { useMemo } from "react";
import type { SiteBlock, BlockSettings } from "@/services/sitePages/types";

export interface AnchorEntry {
  blockId: string;
  anchorId: string;
}

export interface BlockEntry {
  blockId: string;
  type: string;
  label: string; // короткая подпись для select (тип + усечённый text)
  anchorId?: string;
}

export interface AnchorsRegistry {
  anchors: AnchorEntry[];
  blocks: BlockEntry[];
  duplicateAnchorIds: string[];
  hasAnchor: (anchorId: string) => boolean;
  hasBlock: (blockId: string) => boolean;
}

const ANCHOR_RX = /^[a-z0-9][a-z0-9-]{0,47}$/;
export function isValidAnchorSlug(v: string): boolean {
  return ANCHOR_RX.test(v);
}

function shortLabel(b: SiteBlock): string {
  const c = b.content as Record<string, unknown>;
  const candidates = [c.title, c.text, c.heading, (c as { html?: string }).html, c.buttonText];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) {
      const plain = v.replace(/<[^>]*>/g, "").trim();
      return plain.length > 30 ? plain.slice(0, 30) + "…" : plain;
    }
  }
  return b.type;
}

export function useSitePageAnchors(blocks: SiteBlock[]): AnchorsRegistry {
  return useMemo(() => {
    const anchors: AnchorEntry[] = [];
    const blockEntries: BlockEntry[] = [];
    const seen = new Map<string, number>();

    for (const b of blocks) {
      const s = (b.settings || {}) as Partial<BlockSettings> & { anchorId?: string };
      const anchorId = s.anchorId?.trim() || undefined;
      blockEntries.push({
        blockId: b.id,
        type: b.type,
        label: shortLabel(b),
        anchorId,
      });
      if (anchorId) {
        anchors.push({ blockId: b.id, anchorId });
        seen.set(anchorId, (seen.get(anchorId) || 0) + 1);
      }
    }

    const duplicateAnchorIds = Array.from(seen.entries())
      .filter(([, n]) => n > 1)
      .map(([k]) => k);

    return {
      anchors,
      blocks: blockEntries,
      duplicateAnchorIds,
      hasAnchor: (a: string) => anchors.some((x) => x.anchorId === a),
      hasBlock: (id: string) => blockEntries.some((x) => x.blockId === id),
    };
  }, [blocks]);
}
