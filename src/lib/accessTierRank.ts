export type AccessRankRow = {
  id: string;
  meta?: unknown;
  sort_order?: number | null;
  display_order?: number | null;
};

function configuredRank(meta: unknown): number | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const raw = (meta as Record<string, unknown>).access_rank;
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * Configuration-only rank. Names and codes are deliberately absent from the
 * contract so renaming a tariff cannot change permissions.
 */
export function resolveAccessRank(row: AccessRankRow): number | null {
  const explicit = configuredRank(row.meta);
  if (explicit !== null) return explicit;
  if (Number.isFinite(row.sort_order)) return row.sort_order as number;
  if (Number.isFinite(row.display_order)) return row.display_order as number;
  return null;
}

export function buildAccessRankMap(rows: AccessRankRow[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const rank = resolveAccessRank(row);
    if (rank !== null) result[row.id] = rank;
  }
  return result;
}

export function selectHighestRankedTariff<T extends { tariff_id: string | null }>(
  rows: T[],
  activeTariffIds: string[],
  rankByTariffId: Record<string, number>,
): T | null {
  const active = new Set(activeTariffIds);
  return rows
    .filter(row => row.tariff_id && active.has(row.tariff_id))
    .sort((left, right) => {
      const leftRank = left.tariff_id ? rankByTariffId[left.tariff_id] : undefined;
      const rightRank = right.tariff_id ? rankByTariffId[right.tariff_id] : undefined;
      if (leftRank === undefined && rightRank === undefined) return 0;
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      return rightRank - leftRank;
    })[0] || null;
}
