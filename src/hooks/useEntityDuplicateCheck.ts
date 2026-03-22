/**
 * useEntityDuplicateCheck — checks for existing entity by UNP within owner's records.
 *
 * Searches ALL records (active + archived) to prevent duplicates.
 * Does NOT call GRP lookup — purely DB check.
 * Returns match status and existing entity data.
 */

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeAndValidateUnp } from '@/lib/legal-entities/normalizeUnp';

export type EntityMatchStatus = 'active_match' | 'archived_match' | 'no_match' | 'idle' | 'checking' | 'error';

export interface EntityDuplicateResult {
  status: EntityMatchStatus;
  existingEntity: EntityMatchRecord | null;
  error: string | null;
}

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

const INITIAL_STATE: EntityDuplicateResult = {
  status: 'idle',
  existingEntity: null,
  error: null,
};

export function useEntityDuplicateCheck() {
  const [result, setResult] = useState<EntityDuplicateResult>(INITIAL_STATE);

  const checkDuplicate = useCallback(async (unp: string, profileId: string): Promise<EntityDuplicateResult> => {
    const normalized = normalizeAndValidateUnp(unp);
    if (!normalized) {
      const r: EntityDuplicateResult = { status: 'no_match', existingEntity: null, error: null };
      setResult(r);
      return r;
    }

    setResult({ status: 'checking', existingEntity: null, error: null });

    try {
      const { data, error } = await supabase
        .from('client_legal_details')
        .select('id, profile_id, client_type, status, purpose, leg_unp, ent_unp, leg_name, ent_name, leg_org_form, created_at, updated_at')
        .eq('profile_id', profileId)
        .or(`leg_unp.eq.${normalized},ent_unp.eq.${normalized}`)
        .limit(1)
        .maybeSingle();

      if (error) {
        const r: EntityDuplicateResult = { status: 'error', existingEntity: null, error: error.message };
        setResult(r);
        return r;
      }

      if (!data) {
        const r: EntityDuplicateResult = { status: 'no_match', existingEntity: null, error: null };
        setResult(r);
        return r;
      }

      const matchRecord: EntityMatchRecord = {
        id: data.id,
        profile_id: data.profile_id,
        client_type: data.client_type,
        status: data.status,
        purpose: data.purpose,
        leg_unp: data.leg_unp,
        ent_unp: data.ent_unp,
        leg_name: data.leg_name,
        ent_name: data.ent_name,
        leg_org_form: data.leg_org_form,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      const matchStatus: EntityMatchStatus = data.status === 'archived' ? 'archived_match' : 'active_match';
      const r: EntityDuplicateResult = { status: matchStatus, existingEntity: matchRecord, error: null };
      setResult(r);
      return r;
    } catch (err) {
      const r: EntityDuplicateResult = {
        status: 'error',
        existingEntity: null,
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
