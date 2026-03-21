/**
 * GrpAutofillService — domain logic for GRP (MNS) autofill.
 *
 * Responsible for:
 * - Defining which fields are allowed to be filled from GRP
 * - Building diff between current form values and GRP data
 * - Parsing org form and clean name from GRP full_name
 * - NOT responsible for UI or persistence
 */

import type { LegalEntityLookupData } from './types';
import type { StructuredAddress } from '@/lib/address/types';
import { parseGrpAddress } from './GrpAddressParser';

// ---------------------------------------------------------------------------
// Org form dictionary: full → short
// ---------------------------------------------------------------------------

export const ORG_FORM_FULL_TO_SHORT: Record<string, string> = {
  'Общество с ограниченной ответственностью': 'ООО',
  'Закрытое акционерное общество': 'ЗАО',
  'Открытое акционерное общество': 'ОАО',
  'Общество с дополнительной ответственностью': 'ОДО',
  'Унитарное предприятие': 'УП',
  'Коммунальное унитарное предприятие': 'КУП',
  'Частное унитарное предприятие': 'ЧУП',
  'Государственное унитарное предприятие': 'ГУП',
  'Республиканское унитарное предприятие': 'РУП',
  'Производственный кооператив': 'ПК',
  'Индивидуальный предприниматель': 'ИП',
  'Совместное общество с ограниченной ответственностью': 'СООО',
  'Иностранное общество с ограниченной ответственностью': 'ИООО',
  'Совместное закрытое акционерное общество': 'СЗАО',
  'Иностранное унитарное предприятие': 'ИУП',
  'Частное производственное унитарное предприятие': 'ЧПУП',
  'Частное торговое унитарное предприятие': 'ЧТУП',
};

export const ORG_FORM_SHORT_TO_FULL: Record<string, string> = {};
for (const [full, short] of Object.entries(ORG_FORM_FULL_TO_SHORT)) {
  ORG_FORM_SHORT_TO_FULL[short] = full;
}

// ---------------------------------------------------------------------------
// Parse org form + clean name from GRP full_name
// ---------------------------------------------------------------------------

export interface ParsedOrgName {
  orgFormFull: string;   // "Закрытое акционерное общество"
  orgFormShort: string;  // "ЗАО"
  cleanName: string;     // "АЖУР инкам" (no quotes, no form)
}

/**
 * Extract org form and clean company name from GRP full_name.
 *
 * Examples:
 *   'Закрытое акционерное общество "АЖУР инкам"'
 *     → { orgFormFull: 'Закрытое акционерное общество', orgFormShort: 'ЗАО', cleanName: 'АЖУР инкам' }
 *   'Горбова Екатерина Сергеевна' (ИП, no org form)
 *     → { orgFormFull: '', orgFormShort: '', cleanName: 'Горбова Екатерина Сергеевна' }
 */
export function parseOrgFormAndName(fullName: string): ParsedOrgName {
  if (!fullName || !fullName.trim()) {
    return { orgFormFull: '', orgFormShort: '', cleanName: '' };
  }

  const trimmed = fullName.trim();

  // Try matching full org form prefix (longest match first)
  const sortedForms = Object.keys(ORG_FORM_FULL_TO_SHORT)
    .sort((a, b) => b.length - a.length);

  for (const form of sortedForms) {
    if (trimmed.toLowerCase().startsWith(form.toLowerCase())) {
      const rest = trimmed.slice(form.length).trim();
      // Remove surrounding quotes from the name
      const cleanName = stripQuotes(rest);
      return {
        orgFormFull: form,
        orgFormShort: ORG_FORM_FULL_TO_SHORT[form],
        cleanName: cleanName || rest,
      };
    }
  }

  // Try matching short form prefix (e.g. "ООО «Тест»")
  const sortedShorts = Object.keys(ORG_FORM_SHORT_TO_FULL)
    .sort((a, b) => b.length - a.length);

  for (const short of sortedShorts) {
    if (trimmed.startsWith(short + ' ') || trimmed.startsWith(short + '"') || trimmed.startsWith(short + '«')) {
      const rest = trimmed.slice(short.length).trim();
      const cleanName = stripQuotes(rest);
      return {
        orgFormFull: ORG_FORM_SHORT_TO_FULL[short],
        orgFormShort: short,
        cleanName: cleanName || rest,
      };
    }
  }

  // No org form found — return as-is (e.g. individual entrepreneur name)
  return { orgFormFull: '', orgFormShort: '', cleanName: trimmed };
}

function stripQuotes(s: string): string {
  // Remove «», "", '' and regular quotes
  return s
    .replace(/^[«»""''"\s]+/, '')
    .replace(/[«»""''"\s]+$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Entity kind classification
// ---------------------------------------------------------------------------

export type EntityKind = 'legal_entity' | 'entrepreneur' | 'unknown';

// ---------------------------------------------------------------------------
// Autofill fields contract
// ---------------------------------------------------------------------------

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
  // Derived fields
  org_form_full: string | null;
  org_form_short: string | null;
  clean_name: string | null;
  parsed_address: StructuredAddress | null;
  entity_kind: EntityKind;
}

export interface GrpDiffEntry {
  label: string;
  field: keyof GrpAutofillFields;
  oldValue: string;
  newValue: string;
}

/**
 * Map GRP lookup data to autofill fields.
 * Parses org form, clean name, and structured address.
 * Classifies entity as legal_entity / entrepreneur / unknown.
 */
export function grpDataToAutofillFields(data: LegalEntityLookupData): GrpAutofillFields {
  const parsed = parseOrgFormAndName(data.full_name);
  const parsedAddress = parseGrpAddress(data.legal_address);

  // Classify entity kind
  const isEntrepreneur =
    parsed.orgFormFull === 'Индивидуальный предприниматель' ||
    parsed.orgFormShort === 'ИП';
  const isLegalEntity = !!parsed.orgFormFull && !isEntrepreneur;
  const entity_kind: EntityKind = isEntrepreneur
    ? 'entrepreneur'
    : isLegalEntity
      ? 'legal_entity'
      : 'unknown';

  return {
    name: data.full_name || null,
    short_name: data.short_name || null,
    address: data.legal_address || null,
    registration_date: data.registration_date || null,
    tax_office_code: data.tax_office_code || null,
    tax_office_name: data.tax_office_name || null,
    status_code: data.status_code || null,
    status_name: data.status_name || null,
    org_form_full: parsed.orgFormFull || null,
    org_form_short: parsed.orgFormShort || null,
    clean_name: parsed.cleanName || null,
    parsed_address: parsedAddress,
    entity_kind,
  };
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Полное название',
  short_name: 'Краткое название',
  clean_name: 'Название (без формы)',
  org_form_full: 'Организационная форма',
  address: 'Адрес',
  registration_date: 'Дата регистрации',
  tax_office_code: 'Код ИМНС',
  tax_office_name: 'Название ИМНС',
  status_code: 'Код статуса',
  status_name: 'Статус',
};

/** Fields to show in diff dialog */
const DIFF_FIELDS: (keyof GrpAutofillFields)[] = [
  'org_form_full',
  'clean_name',
  'short_name',
  'address',
  'registration_date',
  'tax_office_code',
  'tax_office_name',
  'status_name',
];

/**
 * Build diff between current values and GRP-provided values.
 * Only includes entries where newValue differs from oldValue.
 */
export function buildGrpDiff(
  currentValues: Partial<Record<keyof GrpAutofillFields, string>>,
  grpFields: GrpAutofillFields
): GrpDiffEntry[] {
  const diff: GrpDiffEntry[] = [];
  for (const key of DIFF_FIELDS) {
    const newVal = grpFields[key as keyof GrpAutofillFields];
    if (newVal === null || newVal === undefined || typeof newVal === 'object') {
      // For address, show the flat string
      if (key === 'address' && grpFields.address) {
        const oldVal = currentValues[key] || '';
        if (grpFields.address !== oldVal) {
          diff.push({
            label: FIELD_LABELS[key] || key,
            field: key,
            oldValue: oldVal,
            newValue: grpFields.address,
          });
        }
      }
      continue;
    }
    const oldVal = currentValues[key] || '';
    const newValStr = String(newVal);
    if (newValStr && newValStr !== oldVal) {
      diff.push({
        label: FIELD_LABELS[key] || key,
        field: key,
        oldValue: oldVal,
        newValue: newValStr,
      });
    }
  }
  return diff;
}
