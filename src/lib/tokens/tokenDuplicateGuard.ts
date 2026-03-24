/**
 * Token Duplicate Guard — registry-first create policy
 *
 * RULE: Before ANY new token is created in fields_registry,
 * this guard MUST be invoked to prevent duplicates.
 *
 * Three levels of protection:
 * 1. Exact key duplicate → BLOCK (also enforced by DB UNIQUE constraint)
 * 2. Exact system token duplicate → BLOCK
 * 3. Fuzzy label/search duplicate → WARNING (requires explicit merge/reuse decision)
 *
 * This guard applies to:
 * - Admin UI token creation
 * - Seed/migration scripts (pre-check before INSERT)
 * - Any programmatic token registration
 *
 * @module tokenDuplicateGuard
 */

import { supabase } from "@/integrations/supabase/client";

export interface DuplicateCheckResult {
  /** Whether the token can be created */
  canCreate: boolean;
  /** Blocking reason if canCreate=false */
  blockReason?: string;
  /** Non-blocking warnings (fuzzy matches) */
  warnings: string[];
  /** Existing keys that matched */
  matchedKeys: string[];
}

/**
 * Full duplicate check before creating a new token.
 * Call this before ANY INSERT into fields_registry.
 */
export async function checkTokenDuplicate(
  key: string,
  label: string,
  entityType: string
): Promise<DuplicateCheckResult> {
  const result: DuplicateCheckResult = {
    canCreate: true,
    warnings: [],
    matchedKeys: [],
  };

  // 1. Exact key duplicate (global — key is UNIQUE across all entity_types)
  const exactKeyResult = await checkExactKeyDuplicate(key);
  if (exactKeyResult) {
    result.canCreate = false;
    result.blockReason = `Exact key duplicate: "${key}" already exists (entity_type=${exactKeyResult.entity_type})`;
    result.matchedKeys.push(key);
    return result;
  }

  // 2. Exact system token duplicate
  const tokenString = `{{${key}}}`;
  const exactTokenResult = await checkExactTokenDuplicate(tokenString);
  if (exactTokenResult) {
    result.canCreate = false;
    result.blockReason = `System token "{{${key}}}" resolves to existing key "${exactTokenResult.key}"`;
    result.matchedKeys.push(exactTokenResult.key);
    return result;
  }

  // 3. Fuzzy label duplicate (warning, not block)
  const fuzzyMatches = await checkFuzzyLabelDuplicate(label, entityType);
  if (fuzzyMatches.length > 0) {
    result.canCreate = false; // Do NOT auto-create — require explicit merge/reuse decision
    result.blockReason = `Fuzzy label match found — explicit reuse/merge decision required`;
    result.warnings = fuzzyMatches.map(
      (m) => `Similar label: "${m.label}" (key=${m.key}, entity_type=${m.entity_type})`
    );
    result.matchedKeys = fuzzyMatches.map((m) => m.key);
  }

  return result;
}

/**
 * Check if a key already exists in fields_registry (global).
 */
async function checkExactKeyDuplicate(
  key: string
): Promise<{ key: string; entity_type: string } | null> {
  const { data } = await supabase
    .from("fields_registry")
    .select("key, entity_type")
    .eq("key", key)
    .limit(1)
    .maybeSingle();

  return data as { key: string; entity_type: string } | null;
}

/**
 * Check if a system token string maps to an existing key.
 * Token format: {{canonical.key}}
 */
async function checkExactTokenDuplicate(
  tokenString: string
): Promise<{ key: string; entity_type: string } | null> {
  // Extract key from {{key}} format
  const match = tokenString.match(/^\{\{(.+)\}\}$/);
  if (!match) return null;

  const extractedKey = match[1];
  return checkExactKeyDuplicate(extractedKey);
}

/**
 * Check for fuzzy label duplicates using normalized comparison.
 * Uses trigram-like matching: normalized lowercase comparison
 * and Levenshtein-like distance check (simplified).
 */
async function checkFuzzyLabelDuplicate(
  label: string,
  entityType: string
): Promise<Array<{ key: string; label: string; entity_type: string }>> {
  const normalizedLabel = normalizeLabel(label);

  // Fetch all labels for the same entity_type + global similar labels
  const { data } = await supabase
    .from("fields_registry")
    .select("key, label, entity_type")
    .is("archived_at", null);

  if (!data) return [];

  const matches: Array<{ key: string; label: string; entity_type: string }> = [];

  for (const row of data) {
    const existingNormalized = normalizeLabel(row.label);

    // Skip exact match (handled by exact key check)
    if (existingNormalized === normalizedLabel) {
      matches.push({
        key: row.key,
        label: row.label,
        entity_type: row.entity_type,
      });
      continue;
    }

    // Levenshtein distance < 3 on normalized labels
    if (levenshteinDistance(normalizedLabel, existingNormalized) < 3) {
      matches.push({
        key: row.key,
        label: row.label,
        entity_type: row.entity_type,
      });
    }
  }

  return matches;
}

/**
 * Normalize label for comparison: lowercase, trim, collapse whitespace.
 */
function normalizeLabel(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Simple Levenshtein distance implementation.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

// Export for testing
export { normalizeLabel, levenshteinDistance };
