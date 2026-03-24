/**
 * usePersonDuplicateCheck — checks for existing person duplicates.
 *
 * Contract:
 * - Only READS, never creates or updates persons
 * - Orchestration (create/open) is handled by calling code
 * - Returns ALL candidates, not just first
 *
 * Three-tier matching:
 * 1. Exact: personal_number (trimmed)
 * 2. Exact: passport_number_full (trimmed, unified field)
 * 3. Probable: normalized full_name (case-insensitive, trimmed) + exact birth_date
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
  passport_number_full: string | null;
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
  passport_number_full?: string | null;
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

const SELECT_FIELDS = 'id, profile_id, full_name, birth_date, personal_number, passport_number_full, is_active, created_at';

/** Normalize name: trim + collapse multiple spaces */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

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

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          const r: PersonDuplicateResult = {
            matchType: 'exact',
            candidates: data as PersonMatchCandidate[],
            matchReason: data.length > 1
              ? `Найдено ${data.length} записей с таким же личным номером`
              : 'Совпадение по личному номеру',
            isChecking: false,
            error: null,
          };
          setResult(r);
          return r;
        }
      }

      // Tier 2: Exact match by passport_number_full (unified field)
      if (input.passport_number_full?.trim()) {
        const query = supabase
          .from('legal_details_persons')
          .select(SELECT_FIELDS)
          .eq('profile_id', profileId)
          .eq('passport_number_full', input.passport_number_full.trim());

        if (excludePersonId) {
          query.neq('id', excludePersonId);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          const r: PersonDuplicateResult = {
            matchType: 'exact',
            candidates: data as PersonMatchCandidate[],
            matchReason: data.length > 1
              ? `Найдено ${data.length} записей с такими же паспортными данными`
              : 'Совпадение по серии и номеру паспорта',
            isChecking: false,
            error: null,
          };
          setResult(r);
          return r;
        }
      }

      // Tier 3: Probable match — query by birth_date, normalize full_name in code
      if (input.full_name?.trim() && input.birth_date?.trim()) {
        const normalizedInputName = normalizeName(input.full_name).toLowerCase();

        const query = supabase
          .from('legal_details_persons')
          .select(SELECT_FIELDS)
          .eq('profile_id', profileId)
          .eq('birth_date', input.birth_date.trim());

        if (excludePersonId) {
          query.neq('id', excludePersonId);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data) {
          const matched = data.filter(row =>
            row.full_name && normalizeName(row.full_name).toLowerCase() === normalizedInputName
          );

          if (matched.length > 0) {
            const r: PersonDuplicateResult = {
              matchType: 'probable',
              candidates: matched as PersonMatchCandidate[],
              matchReason: matched.length > 1
                ? `Найдено ${matched.length} записей с похожими ФИО и датой рождения`
                : 'Совпадение по ФИО и дате рождения',
              isChecking: false,
              error: null,
            };
            setResult(r);
            return r;
          }
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
