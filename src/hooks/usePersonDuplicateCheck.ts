/**
 * usePersonDuplicateCheck — checks for existing person duplicates.
 *
 * Three-tier matching:
 * 1. Exact: personal_number
 * 2. Exact: passport_series + passport_number
 * 3. Probable: full_name + birth_date (ilike)
 *
 * Does NOT create records. Only returns match status and candidates.
 */

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type PersonMatchType = 'exact' | 'probable' | 'none';

export interface PersonMatchCandidate {
  id: string;
  profile_id: string;
  full_name: string | null;
  birth_date: string | null;
  personal_number: string | null;
  passport_series: string | null;
  passport_number: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PersonDuplicateResult {
  matchType: PersonMatchType;
  candidates: PersonMatchCandidate[];
  matchReason: string | null;
  isChecking: boolean;
  error: string | null;
}

export interface PersonCheckInput {
  personal_number?: string | null;
  passport_series?: string | null;
  passport_number?: string | null;
  full_name?: string | null;
  birth_date?: string | null;
}

const INITIAL_STATE: PersonDuplicateResult = {
  matchType: 'none',
  candidates: [],
  matchReason: null,
  isChecking: false,
  error: null,
};

const SELECT_FIELDS = 'id, profile_id, full_name, birth_date, personal_number, passport_series, passport_number, is_active, created_at';

export function usePersonDuplicateCheck() {
  const [result, setResult] = useState<PersonDuplicateResult>(INITIAL_STATE);

  const checkDuplicate = useCallback(async (
    input: PersonCheckInput,
    profileId: string,
    excludePersonId?: string
  ): Promise<PersonDuplicateResult> => {
    setResult({ ...INITIAL_STATE, isChecking: true });

    try {
      // Tier 1: Exact match by personal_number
      if (input.personal_number?.trim()) {
        const query = supabase
          .from('legal_details_persons')
          .select(SELECT_FIELDS)
          .eq('profile_id', profileId)
          .eq('personal_number', input.personal_number.trim());

        if (excludePersonId) {
          query.neq('id', excludePersonId);
        }

        const { data, error } = await query.limit(5);
        if (error) throw error;

        if (data && data.length > 0) {
          const r: PersonDuplicateResult = {
            matchType: 'exact',
            candidates: data as PersonMatchCandidate[],
            matchReason: 'Совпадение по личному номеру',
            isChecking: false,
            error: null,
          };
          setResult(r);
          return r;
        }
      }

      // Tier 2: Exact match by passport_series + passport_number
      if (input.passport_series?.trim() && input.passport_number?.trim()) {
        const query = supabase
          .from('legal_details_persons')
          .select(SELECT_FIELDS)
          .eq('profile_id', profileId)
          .eq('passport_series', input.passport_series.trim())
          .eq('passport_number', input.passport_number.trim());

        if (excludePersonId) {
          query.neq('id', excludePersonId);
        }

        const { data, error } = await query.limit(5);
        if (error) throw error;

        if (data && data.length > 0) {
          const r: PersonDuplicateResult = {
            matchType: 'exact',
            candidates: data as PersonMatchCandidate[],
            matchReason: 'Совпадение по серии и номеру паспорта',
            isChecking: false,
            error: null,
          };
          setResult(r);
          return r;
        }
      }

      // Tier 3: Probable match by full_name + birth_date
      if (input.full_name?.trim() && input.birth_date?.trim()) {
        const query = supabase
          .from('legal_details_persons')
          .select(SELECT_FIELDS)
          .eq('profile_id', profileId)
          .ilike('full_name', input.full_name.trim())
          .eq('birth_date', input.birth_date.trim());

        if (excludePersonId) {
          query.neq('id', excludePersonId);
        }

        const { data, error } = await query.limit(5);
        if (error) throw error;

        if (data && data.length > 0) {
          const r: PersonDuplicateResult = {
            matchType: 'probable',
            candidates: data as PersonMatchCandidate[],
            matchReason: 'Совпадение по ФИО и дате рождения',
            isChecking: false,
            error: null,
          };
          setResult(r);
          return r;
        }
      }

      // No match
      const r: PersonDuplicateResult = INITIAL_STATE;
      setResult(r);
      return r;
    } catch (err) {
      const r: PersonDuplicateResult = {
        matchType: 'none',
        candidates: [],
        matchReason: null,
        isChecking: false,
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
