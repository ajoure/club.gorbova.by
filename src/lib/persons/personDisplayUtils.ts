/**
 * personDisplayUtils — display helpers for person records.
 */

import { formatStructuredAddressForView } from '@/lib/address/formatStructuredAddress';
import type { CanonicalAddressPayload } from '@/lib/address/types';
import type { PersonRow } from '@/hooks/useAiPersons';

export function getPersonDisplayName(person: PersonRow): string {
  return person.full_name || 'Без имени';
}

export function getPersonDocumentSummary(person: PersonRow): string {
  if (person.personal_number) return person.personal_number;
  if (person.passport_series && person.passport_number) {
    return `${person.passport_series} ${person.passport_number}`;
  }
  if (person.passport_number) return person.passport_number;
  return '—';
}

export function getPersonAddressLines(person: PersonRow): string[] {
  const structured = person.address_structured as unknown as CanonicalAddressPayload | null;
  return formatStructuredAddressForView(structured, null, 'кв.');
}
