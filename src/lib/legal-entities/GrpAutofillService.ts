/**
 * GrpAutofillService — domain logic for GRP (MNS) autofill.
 *
 * Responsible for:
 * - Defining which fields are allowed to be filled from GRP
 * - Building diff between current form values and GRP data
 * - NOT responsible for UI or persistence
 */

import type { LegalEntityLookupData } from './types';

/** Fields that GRP is allowed to populate */
export interface GrpAutofillFields {
  name: string | null;
  short_name: string | null;
  address: string | null;
  registration_date: string | null;
  tax_office_code: string | null;
  tax_office_name: string | null;
  status_code: string | null;
  status_name: string | null;
}

export interface GrpDiffEntry {
  label: string;
  field: keyof GrpAutofillFields;
  oldValue: string;
  newValue: string;
}

/**
 * Map GRP lookup data to autofill fields.
 * Only maps allowed fields — director, acts_on_basis, etc. are NOT touched.
 */
export function grpDataToAutofillFields(data: LegalEntityLookupData): GrpAutofillFields {
  return {
    name: data.full_name || null,
    short_name: data.short_name || null,
    address: data.legal_address || null,
    registration_date: data.registration_date || null,
    tax_office_code: data.tax_office_code || null,
    tax_office_name: data.tax_office_name || null,
    status_code: data.status_code || null,
    status_name: data.status_name || null,
  };
}

const FIELD_LABELS: Record<keyof GrpAutofillFields, string> = {
  name: 'Название',
  short_name: 'Краткое название',
  address: 'Адрес',
  registration_date: 'Дата регистрации',
  tax_office_code: 'Код ИМНС',
  tax_office_name: 'Название ИМНС',
  status_code: 'Код статуса',
  status_name: 'Статус',
};

/**
 * Build diff between current values and GRP-provided values.
 * Only includes entries where newValue differs from oldValue.
 */
export function buildGrpDiff(
  currentValues: Partial<Record<keyof GrpAutofillFields, string>>,
  grpFields: GrpAutofillFields
): GrpDiffEntry[] {
  const diff: GrpDiffEntry[] = [];
  for (const key of Object.keys(FIELD_LABELS) as (keyof GrpAutofillFields)[]) {
    const newVal = grpFields[key] || '';
    const oldVal = currentValues[key] || '';
    if (newVal && newVal !== oldVal) {
      diff.push({
        label: FIELD_LABELS[key],
        field: key,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }
  return diff;
}
