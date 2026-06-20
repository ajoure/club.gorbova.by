// Frontend mirror of supabase/functions/_shared/ln-subfield-spec.ts.
// Source of truth — backend file; keep in sync manually (pure data, no I/O).
export type LnSubFieldKind = 'name' | 'date' | 'text' | 'address_full' | 'address_part';

export interface LnSubFieldSpec {
  key: string;
  label_ru: string;
  kind: LnSubFieldKind;
  column?: string;
  jsonb_key?: string;
  supports_case: boolean;
  multi_policy: 'join' | 'error';
}

export const LN_SUB_FIELD_SPECS: LnSubFieldSpec[] = [
  { key: 'full_name', label_ru: 'ФИО (полное)', kind: 'name', column: 'full_name', supports_case: true, multi_policy: 'join' },
  { key: 'short_name', label_ru: 'ФИО (краткое, Иванов И. И.)', kind: 'name', column: 'full_name', supports_case: true, multi_policy: 'join' },
  { key: 'signature_short', label_ru: 'ФИО для подписи (И. И. Иванов)', kind: 'name', column: 'full_name', supports_case: true, multi_policy: 'join' },
  { key: 'birth_date', label_ru: 'Дата рождения', kind: 'date', column: 'birth_date', supports_case: false, multi_policy: 'error' },
  { key: 'personal_number', label_ru: 'Личный номер', kind: 'text', column: 'personal_number', supports_case: false, multi_policy: 'error' },
  { key: 'passport_series', label_ru: 'Паспорт: серия', kind: 'text', column: 'passport_series', supports_case: false, multi_policy: 'error' },
  { key: 'passport_number', label_ru: 'Паспорт: номер', kind: 'text', column: 'passport_number', supports_case: false, multi_policy: 'error' },
  { key: 'passport_number_full', label_ru: 'Паспорт: серия и номер', kind: 'text', column: 'passport_number_full', supports_case: false, multi_policy: 'error' },
  { key: 'passport_issued_by', label_ru: 'Паспорт: кем выдан', kind: 'text', column: 'passport_issued_by', supports_case: false, multi_policy: 'error' },
  { key: 'passport_issued_date', label_ru: 'Паспорт: дата выдачи', kind: 'date', column: 'passport_issued_date', supports_case: false, multi_policy: 'error' },
  { key: 'passport_valid_until', label_ru: 'Паспорт: действителен до', kind: 'date', column: 'passport_valid_until', supports_case: false, multi_policy: 'error' },
  { key: 'phone', label_ru: 'Телефон', kind: 'text', column: 'phone', supports_case: false, multi_policy: 'error' },
  { key: 'email', label_ru: 'Email', kind: 'text', column: 'email', supports_case: false, multi_policy: 'error' },
  { key: 'address_full', label_ru: 'Адрес (полный)', kind: 'address_full', column: 'address_structured', supports_case: true, multi_policy: 'join' },
  { key: 'address_country', label_ru: 'Адрес: страна', kind: 'address_part', jsonb_key: 'country', supports_case: false, multi_policy: 'error' },
  { key: 'address_region', label_ru: 'Адрес: область/регион', kind: 'address_part', jsonb_key: 'region', supports_case: false, multi_policy: 'error' },
  { key: 'address_postal_code', label_ru: 'Адрес: индекс', kind: 'address_part', jsonb_key: 'postal_code', supports_case: false, multi_policy: 'error' },
  { key: 'address_city', label_ru: 'Адрес: город', kind: 'address_part', jsonb_key: 'city', supports_case: false, multi_policy: 'error' },
  { key: 'address_street', label_ru: 'Адрес: улица', kind: 'address_part', jsonb_key: 'street', supports_case: false, multi_policy: 'error' },
  { key: 'address_house', label_ru: 'Адрес: дом', kind: 'address_part', jsonb_key: 'house', supports_case: false, multi_policy: 'error' },
  { key: 'address_building', label_ru: 'Адрес: корпус', kind: 'address_part', jsonb_key: 'building', supports_case: false, multi_policy: 'error' },
  { key: 'address_apartment', label_ru: 'Адрес: квартира/офис', kind: 'address_part', jsonb_key: 'apartment', supports_case: false, multi_policy: 'error' },
  { key: 'bank_account', label_ru: 'Банк: счёт', kind: 'text', column: 'bank_account', supports_case: false, multi_policy: 'error' },
  { key: 'bank_name', label_ru: 'Банк: наименование', kind: 'text', column: 'bank_name', supports_case: false, multi_policy: 'error' },
  { key: 'bank_code', label_ru: 'Банк: код', kind: 'text', column: 'bank_code', supports_case: false, multi_policy: 'error' },
];
