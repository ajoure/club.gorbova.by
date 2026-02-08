/**
 * P0-guard: Multi-term search utilities
 * 
 * Key performance rules:
 * - buildSearchIndex is called ONCE per row during data transformation
 * - matchSearchIndex is called during filtering but uses pre-built index
 * - No string concatenation inside filter loops
 */

/**
 * Normalize a value for search indexing
 * Handles null, undefined, numbers, and strings
 */
export function normalizeSearchValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toString();
  return String(value)
    .toLowerCase()
    .replace(/,/g, '.')
    .trim();
}

/**
 * Build a search index string from multiple field values
 * This should be called ONCE during data transformation, not during filtering
 * 
 * @param fields - Array of field values to include in search index
 * @returns Normalized search index string
 */
export function buildSearchIndex(
  fields: Array<string | number | null | undefined>
): string {
  return fields
    .map(normalizeSearchValue)
    .filter(Boolean)
    .join(' ');
}

/**
 * Match search input against a pre-built search index
 * Uses AND logic - all terms must be present
 * 
 * @param searchInput - User's search query
 * @param searchIndex - Pre-built search index from buildSearchIndex
 * @returns true if all search terms are found in the index
 */
export function matchSearchIndex(
  searchInput: string,
  searchIndex: string
): boolean {
  if (!searchInput.trim()) return true;

  const terms = searchInput
    .toLowerCase()
    .replace(/,/g, '.')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) return true;

  return terms.every(term => searchIndex.includes(term));
}
