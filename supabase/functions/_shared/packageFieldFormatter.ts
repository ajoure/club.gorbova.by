// ============================================================================
// packageFieldFormatter.ts — Sprint 3J · Parity SOT.
//
// Единый formatter для пакетных плейсхолдеров `{{package.(ul|ip|fl).FLD-…}}`.
// ПЕРЕИСПОЛЬЗУЕТ те же helpers, что и billing-резолвер
// (typed-tokens-resolver.ts), чтобы значение package-токена побайтово
// совпадало с биллинговым аналогом.
//
// Входы:
//   • formatPackageUlField(tech_key, client_legal_details_row)
//   • formatPackageIpField(tech_key, client_legal_details_row)
//   • formatPackageFlField(tech_key, legal_details_persons_row)
//
// Возврат: всегда строка (пустая, если значения нет).
// ПОВЕДЕНИЕ ДЛЯ unknown tech_key — fallback raw read (никогда не падаем),
// но это диагностический случай, в orchestrator такой kech_key не приходит.
//
// Жёсткие правила:
//   • Никаких новых formatter-функций — только импорт уже существующих
//     billing helpers (canonicalizeLegalEntity, formatEntrepreneurDisplayName,
//     fullNameToInitials, formatStructuredAddress, normalizeMasculinePosition).
//   • Никакого двойного формирования: если raw уже содержит «ЗАО «Foo»» —
//     canonicalizeLegalEntity вернёт идемпотентный результат.
//   • Адрес FULL для UL/IP/FL рендерится через formatStructuredAddress
//     с legacy-fallback (та же логика, что customer.{leg|ent|ind}.address.full).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import {
  canonicalizeLegalEntity,
  formatEntrepreneurDisplayName,
  fullNameToInitials,
} from "./typed-tokens-resolver.ts";
import { formatStructuredAddress } from "./address-format.ts";
import { normalizeMasculinePosition } from "./ru-inflection.ts";

// ---------- UL (Юридическое лицо) ------------------------------------------

function ulCanon(row: any) {
  return canonicalizeLegalEntity(
    row?.leg_org_form,
    row?.leg_name,
    row?.leg_short_name || row?.leg_full_name,
  );
}

const UL_HANDLERS: Record<string, (row: any) => string> = {
  "package.ul.name": (r) => ulCanon(r).name,
  "package.ul.short_name": (r) => ulCanon(r).short_name,
  "package.ul.org_form": (r) => ulCanon(r).org_form,
  "package.ul.full_name": (r) => ulCanon(r).full_name,
  "package.ul.unp": (r) => str(r?.leg_unp),
  "package.ul.address_full": (r) => {
    const struct = r?.leg_address_structured || null;
    return formatStructuredAddress(struct, r?.leg_address || null, "legal_entity").rendered;
  },
  "package.ul.director_full_name": (r) => str(r?.leg_director_name),
  "package.ul.director_short_name": (r) => fullNameToInitials(r?.leg_director_name),
  "package.ul.director_position": (r) => normalizeMasculinePosition(str(r?.leg_director_position)),
  "package.ul.acts_on_basis": (r) => str(r?.leg_acts_on_basis),
  "package.ul.bank_name": (r) => str(r?.bank_name),
  "package.ul.bank_code": (r) => str(r?.bank_code),
  "package.ul.bank_account": (r) => str(r?.bank_account),
  "package.ul.phone": (r) => str(r?.phone),
  "package.ul.email": (r) => str(r?.email),
  "package.ul.address_street": (r) => readJsonPart(r?.leg_address_structured, "street"),
  "package.ul.address_house": (r) => readJsonPart(r?.leg_address_structured, "house"),
  "package.ul.address_building": (r) => readJsonPart(r?.leg_address_structured, "building"),
  "package.ul.address_apartment": (r) => readJsonPart(r?.leg_address_structured, "apartment"),
  "package.ul.address_city": (r) => readJsonPart(r?.leg_address_structured, "city"),
  "package.ul.address_region": (r) => readJsonPart(r?.leg_address_structured, "region"),
  "package.ul.address_postal_code": (r) => readJsonPart(r?.leg_address_structured, "postal_code"),
  "package.ul.address_country": (r) => readJsonPart(r?.leg_address_structured, "country"),
};

// ---------- IP (Индивидуальный предприниматель) ----------------------------

const IP_HANDLERS: Record<string, (row: any) => string> = {
  "package.ip.name": (r) => formatEntrepreneurDisplayName(r?.ent_name),
  "package.ip.short_name": (r) => {
    const raw = str(r?.ent_name);
    if (!raw) return "";
    const cleaned = raw.replace(/^ИП\s*/i, "").replace(/[«»"']/g, "").trim();
    const initials = fullNameToInitials(cleaned);
    return initials ? `ИП ${initials}` : "";
  },
  "package.ip.unp": (r) => str(r?.ent_unp),
  "package.ip.address_full": (r) => {
    const struct = r?.ent_address_structured || null;
    return formatStructuredAddress(struct, r?.ent_address || null, "entrepreneur").rendered;
  },
  "package.ip.acts_on_basis": (r) => str(r?.ent_acts_on_basis),
  "package.ip.bank_name": (r) => str(r?.bank_name),
  "package.ip.bank_code": (r) => str(r?.bank_code),
  "package.ip.bank_account": (r) => str(r?.bank_account),
  "package.ip.phone": (r) => str(r?.phone),
  "package.ip.email": (r) => str(r?.email),
  "package.ip.address_street": (r) => readJsonPart(r?.ent_address_structured, "street"),
  "package.ip.address_house": (r) => readJsonPart(r?.ent_address_structured, "house"),
  "package.ip.address_building": (r) => readJsonPart(r?.ent_address_structured, "building"),
  "package.ip.address_apartment": (r) => readJsonPart(r?.ent_address_structured, "apartment"),
  "package.ip.address_city": (r) => readJsonPart(r?.ent_address_structured, "city"),
  "package.ip.address_region": (r) => readJsonPart(r?.ent_address_structured, "region"),
  "package.ip.address_postal_code": (r) => readJsonPart(r?.ent_address_structured, "postal_code"),
  "package.ip.address_country": (r) => readJsonPart(r?.ent_address_structured, "country"),
};

// ---------- FL (Физическое лицо) -------------------------------------------

const FL_HANDLERS: Record<string, (row: any) => string> = {
  "package.fl.full_name": (p) => str(p?.full_name),
  "package.fl.full_name_short": (p) => fullNameToInitials(p?.full_name),
  "package.fl.birth_date": (p) => str(p?.birth_date),
  "package.fl.personal_number": (p) => str(p?.personal_number),
  "package.fl.passport_series": (p) => str(p?.passport_series),
  "package.fl.passport_number": (p) => str(p?.passport_number),
  "package.fl.passport_number_full": (p) => {
    const s = str(p?.passport_series);
    const n = str(p?.passport_number);
    if (!s && !n) return "";
    return `${s}${n}`;
  },
  "package.fl.passport_issued_by": (p) => str(p?.passport_issued_by),
  "package.fl.passport_issued_date": (p) => str(p?.passport_issued_date),
  "package.fl.passport_valid_until": (p) => str(p?.passport_valid_until),
  "package.fl.phone": (p) => str(p?.phone),
  "package.fl.email": (p) => str(p?.email),
  "package.fl.address_street": (p) => readJsonPart(p?.address_structured, "street"),
  "package.fl.address_house": (p) => readJsonPart(p?.address_structured, "house"),
  "package.fl.address_apartment": (p) => readJsonPart(p?.address_structured, "apartment"),
  "package.fl.address_city": (p) => readJsonPart(p?.address_structured, "city"),
  "package.fl.address_region": (p) => readJsonPart(p?.address_structured, "region"),
  "package.fl.address_district": (p) => readJsonPart(p?.address_structured, "district"),
  "package.fl.address_postal_code": (p) => readJsonPart(p?.address_structured, "postal_code"),
  "package.fl.bank_account": (p) => str(p?.bank_account),
  "package.fl.bank_name": (p) => str(p?.bank_name),
  "package.fl.bank_code": (p) => str(p?.bank_code),
};

// ---------- Public API -----------------------------------------------------

export function formatPackageUlField(techKey: string, row: any): string {
  const h = UL_HANDLERS[techKey];
  return h ? h(row || {}) : "";
}

export function formatPackageIpField(techKey: string, row: any): string {
  const h = IP_HANDLERS[techKey];
  return h ? h(row || {}) : "";
}

export function formatPackageFlField(techKey: string, person: any): string {
  const h = FL_HANDLERS[techKey];
  return h ? h(person || {}) : "";
}

/**
 * Универсальная точка входа для orchestrator.
 * Возвращает '' для unknown tech_key — orchestrator уже отфильтровал такие
 * случаи через findByPackageToken/copy_ready.
 */
export function formatPackageFieldValue(
  techKey: string,
  group: "package_ul" | "package_ip" | "package_fl",
  row: any,
): string {
  if (group === "package_ul") return formatPackageUlField(techKey, row);
  if (group === "package_ip") return formatPackageIpField(techKey, row);
  return formatPackageFlField(techKey, row);
}

// ---------- Helpers --------------------------------------------------------

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function readJsonPart(struct: unknown, key: string): string {
  if (!struct || typeof struct !== "object") return "";
  const v = (struct as Record<string, unknown>)[key];
  return v == null ? "" : String(v);
}
