/**
 * Stage color palette and utilities for CRM Kanban columns.
 * Open stages get muted, rich colors. Closed stages have fixed semantic colors.
 */

// Muted, premium palette for open stages — no green/red to avoid semantic confusion
export const STAGE_PALETTE = [
  "#6366f1", // indigo
  "#d97706", // amber
  "#0d9488", // teal
  "#4f46e5", // deep indigo
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#64748b", // slate
  "#0284c7", // sky
] as const;

// Fixed semantic colors — never used for open stages
export const SEMANTIC_COLORS = {
  closed_won: "#22c55e",
  closed_lost: "#ef4444",
} as const;

/**
 * Returns the next available color from the palette,
 * skipping colors already in use by open stages in the same pipeline.
 * Cycles when exhausted.
 */
export function getNextStageColor(existingOpenColors: string[]): string {
  const normalized = new Set(existingOpenColors.map((c) => c.toLowerCase()));
  const available = STAGE_PALETTE.filter((c) => !normalized.has(c.toLowerCase()));
  if (available.length > 0) return available[0];
  // Cycle: pick the least-used color
  const counts = new Map<string, number>();
  for (const c of STAGE_PALETTE) counts.set(c, 0);
  for (const c of existingOpenColors) {
    const lower = c.toLowerCase();
    for (const pc of STAGE_PALETTE) {
      if (pc.toLowerCase() === lower) {
        counts.set(pc, (counts.get(pc) || 0) + 1);
        break;
      }
    }
  }
  let minCount = Infinity;
  let best = STAGE_PALETTE[0];
  for (const [color, count] of counts) {
    if (count < minCount) {
      minCount = count;
      best = color;
    }
  }
  return best;
}

/**
 * Converts a hex color to HSL components.
 */
function hexToHsl(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 50];
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Returns inline style for tinted column background.
 * All stages (open + closed) get a tinted background based on their color.
 */
export function getStageBackgroundStyle(
  color: string,
  stageType: "open" | "closed_won" | "closed_lost"
): { backgroundColor: string; borderColor: string } {
  const effectiveColor =
    stageType === "closed_won" ? SEMANTIC_COLORS.closed_won :
    stageType === "closed_lost" ? SEMANTIC_COLORS.closed_lost :
    color;

  const [h, s] = hexToHsl(effectiveColor);
  return {
    backgroundColor: `hsla(${h}, ${Math.min(s, 60)}%, 50%, 0.06)`,
    borderColor: `hsla(${h}, ${Math.min(s, 60)}%, 50%, 0.15)`,
  };
}

/**
 * Returns a subtle card accent color derived from the stage color.
 * Used for a left border on deal cards to harmonize with the stage.
 */
export function getCardAccentColor(color: string, stageType: "open" | "closed_won" | "closed_lost"): string {
  const effectiveColor =
    stageType === "closed_won" ? SEMANTIC_COLORS.closed_won :
    stageType === "closed_lost" ? SEMANTIC_COLORS.closed_lost :
    color;

  const [h, s] = hexToHsl(effectiveColor);
  return `hsla(${h}, ${Math.min(s, 50)}%, 50%, 0.25)`;
}
