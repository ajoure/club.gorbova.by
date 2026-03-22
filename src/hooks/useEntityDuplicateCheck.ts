/**
 * useEntityDuplicateCheck — checks for existing entity by UNP within owner's records.
 *
 * Contract:
 * - Only READS, never creates or updates entities
 * - Returns ALL candidates (not just first), sorted deterministically
 * - UNP is normalized before query via normalizeAndValidateUnp
 * - Searches ALL records including archived
 * - Orchestration (create/update/open) is handled by calling code
 *
 * Deterministic priority:
 * 1. active before archived
 * 2. billing before document (purpose)
 * 3. newest first (updated_at DESC)
 */

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeAndValidateUnp } from '@/lib/legal-entities/normalizeUnp';

export type EntityMatchStatus =
  | 'idle'
  | 'checking'
  | 'active_match'
  | 'archived_match'
  | 'multiple_matches'
  | 'no_match'
  | 'error';

export interface EntityMatchRecord {
  id: string;
  profile_id: string;
  client_type: string;
  status: string;
  purpose: string;
  leg_unp: string | null;
  ent_unp: string | null;
  leg_name: string | null;
  ent_name: string | null;
  leg_org_form: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityDuplicateResult {
  status: EntityMatchStatus;
  candidates: EntityMatchRecord[];
  error: string | null;
}

const INITIAL_STATE: EntityDuplicateResult = {
  status: 'idle',
  candidates: [],
  error: null,
};

/** Deterministic sort: active first → billing first → newest first */
function sortCandidates(records: EntityMatchRecord[]): EntityMatchRecord[] {
  return [...records].sort((a, b) => {
    // 1. active before archived
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    // 2. billing before document
    if (a.purpose === 'billing' && b.purpose !== 'billing') return -1;
    if (a.purpose !== 'billing' && b.purpose === 'billing') return 1;
    // 3. newest first
    return b.updated_at.localeCompare(a.updated_at);
  });
}

function deriveStatus(candidates: EntityMatchRecord[]): EntityMatchStatus {
  if (candidates.length === 0) return 'no_match';
  if (candidates.length > 1) return 'multiple_matches';
  return candidates[0].status === 'archived' ? 'archived_match' : 'active_match';
}

export function useEntityDuplicateCheck() {
  const [result, setResult] = useState<EntityDuplicateResult>(INITIAL_STATE);

  const checkDuplicate = useCallback(async (
    unp: string,
    profileId: string
  ): Promise<EntityDuplicateResult> => {
    // Normalize UNP before query — reuse existing normalization
    const normalized = normalizeAndValidateUnp(unp);
    if (!normalized) {
      const r: EntityDuplicateResult = { status: 'no_match', candidates: [], error: null };
      setResult(r);
      return r;
    }

    setResult({ status: 'checking', candidates: [], error: null });

    try {
      const { data, error } = await supabase
        .from('client_legal_details')
        .select('id, profile_id, client_type, status, purpose, leg_unp, ent_unp, leg_name, ent_name, leg_org_form, created_at, updated_at')
        .eq('profile_id', profileId)
        .or(`leg_unp.eq.${normalized},ent_unp.eq.${normalized}`);

      if (error) {
        const r: EntityDuplicateResult = { status: 'error', candidates: [], error: error.message };
        setResult(r);
        return r;
      }

      if (!data || data.length === 0) {
        const r: EntityDuplicateResult = { status: 'no_match', candidates: [], error: null };
        setResult(r);
        return r;
      }

      const candidates = sortCandidates(data as EntityMatchRecord[]);
      const status = deriveStatus(candidates);
      const r: EntityDuplicateResult = { status, candidates, error: null };
      setResult(r);
      return r;
    } catch (err) {
      const r: EntityDuplicateResult = {
        status: 'error',
        candidates: [],
        error: err instanceof Error ? err.message : 'Неизвестная ошибка',
      };
      setResult(r);
      return r;
    }
  }, []);

  const reset = useCallback(() => {
    setResult(INITIAL_STATE);
  }, []);

  return { ...result, checkDuplicate, reset };
}
