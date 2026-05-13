// ============================================================================
// typed-tokens-resolver.ts — v3 typed namespace resolver
// ----------------------------------------------------------------------------
// Заполняет 148 типизированных токенов:
//   customer.{ind,leg,ent}.* и executor.{ind,leg,ent}.*
//
// Источники:
//   - customer = client_legal_details row (legacy SOT в renderer'е)
//   - executor = executors row
//
// Правила:
//   - typed-токен заполняется ТОЛЬКО если subject совпадает с типом плательщика
//     (customer.ind.* активен только при client_type='individual', и т.д.).
//   - ИП name/short_name всегда оборачивается через formatEntrepreneurDisplayName:
//     `ИП Федорчук Сергей Валерьевич` (без кавычек вокруг ФИО).
//   - ИП руководитель: дефолт = ФИО ИП + "Индивидуальный предприниматель";
//     override через input.overrides.
//   - Address parts читаются из *_address_structured jsonb.
//   - address.full = formatStructuredAddress (с whitelist Минск/облцентры).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { formatStructuredAddress } from "./address-format.ts";

const ADDR_PARTS = [
  "street", "house", "building", "apartment",
  "city", "district", "city_district", "region",
  "postal_code", "country",
];

function fullNameToInitials(fullName?: string | null): string {
  if (!fullName) return "";
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}. ${parts[2][0]}.`;
}

/**
 * Удаляет кавычки вокруг ФИО ИП и оборачивает в «ИП ».
 * Никогда не оборачивает в кавычки (в отличие от ЮЛ).
 *
 * Примеры:
 *   "Федорчук Сергей Валерьевич"            → ИП Федорчук Сергей Валерьевич
 *   "ИП \"Федорчук Сергей Валерьевич\""     → ИП Федорчук Сергей Валерьевич
 *   "ИП Федорчук Сергей Валерьевич"          → ИП Федорчук Сергей Валерьевич
 *   ""                                       → ""
 */
export function formatEntrepreneurDisplayName(name?: string | null): string {
  if (!name) return "";
  let n = String(name).trim();
  // Убираем префикс ИП/И.П. в любом регистре, чтобы не дублировать.
  n = n.replace(/^(ИП|И\.\s*П\.|ип|i\.p\.|ip)\s*/i, "");
  // Снимаем все виды кавычек по краям (русские, латинские, ASCII).
  n = n.replace(/^[«"'„‟"']+|[»"'""']+$/g, "").trim();
  return n ? `ИП ${n}` : "";
}

function readAddressPart(struct: any, part: string): string {
  if (!struct || typeof struct !== "object") return "";
  // Минск/облцентры: district/city_district/region не показываем.
  // Но это касается только rendered «full»; запрошенные явно части возвращаем как есть.
  const v = struct[part];
  return v == null ? "" : String(v);
}

function setIfBlank(map: Record<string, string>, key: string, value: string) {
  if (!(key in map) || map[key] === "" || map[key] == null) {
    map[key] = value ?? "";
  }
}

function fillIndCustomer(map: Record<string, string>, ld: any) {
  const isInd = ld?.client_type === "individual";
  const fullName = isInd ? (ld?.ind_full_name || "") : "";
  const series = isInd ? (ld?.ind_passport_series || "") : "";
  const number = isInd ? (ld?.ind_passport_number || "") : "";
  const struct = isInd ? (ld?.ind_address_structured || null) : null;
  const addrFull = isInd
    ? formatStructuredAddress(struct, ld?.ind_address || null, "individual").rendered
    : "";

  map["customer.ind.full_name"] = fullName;
  map["customer.ind.full_name_short"] = isInd ? fullNameToInitials(fullName) : "";
  map["customer.ind.birth_date"] = isInd ? (ld?.ind_birth_date || "") : "";
  map["customer.ind.personal_number"] = isInd ? (ld?.ind_personal_number || "") : "";
  map["customer.ind.passport_series"] = series;
  map["customer.ind.passport_number"] = number;
  map["customer.ind.passport_number_full"] = isInd && (series || number) ? `${series}${number}` : "";
  map["customer.ind.passport_issued_by"] = isInd ? (ld?.ind_passport_issued_by || "") : "";
  map["customer.ind.passport_issued_date"] = isInd ? (ld?.ind_passport_issued_date || "") : "";
  map["customer.ind.passport_valid_until"] = isInd ? (ld?.ind_passport_valid_until || "") : "";

  map["customer.ind.address.full"] = addrFull;
  for (const p of ADDR_PARTS) {
    if (p === "street" || p === "house" || p === "apartment" || p === "city" || p === "postal_code" || p === "district" || p === "region") {
      // legacy ind_address_* колонки fallback
      const legacyKey: Record<string, string> = {
        street: "ind_address_street",
        house: "ind_address_house",
        apartment: "ind_address_apartment",
        city: "ind_address_city",
        postal_code: "ind_address_index",
        district: "ind_address_district",
        region: "ind_address_region",
      };
      const partVal = readAddressPart(struct, p) || (isInd ? (ld?.[legacyKey[p]] || "") : "");
      map[`customer.ind.address.${p}`] = partVal;
    } else {
      map[`customer.ind.address.${p}`] = isInd ? readAddressPart(struct, p) : "";
    }
  }

  map["customer.ind.bank_account"] = isInd ? (ld?.bank_account || "") : "";
  map["customer.ind.bank_name"] = isInd ? (ld?.bank_name || "") : "";
  map["customer.ind.bank_code"] = isInd ? (ld?.bank_code || "") : "";
  map["customer.ind.phone"] = isInd ? (ld?.phone || "") : "";
  map["customer.ind.email"] = isInd ? (ld?.email || "") : "";
}

function fillLegCustomer(map: Record<string, string>, ld: any) {
  const isLeg = ld?.client_type === "legal_entity";
  const struct = isLeg ? (ld?.leg_address_structured || null) : null;
  const addrFull = isLeg
    ? formatStructuredAddress(struct, ld?.leg_address || null, "legal_entity").rendered
    : "";
  const dirFull = isLeg ? (ld?.leg_director_name || "") : "";

  map["customer.leg.org_form"] = isLeg ? (ld?.leg_org_form || "") : "";
  map["customer.leg.name"] = isLeg ? (ld?.leg_name || "") : "";
  map["customer.leg.short_name"] = isLeg ? (ld?.leg_short_name || ld?.leg_name || "") : "";
  map["customer.leg.unp"] = isLeg ? (ld?.leg_unp || "") : "";
  map["customer.leg.director_position"] = isLeg ? (ld?.leg_director_position || "") : "";
  map["customer.leg.director_full_name"] = dirFull;
  map["customer.leg.director_short_name"] = isLeg ? fullNameToInitials(dirFull) : "";
  map["customer.leg.acts_on_basis"] = isLeg ? (ld?.leg_acts_on_basis || "") : "";

  map["customer.leg.address.full"] = addrFull;
  for (const p of ADDR_PARTS) {
    map[`customer.leg.address.${p}`] = isLeg ? readAddressPart(struct, p) : "";
  }

  map["customer.leg.bank_account"] = isLeg ? (ld?.bank_account || "") : "";
  map["customer.leg.bank_name"] = isLeg ? (ld?.bank_name || "") : "";
  map["customer.leg.bank_code"] = isLeg ? (ld?.bank_code || "") : "";
  map["customer.leg.phone"] = isLeg ? (ld?.phone || "") : "";
  map["customer.leg.email"] = isLeg ? (ld?.email || "") : "";
}

function fillEntCustomer(map: Record<string, string>, ld: any) {
  const isEnt = ld?.client_type === "entrepreneur";
  const struct = isEnt ? (ld?.ent_address_structured || null) : null;
  const addrFull = isEnt
    ? formatStructuredAddress(struct, ld?.ent_address || null, "entrepreneur").rendered
    : "";
  const rawName = isEnt ? (ld?.ent_name || "") : "";
  // ВАЖНО: ИП без кавычек.
  const displayName = isEnt ? formatEntrepreneurDisplayName(rawName) : "";
  const shortName = isEnt ? (rawName ? `ИП ${fullNameToInitials(rawName.replace(/^ИП\s*/i, "").replace(/[«»"']/g, ""))}` : "") : "";

  map["customer.ent.name"] = displayName;
  map["customer.ent.short_name"] = shortName;
  map["customer.ent.unp"] = isEnt ? (ld?.ent_unp || "") : "";
  map["customer.ent.acts_on_basis"] = isEnt ? (ld?.ent_acts_on_basis || "") : "";

  // Руководитель ИП: дефолт = сам ИП.
  // Override может быть подан через input.overrides позже.
  const dirFullName = rawName ? rawName.replace(/^ИП\s*/i, "").replace(/[«»"']/g, "").trim() : "";
  map["customer.ent.director_position"] = isEnt ? "Индивидуальный предприниматель" : "";
  map["customer.ent.director_full_name"] = isEnt ? dirFullName : "";
  map["customer.ent.director_short_name"] = isEnt ? fullNameToInitials(dirFullName) : "";
  map["customer.ent.director_acts_on_basis"] = isEnt ? (ld?.ent_acts_on_basis || "Свидетельства о государственной регистрации") : "";

  map["customer.ent.address.full"] = addrFull;
  for (const p of ADDR_PARTS) {
    map[`customer.ent.address.${p}`] = isEnt ? readAddressPart(struct, p) : "";
  }

  map["customer.ent.bank_account"] = isEnt ? (ld?.bank_account || "") : "";
  map["customer.ent.bank_name"] = isEnt ? (ld?.bank_name || "") : "";
  map["customer.ent.bank_code"] = isEnt ? (ld?.bank_code || "") : "";
  map["customer.ent.phone"] = isEnt ? (ld?.phone || "") : "";
  map["customer.ent.email"] = isEnt ? (ld?.email || "") : "";
}

function fillIndExecutor(map: Record<string, string>, ex: any) {
  // executor у нас всегда юр.лицо в текущей модели, но сохраняем зеркало,
  // чтобы шаблоны не падали. Если в будущем executor станет ФЛ — заполнится.
  const isInd = ex?.subject_type === "individual";
  const fullName = isInd ? (ex?.full_name || "") : "";
  map["executor.ind.full_name"] = fullName;
  map["executor.ind.full_name_short"] = isInd ? fullNameToInitials(fullName) : "";
  map["executor.ind.birth_date"] = "";
  map["executor.ind.personal_number"] = "";
  map["executor.ind.passport_series"] = "";
  map["executor.ind.passport_number"] = "";
  map["executor.ind.passport_number_full"] = "";
  map["executor.ind.passport_issued_by"] = "";
  map["executor.ind.passport_issued_date"] = "";
  map["executor.ind.passport_valid_until"] = "";
  map["executor.ind.address.full"] = "";
  for (const p of ADDR_PARTS) map[`executor.ind.address.${p}`] = "";
  map["executor.ind.bank_account"] = isInd ? (ex?.bank_account || "") : "";
  map["executor.ind.bank_name"] = isInd ? (ex?.bank_name || "") : "";
  map["executor.ind.bank_code"] = isInd ? (ex?.bank_code || "") : "";
  map["executor.ind.phone"] = isInd ? (ex?.phone || "") : "";
  map["executor.ind.email"] = isInd ? (ex?.email || "") : "";
}

function fillLegExecutor(map: Record<string, string>, ex: any) {
  const isLeg = !ex?.subject_type || ex?.subject_type === "legal_entity";
  const struct = isLeg ? (ex?.legal_address_structured || null) : null;
  const addrFull = isLeg
    ? formatStructuredAddress(struct, ex?.legal_address || null, "legal_entity").rendered
    : "";
  const dirFull = isLeg ? (ex?.director_full_name || "") : "";

  map["executor.leg.org_form"] = isLeg ? (ex?.org_form || "") : "";
  map["executor.leg.name"] = isLeg ? (ex?.full_name || "") : "";
  map["executor.leg.short_name"] = isLeg ? (ex?.short_name || ex?.full_name || "") : "";
  map["executor.leg.unp"] = isLeg ? (ex?.unp || "") : "";
  map["executor.leg.director_position"] = isLeg ? (ex?.director_position || "") : "";
  map["executor.leg.director_full_name"] = dirFull;
  map["executor.leg.director_short_name"] = isLeg ? (ex?.director_short_name || fullNameToInitials(dirFull)) : "";
  map["executor.leg.acts_on_basis"] = isLeg ? (ex?.acts_on_basis || "") : "";

  map["executor.leg.address.full"] = addrFull;
  for (const p of ADDR_PARTS) {
    map[`executor.leg.address.${p}`] = isLeg ? readAddressPart(struct, p) : "";
  }

  map["executor.leg.bank_account"] = isLeg ? (ex?.bank_account || "") : "";
  map["executor.leg.bank_name"] = isLeg ? (ex?.bank_name || "") : "";
  map["executor.leg.bank_code"] = isLeg ? (ex?.bank_code || "") : "";
  map["executor.leg.phone"] = isLeg ? (ex?.phone || "") : "";
  map["executor.leg.email"] = isLeg ? (ex?.email || "") : "";
}

function fillEntExecutor(map: Record<string, string>, ex: any) {
  const isEnt = ex?.subject_type === "entrepreneur";
  const struct = isEnt ? (ex?.legal_address_structured || null) : null;
  const addrFull = isEnt
    ? formatStructuredAddress(struct, ex?.legal_address || null, "entrepreneur").rendered
    : "";
  const rawName = isEnt ? (ex?.full_name || "") : "";
  const displayName = isEnt ? formatEntrepreneurDisplayName(rawName) : "";
  const dirFullName = rawName ? rawName.replace(/^ИП\s*/i, "").replace(/[«»"']/g, "").trim() : "";

  map["executor.ent.name"] = displayName;
  map["executor.ent.short_name"] = isEnt && rawName ? `ИП ${fullNameToInitials(dirFullName)}` : "";
  map["executor.ent.unp"] = isEnt ? (ex?.unp || "") : "";
  map["executor.ent.acts_on_basis"] = isEnt ? (ex?.acts_on_basis || "") : "";
  map["executor.ent.director_position"] = isEnt ? "Индивидуальный предприниматель" : "";
  map["executor.ent.director_full_name"] = isEnt ? dirFullName : "";
  map["executor.ent.director_short_name"] = isEnt ? fullNameToInitials(dirFullName) : "";
  map["executor.ent.director_acts_on_basis"] = isEnt ? (ex?.acts_on_basis || "Свидетельства о государственной регистрации") : "";

  map["executor.ent.address.full"] = addrFull;
  for (const p of ADDR_PARTS) {
    map[`executor.ent.address.${p}`] = isEnt ? readAddressPart(struct, p) : "";
  }

  map["executor.ent.bank_account"] = isEnt ? (ex?.bank_account || "") : "";
  map["executor.ent.bank_name"] = isEnt ? (ex?.bank_name || "") : "";
  map["executor.ent.bank_code"] = isEnt ? (ex?.bank_code || "") : "";
  map["executor.ent.phone"] = isEnt ? (ex?.phone || "") : "";
  map["executor.ent.email"] = isEnt ? (ex?.email || "") : "";
}

function fillExecutorSigner(map: Record<string, string>, ex: any) {
  // executor.signer.* — на текущий момент derive из director_*; точечный override —
  // через input.overrides.
  const dirFull = ex?.director_full_name || "";
  map["executor.signer.position"] = ex?.director_position || "";
  map["executor.signer.full_name"] = dirFull;
  map["executor.signer.initials"] = ex?.director_short_name || fullNameToInitials(dirFull);
  map["executor.signer.basis"] = ex?.acts_on_basis || "";
}

/**
 * Заполняет 148 typed + 4 executor.signer токена.
 * Возвращает плоский объект для слияния в resolverValues.
 */
export function buildTypedNamespaceValues(customer: any, executor: any): Record<string, string> {
  const map: Record<string, string> = {};
  fillIndCustomer(map, customer);
  fillLegCustomer(map, customer);
  fillEntCustomer(map, customer);
  fillIndExecutor(map, executor);
  fillLegExecutor(map, executor);
  fillEntExecutor(map, executor);
  fillExecutorSigner(map, executor);
  return map;
}

/**
 * Перезапись dynamic customer.name / executor.name для ИП — без кавычек.
 * Применяется ПОВЕРХ существующих значений в resolverValues.
 */
export function applyEntrepreneurNameWithoutQuotes(
  resolverValues: Record<string, string>,
  customer: any,
  executor: any,
) {
  if (customer?.client_type === "entrepreneur") {
    const display = formatEntrepreneurDisplayName(customer?.ent_name || "");
    if (display) {
      resolverValues["customer.name"] = display;
      resolverValues["customer.short_name"] = display;
    }
  }
  if (executor?.subject_type === "entrepreneur") {
    const display = formatEntrepreneurDisplayName(executor?.full_name || "");
    if (display) {
      resolverValues["executor.name"] = display;
      resolverValues["executor.short_name"] = display;
    }
  }
}
