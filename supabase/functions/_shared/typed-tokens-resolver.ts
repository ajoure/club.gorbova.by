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
import {
  ORG_FORM_SHORT_TO_FULL,
  ORG_FORM_FULL_TO_SHORT,
  normalizeMasculinePosition,
} from "./ru-inflection.ts";

const ADDR_PARTS = [
  "street", "house", "building", "apartment",
  "city", "district", "city_district", "region",
  "postal_code", "country",
];

// Известные формы собственности — для очистки имени от ведущего токена формы.
const ORG_FORM_SHORTS = new Set(Object.keys(ORG_FORM_SHORT_TO_FULL));
// Полные формы (lowercase), отсортированные от длинных к коротким для greedy-match.
const ORG_FORM_FULLS_SORTED = Object.keys(ORG_FORM_FULL_TO_SHORT).sort(
  (a, b) => b.length - a.length,
);

/**
 * Извлекает 3 канонических компонента ЮЛ из имеющихся полей.
 * Источник: явный org_form имеет приоритет; иначе пытаемся выделить из full_name.
 * Имя всегда чистое (без формы и без любых кавычек).
 *
 * Примеры:
 *   ("ЗАО", "АЖУР инкам", null)               → { org_form:"ЗАО", name:"АЖУР инкам", short:'ЗАО «АЖУР инкам»' }
 *   (null, 'ООО "Ромашка"', null)             → { org_form:"ООО", name:"Ромашка",    short:'ООО «Ромашка»' }
 *   (null, null, 'ООО «Ромашка»')             → { org_form:"ООО", name:"Ромашка",    short:'ООО «Ромашка»' }
 *   ("ИП", "Горбова Е. А.", null)             → { org_form:"ИП",  name:"Горбова Е. А.", short:'ИП Горбова Е. А.' }
 */
export function canonicalizeLegalEntity(
  rawOrgForm: string | null | undefined,
  rawName: string | null | undefined,
  rawFullName?: string | null | undefined,
): { org_form: string; name: string; short_name: string; full_name: string } {
  const stripQuotes = (s: string) =>
    s.replace(/^[«"'„‟"']+|[»"'""']+$/g, "").trim();

  let orgForm = (rawOrgForm ?? "").toString().trim();
  let nameRaw = (rawName ?? "").toString().trim();

  // source — то, откуда будем извлекать orgForm/name, если они не заданы явно.
  const source = nameRaw || (rawFullName ?? "").toString().trim();
  let strippedSource = source;

  // 1) Если orgForm пуст — пробуем выделить КОРОТКУЮ форму из первого слова.
  if (!orgForm && source) {
    const head = source.split(/\s+/)[0]?.replace(/[«»"'„‟"']/g, "").toUpperCase() ?? "";
    if (ORG_FORM_SHORTS.has(head)) {
      orgForm = head;
    }
  }

  // 2) Если всё ещё пуст — пробуем распознать ПОЛНУЮ форму
  //    («Закрытое акционерное общество ...» → ЗАО).
  if (!orgForm && source) {
    const sourceLc = source.toLowerCase();
    for (const fullLc of ORG_FORM_FULLS_SORTED) {
      if (sourceLc.startsWith(fullLc + " ") || sourceLc === fullLc) {
        orgForm = ORG_FORM_FULL_TO_SHORT[fullLc];
        // Отрезаем полную форму из source, чтобы дальше остался только name.
        strippedSource = source.slice(fullLc.length).trim();
        break;
      }
    }
  }

  // 3) nameClean: если есть явный rawName — берём его; иначе из (возможно
  //    обрезанного) source. И снимаем ведущую короткую форму, если она
  //    дублирует orgForm.
  // Если мы обрезали полную форму из source, и source брался из nameRaw,
  // то и nameClean должен идти от strippedSource (без полной формы).
  let nameClean = strippedSource && strippedSource !== source ? strippedSource : (nameRaw || strippedSource);
  if (nameClean && orgForm) {
    const reShort = new RegExp(`^${orgForm}\\s+`, "i");
    nameClean = nameClean.replace(reShort, "");
    const fullLc = ORG_FORM_SHORT_TO_FULL[orgForm.toUpperCase()];
    if (fullLc) {
      const reFull = new RegExp(`^${fullLc}\\s+`, "i");
      nameClean = nameClean.replace(reFull, "");
    }
  }
  nameClean = stripQuotes(nameClean).trim();
  nameClean = stripQuotes(nameClean).trim();

  // ИП — без кавычек; ЮЛ — в «…».
  const orgUp = orgForm.toUpperCase();
  let short = "";
  let full = "";
  if (nameClean) {
    if (orgUp === "ИП") {
      short = orgForm ? `${orgForm} ${nameClean}` : nameClean;
      full = `${ORG_FORM_SHORT_TO_FULL["ИП"]} ${nameClean}`;
    } else if (orgForm) {
      short = `${orgForm} «${nameClean}»`;
      full = `${ORG_FORM_SHORT_TO_FULL[orgUp] ?? orgForm} «${nameClean}»`;
    } else {
      short = `«${nameClean}»`;
      full = `«${nameClean}»`;
    }
  }

  return { org_form: orgForm, name: nameClean, short_name: short, full_name: full };
}


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

  const canon = isLeg
    ? canonicalizeLegalEntity(ld?.leg_org_form, ld?.leg_name, ld?.leg_short_name || ld?.leg_full_name)
    : { org_form: "", name: "", short_name: "", full_name: "" };

  map["customer.leg.org_form"] = canon.org_form;
  map["customer.leg.name"] = canon.name;
  map["customer.leg.short_name"] = canon.short_name;
  map["customer.leg.unp"] = isLeg ? (ld?.leg_unp || "") : "";
  map["customer.leg.director_position"] = isLeg ? normalizeMasculinePosition(ld?.leg_director_position || "") : "";
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

  // Руководитель ИП: дефолт = сам ИП. Override приходит через
  // legal_entities_requisites.data.ent_director_* / ent_acts_on_basis_override
  // (UI «Руководитель / Подписант» в форме ИП).
  const defaultDirFull = rawName ? rawName.replace(/^ИП\s*/i, "").replace(/[«»"']/g, "").trim() : "";
  const defaultDirShort = fullNameToInitials(defaultDirFull);
  const overrideDirPos = (ld?.ent_director_position || "").toString().trim();
  const overrideDirFull = (ld?.ent_director_full_name || "").toString().trim();
  const overrideDirShort = (ld?.ent_director_short_name || "").toString().trim();
  const overrideActs = (ld?.ent_acts_on_basis_override || "").toString().trim();
  map["customer.ent.director_position"] = isEnt ? (overrideDirPos || "Индивидуальный предприниматель") : "";
  map["customer.ent.director_full_name"] = isEnt ? (overrideDirFull || defaultDirFull) : "";
  map["customer.ent.director_short_name"] = isEnt ? (overrideDirShort || defaultDirShort) : "";
  map["customer.ent.director_acts_on_basis"] = isEnt ? (overrideActs || ld?.ent_acts_on_basis || "Свидетельства о государственной регистрации") : "";

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

// fillIndExecutor — УДАЛЁН в B-97 (postponed: нет SOT в `executors` для ФЛ).
// Будет восстановлен в отдельном спринте «Executor requisites schema expansion».



function fillLegExecutor(map: Record<string, string>, ex: any) {
  // executor.leg.* — 24 токена с org_form. Если в `executors` нет явного
  // org_form — пытаемся выделить из full_name (canonicalizeLegalEntity).
  const isLeg = !ex?.subject_type || ex?.subject_type === "legal_entity";
  const struct = isLeg ? (ex?.legal_address_structured || null) : null;
  const addrFull = isLeg
    ? formatStructuredAddress(struct, ex?.legal_address || null, "legal_entity").rendered
    : "";
  const dirFull = isLeg ? (ex?.director_full_name || "") : "";

  const canon = isLeg
    ? canonicalizeLegalEntity(ex?.org_form, ex?.name, ex?.short_name || ex?.full_name)
    : { org_form: "", name: "", short_name: "", full_name: "" };

  map["executor.leg.org_form"] = canon.org_form;
  map["executor.leg.name"] = canon.name;
  map["executor.leg.short_name"] = canon.short_name;
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

// fillEntExecutor — УДАЛЁН в B-97 (postponed: нет SOT в `executors` для ИП).
// Будет восстановлен в отдельном спринте «Executor requisites schema expansion».



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
 * Заполняет typed-токены B-97 scope (97 покрытых SOT):
 * - customer.ind.* (26), customer.leg.* (24), customer.ent.* (24)
 * - executor.leg.* без org_form (23)
 * + 4 executor.signer.* (technical override).
 *
 * НЕ заполняет (postponed, нет SOT в `executors`):
 * - executor.ind.* (26), executor.ent.* (24), executor.leg.org_form (1)
 * Пустые branch'и для них удалены намеренно — postponed-токены должны
 * проявляться как «нет источника данных», а не как «зарезолвлено пустым».
 */
export function buildTypedNamespaceValues(customer: any, executor: any): Record<string, string> {
  const map: Record<string, string> = {};
  fillIndCustomer(map, customer);
  fillLegCustomer(map, customer);
  fillEntCustomer(map, customer);
  fillLegExecutor(map, executor);
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
