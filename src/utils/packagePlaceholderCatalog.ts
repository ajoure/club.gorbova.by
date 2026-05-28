/**
 * Sprint 3D — Package placeholder catalog (UL/IP/FL).
 *
 * Архитектура (см. .lovable/plan.md §0):
 *   Одна база реквизитов + два разных контекста выбора + отдельный package resolver.
 *
 *   Billing source path: orders_v2 / customer / executor (НЕ используется здесь)
 *   Package source path: document_package_sessions / document_package_session_participants
 *
 * SOT катологa: статический фронтенд-каталог, никаких записей в БД.
 * Каждый item ссылается на существующий FLD (`reuse_existing_field_definition`)
 * либо явно помечен `pending_field` / `missing_source_column` / `deferred`.
 *
 * Copy-token syntax (Variant B, approved Sprint 3D §5):
 *   {{package.ul.FLD-XXXXXX}}   — Пакет: ЮЛ
 *   {{package.ip.FLD-XXXXXX}}   — Пакет: ИП
 *   {{package.fl.FLD-XXXXXX}}   — Пакет: ФЛ
 *
 * Биллинговый {{field:FLD-XXXXXX}} в пакетных группах НЕ используется
 * как copy-ready: он резолвится через billing context и подставит
 * заказчика заказа, а не компанию/лицо пакета.
 */

export type PackageGroupId = "package_ul" | "package_ip" | "package_fl" | "package_roles";

export type PackagePlaceholderStatus =
  | "source_available"
  | "copy_ready"
  | "pending_field"
  | "missing_source_column"
  | "deferred";

export interface PackagePlaceholderItem {
  /** Группа в UI: «Пакет: ЮЛ» / «Пакет: ИП» / «Пакет: ФЛ». */
  groupId: PackageGroupId;
  /** Русский label, идентичный билинговому (зеркало). */
  label_ru: string;
  /** Источник: таблица package context. */
  source_table: "client_legal_details" | "legal_details_persons" | null;
  /** Путь резолвера в виде описания (для debug-колонки super_admin). */
  source_path: string | null;
  /** Биллинговый FLD-аналог (если есть) — только для reference. */
  billing_fld_analog: string | null;
  /** Существующий FLD-определение, которое переиспользуется (label/type/mapping). */
  reused_fld: string | null;
  /** Готовый copy-токен (только для status='copy_ready'). */
  package_token: string | null;
  /** Подсказка резолвера (для proof + debug). */
  package_resolver_hint: string;
  /** Статус видимости/копирования в UI. */
  status: PackagePlaceholderStatus;
  /** Технический ключ для поиска (не отображается обычному пользователю). */
  tech_key: string;
}

const SESSION_LE =
  "document_package_sessions.selected_legal_entity_id → client_legal_details";
const SESSION_PERSON =
  "document_package_session_participants.person_id → legal_details_persons (по role_key)";

function packageToken(group: PackageGroupId, fld: string): string {
  const prefix =
    group === "package_ul" ? "ul" : group === "package_ip" ? "ip" : "fl";
  return `{{package.${prefix}.${fld}}}`;
}

/**
 * Готовый copy_ready item.
 */
function ready(
  group: PackageGroupId,
  label_ru: string,
  billing_fld_analog: string,
  reused_fld: string,
  source_table: "client_legal_details" | "legal_details_persons",
  column: string,
  tech_key: string,
): PackagePlaceholderItem {
  return {
    groupId: group,
    label_ru,
    source_table,
    source_path: `${source_table}.${column}`,
    billing_fld_analog,
    reused_fld,
    package_token: packageToken(group, reused_fld),
    package_resolver_hint:
      source_table === "client_legal_details" ? SESSION_LE : SESSION_PERSON,
    status: "copy_ready",
    tech_key,
  };
}

/**
 * Sprint 3E: copy_ready item с jsonb-path source (например, `leg_address_structured->>'street'`).
 * Используется для адресных полей UL/IP/FL, которые хранятся только в JSONB
 * (`*_address_structured`). FLD-определение переиспользуется (label/type/mapping),
 * но package source path — это JSON-path, не плоская колонка.
 */
function readyJson(
  group: PackageGroupId,
  label_ru: string,
  billing_fld_analog: string,
  reused_fld: string,
  source_table: "client_legal_details" | "legal_details_persons",
  jsonColumn: string,
  jsonKey: string,
  tech_key: string,
): PackagePlaceholderItem {
  return {
    groupId: group,
    label_ru,
    source_table,
    source_path: `${source_table}.${jsonColumn}->>'${jsonKey}'`,
    billing_fld_analog,
    reused_fld,
    package_token: packageToken(group, reused_fld),
    package_resolver_hint:
      source_table === "client_legal_details" ? SESSION_LE : SESSION_PERSON,
    status: "copy_ready",
    tech_key,
  };
}

/**
 * Item помечен как deferred — есть колонка-источник, но FLD ещё не привязан
 * к package-контексту, или ждёт авторства реального шаблона.
 */
function deferred(
  group: PackageGroupId,
  label_ru: string,
  billing_fld_analog: string | null,
  status: "missing_source_column" | "pending_field" | "deferred",
  tech_key: string,
  note: string,
): PackagePlaceholderItem {
  return {
    groupId: group,
    label_ru,
    source_table: null,
    source_path: null,
    billing_fld_analog,
    reused_fld: null,
    package_token: null,
    package_resolver_hint: note,
    status,
    tech_key,
  };
}

/* =========================================================================
 * Пакет: ЮЛ — зеркало «Заказчик ЮЛ» (FLD-000323..346).
 * Источник: client_legal_details (leg_*, общие banking, phone, email).
 * ========================================================================= */
const PACKAGE_UL: PackagePlaceholderItem[] = [
  ready("package_ul", "Название", "FLD-000342", "FLD-000011",
    "client_legal_details", "leg_name", "package.ul.name"),
  ready("package_ul", "Краткое название", "FLD-000345", "FLD-000011",
    "client_legal_details", "leg_name", "package.ul.short_name"),
  ready("package_ul", "Форма собственности", "FLD-000343", "FLD-000010",
    "client_legal_details", "leg_org_form", "package.ul.org_form"),
  ready("package_ul", "УНП", "FLD-000346", "FLD-000009",
    "client_legal_details", "leg_unp", "package.ul.unp"),
  ready("package_ul", "Юридический адрес (полный)", "FLD-000330", "FLD-000012",
    "client_legal_details", "leg_address", "package.ul.address_full"),
  ready("package_ul", "Руководитель ФИО", "FLD-000338", "FLD-000014",
    "client_legal_details", "leg_director_name", "package.ul.director_full_name"),
  ready("package_ul", "Руководитель ФИО (кратко)", "FLD-000340", "FLD-000014",
    "client_legal_details", "leg_director_name", "package.ul.director_short_name"),
  ready("package_ul", "Руководитель должность", "FLD-000339", "FLD-000013",
    "client_legal_details", "leg_director_position", "package.ul.director_position"),
  ready("package_ul", "Действует на основании", "FLD-000323", "FLD-000015",
    "client_legal_details", "leg_acts_on_basis", "package.ul.acts_on_basis"),
  ready("package_ul", "Банк", "FLD-000337", "FLD-000005",
    "client_legal_details", "bank_name", "package.ul.bank_name"),
  ready("package_ul", "БИК / код банка", "FLD-000336", "FLD-000006",
    "client_legal_details", "bank_code", "package.ul.bank_code"),
  ready("package_ul", "Расчётный счёт / IBAN", "FLD-000335", "FLD-000004",
    "client_legal_details", "bank_account", "package.ul.bank_account"),
  ready("package_ul", "Телефон", "FLD-000344", "FLD-000007",
    "client_legal_details", "phone", "package.ul.phone"),
  ready("package_ul", "Email", "FLD-000341", "FLD-000008",
    "client_legal_details", "email", "package.ul.email"),
  // Sprint 3E: адресный breakdown ЮЛ — jsonb-path (плоских колонок НЕТ; SOT = leg_address_structured).
  readyJson("package_ul", "Адрес: улица", "FLD-000334", "FLD-000035",
    "client_legal_details", "leg_address_structured", "street", "package.ul.address_street"),
  readyJson("package_ul", "Адрес: дом", "FLD-000331", "FLD-000036",
    "client_legal_details", "leg_address_structured", "house", "package.ul.address_house"),
  readyJson("package_ul", "Адрес: корпус", "FLD-000325", "FLD-000037",
    "client_legal_details", "leg_address_structured", "building", "package.ul.address_building"),
  readyJson("package_ul", "Адрес: помещение/квартира", "FLD-000324", "FLD-000038",
    "client_legal_details", "leg_address_structured", "apartment", "package.ul.address_apartment"),
  readyJson("package_ul", "Адрес: населённый пункт", "FLD-000326", "FLD-000039",
    "client_legal_details", "leg_address_structured", "city", "package.ul.address_city"),
  readyJson("package_ul", "Адрес: область", "FLD-000333", "FLD-000040",
    "client_legal_details", "leg_address_structured", "region", "package.ul.address_region"),
  readyJson("package_ul", "Адрес: индекс", "FLD-000332", "FLD-000041",
    "client_legal_details", "leg_address_structured", "postal_code", "package.ul.address_postal_code"),
  readyJson("package_ul", "Адрес: страна", "FLD-000328", "FLD-000042",
    "client_legal_details", "leg_address_structured", "country", "package.ul.address_country"),
  // Район / район города: те же jsonb-ключи (district / city_district),
  // FLD под them в legal_details registry отсутствуют → pending_field (биллинг тоже без них).
  deferred("package_ul", "Адрес: район", "FLD-000329", "pending_field",
    "package.ul.address_district",
    "Источник есть: leg_address_structured->>'district'. FLD в fields_registry отсутствует — backlog (после manifest-proof)."),
  deferred("package_ul", "Адрес: район города", "FLD-000327", "pending_field",
    "package.ul.address_city_district",
    "Источник есть: leg_address_structured->>'city_district'. FLD в fields_registry отсутствует — backlog."),
];

/* =========================================================================
 * Пакет: ИП — зеркало «Заказчик ИП» (FLD-000273..296).
 * Источник: client_legal_details (ent_*, общие banking, phone, email).
 * Многие ent.address.* пока без отдельных колонок — есть только ent_address (полный).
 * ========================================================================= */
const PACKAGE_IP: PackagePlaceholderItem[] = [
  ready("package_ip", "ФИО", "FLD-000293", "FLD-000017",
    "client_legal_details", "ent_name", "package.ip.name"),
  ready("package_ip", "ФИО (кратко)", "FLD-000295", "FLD-000017",
    "client_legal_details", "ent_name", "package.ip.short_name"),
  ready("package_ip", "УНП", "FLD-000296", "FLD-000016",
    "client_legal_details", "ent_unp", "package.ip.unp"),
  ready("package_ip", "Адрес полный", "FLD-000280", "FLD-000018",
    "client_legal_details", "ent_address", "package.ip.address_full"),
  ready("package_ip", "Действует на основании", "FLD-000273", "FLD-000019",
    "client_legal_details", "ent_acts_on_basis", "package.ip.acts_on_basis"),
  ready("package_ip", "Банк", "FLD-000287", "FLD-000005",
    "client_legal_details", "bank_name", "package.ip.bank_name"),
  ready("package_ip", "БИК / код банка", "FLD-000286", "FLD-000006",
    "client_legal_details", "bank_code", "package.ip.bank_code"),
  ready("package_ip", "Расчётный счёт / IBAN", "FLD-000285", "FLD-000004",
    "client_legal_details", "bank_account", "package.ip.bank_account"),
  ready("package_ip", "Телефон", "FLD-000294", "FLD-000007",
    "client_legal_details", "phone", "package.ip.phone"),
  ready("package_ip", "Email", "FLD-000292", "FLD-000008",
    "client_legal_details", "email", "package.ip.email"),
  // Sprint 3E: адресный breakdown ИП — jsonb-path (плоских колонок НЕТ; SOT = ent_address_structured).
  readyJson("package_ip", "Адрес: улица", "FLD-000284", "FLD-000043",
    "client_legal_details", "ent_address_structured", "street", "package.ip.address_street"),
  readyJson("package_ip", "Адрес: дом", "FLD-000281", "FLD-000044",
    "client_legal_details", "ent_address_structured", "house", "package.ip.address_house"),
  readyJson("package_ip", "Адрес: корпус", "FLD-000275", "FLD-000045",
    "client_legal_details", "ent_address_structured", "building", "package.ip.address_building"),
  readyJson("package_ip", "Адрес: помещение/квартира", "FLD-000274", "FLD-000046",
    "client_legal_details", "ent_address_structured", "apartment", "package.ip.address_apartment"),
  readyJson("package_ip", "Адрес: населённый пункт", "FLD-000276", "FLD-000047",
    "client_legal_details", "ent_address_structured", "city", "package.ip.address_city"),
  readyJson("package_ip", "Адрес: область", "FLD-000283", "FLD-000048",
    "client_legal_details", "ent_address_structured", "region", "package.ip.address_region"),
  readyJson("package_ip", "Адрес: индекс", "FLD-000282", "FLD-000049",
    "client_legal_details", "ent_address_structured", "postal_code", "package.ip.address_postal_code"),
  readyJson("package_ip", "Адрес: страна", "FLD-000278", "FLD-000050",
    "client_legal_details", "ent_address_structured", "country", "package.ip.address_country"),
  deferred("package_ip", "Адрес: район", "FLD-000279", "pending_field",
    "package.ip.address_district",
    "Источник есть: ent_address_structured->>'district'. FLD в fields_registry отсутствует — backlog."),
  deferred("package_ip", "Адрес: район города", "FLD-000277", "pending_field",
    "package.ip.address_city_district",
    "Источник есть: ent_address_structured->>'city_district'. FLD в fields_registry отсутствует — backlog."),
  deferred("package_ip", "Руководитель ФИО", "FLD-000289", "deferred",
    "package.ip.director_full_name",
    "Для ИП руководитель = сам предприниматель; решается резолвером в Sprint 3E."),
  deferred("package_ip", "Руководитель ФИО (кратко)", "FLD-000291", "deferred",
    "package.ip.director_short_name",
    "См. director_full_name."),
  deferred("package_ip", "Руководитель должность", "FLD-000290", "deferred",
    "package.ip.director_position",
    "Для ИП должность фиксированная; backlog Sprint 3E."),
  deferred("package_ip", "Руководитель действует на основании", "FLD-000288", "deferred",
    "package.ip.director_acts_on_basis",
    "См. acts_on_basis (для ИП дублируется); backlog Sprint 3E."),
];

/* =========================================================================
 * Пакет: ФЛ — зеркало «Заказчик ФЛ» (FLD-000297..322).
 * Источник: legal_details_persons (full_name, birth_date, passport_*,
 * personal_number, phone, email, address_structured jsonb).
 * Конкретное лицо подставляется по role_key из session_participants —
 * сам role binding выбирается в анкете пакета, не в каталоге плейсхолдеров.
 * ========================================================================= */
const PACKAGE_FL: PackagePlaceholderItem[] = [
  ready("package_fl", "ФИО", "FLD-000313", "FLD-000372",
    "legal_details_persons", "full_name", "package.fl.full_name"),
  ready("package_fl", "ФИО кратко", "FLD-000314", "FLD-000372",
    "legal_details_persons", "full_name", "package.fl.full_name_short"),
  ready("package_fl", "Дата рождения", "FLD-000311", "FLD-000021",
    "legal_details_persons", "birth_date", "package.fl.birth_date"),
  ready("package_fl", "Личный номер", "FLD-000321", "FLD-000027",
    "legal_details_persons", "personal_number", "package.fl.personal_number"),
  ready("package_fl", "Паспорт серия", "FLD-000319", "FLD-000022",
    "legal_details_persons", "passport_series", "package.fl.passport_series"),
  ready("package_fl", "Паспорт номер", "FLD-000317", "FLD-000023",
    "legal_details_persons", "passport_number", "package.fl.passport_number"),
  ready("package_fl", "Паспорт серия и номер", "FLD-000318", "FLD-000023",
    "legal_details_persons", "passport_number_full", "package.fl.passport_number_full"),
  ready("package_fl", "Паспорт кем выдан", "FLD-000315", "FLD-000024",
    "legal_details_persons", "passport_issued_by", "package.fl.passport_issued_by"),
  ready("package_fl", "Паспорт дата выдачи", "FLD-000316", "FLD-000025",
    "legal_details_persons", "passport_issued_date", "package.fl.passport_issued_date"),
  ready("package_fl", "Паспорт действителен до", "FLD-000320", "FLD-000026",
    "legal_details_persons", "passport_valid_until", "package.fl.passport_valid_until"),
  ready("package_fl", "Телефон", "FLD-000322", "FLD-000007",
    "legal_details_persons", "phone", "package.fl.phone"),
  ready("package_fl", "Email", "FLD-000312", "FLD-000008",
    "legal_details_persons", "email", "package.fl.email"),
  // Sprint 3E: адресный breakdown ФЛ — jsonb-path (SOT = legal_details_persons.address_structured).
  // FLD переиспользуются из ind_address_* (FLD-000028..034). Где FLD нет — pending_field.
  readyJson("package_fl", "Адрес: улица", "FLD-000307", "FLD-000032",
    "legal_details_persons", "address_structured", "street", "package.fl.address_street"),
  readyJson("package_fl", "Адрес: дом", "FLD-000304", "FLD-000033",
    "legal_details_persons", "address_structured", "house", "package.fl.address_house"),
  readyJson("package_fl", "Адрес: помещение/квартира", "FLD-000297", "FLD-000034",
    "legal_details_persons", "address_structured", "apartment", "package.fl.address_apartment"),
  readyJson("package_fl", "Адрес: населённый пункт", "FLD-000299", "FLD-000031",
    "legal_details_persons", "address_structured", "city", "package.fl.address_city"),
  readyJson("package_fl", "Адрес: область", "FLD-000306", "FLD-000029",
    "legal_details_persons", "address_structured", "region", "package.fl.address_region"),
  readyJson("package_fl", "Адрес: район", "FLD-000302", "FLD-000030",
    "legal_details_persons", "address_structured", "district", "package.fl.address_district"),
  readyJson("package_fl", "Адрес: индекс", "FLD-000305", "FLD-000028",
    "legal_details_persons", "address_structured", "postal_code", "package.fl.address_postal_code"),
  deferred("package_fl", "Адрес: полный", "FLD-000303", "pending_field",
    "package.fl.address_full",
    "Источник: legal_details_persons.address_structured (нужен formatter). FLD ind_address_full в registry отсутствует — backlog (manifest-proof)."),
  deferred("package_fl", "Адрес: корпус", "FLD-000298", "pending_field",
    "package.fl.address_building",
    "Источник есть: address_structured->>'building'. FLD ind_address_building в registry отсутствует — backlog."),
  deferred("package_fl", "Адрес: район города", "FLD-000300", "pending_field",
    "package.fl.address_city_district",
    "Источник есть: address_structured->>'city_district'. FLD ind_address_city_district отсутствует — backlog."),
  deferred("package_fl", "Адрес: страна", "FLD-000301", "pending_field",
    "package.fl.address_country",
    "Источник есть: address_structured->>'country'. FLD ind_address_country отсутствует — backlog."),
  // Sprint 3E: банк-реквизиты ФЛ — добавлены колонки legal_details_persons.bank_*,
  // переиспользуем биллинговые FLD-000004/5/6 (label/type общие).
  ready("package_fl", "Расчётный счёт / IBAN", "FLD-000308", "FLD-000004",
    "legal_details_persons", "bank_account", "package.fl.bank_account"),
  ready("package_fl", "Банк", "FLD-000310", "FLD-000005",
    "legal_details_persons", "bank_name", "package.fl.bank_name"),
  ready("package_fl", "БИК / код банка", "FLD-000309", "FLD-000006",
    "legal_details_persons", "bank_code", "package.fl.bank_code"),
];

export const PACKAGE_PLACEHOLDER_CATALOG: PackagePlaceholderItem[] = [
  ...PACKAGE_UL,
  ...PACKAGE_IP,
  ...PACKAGE_FL,
];

export const PACKAGE_GROUP_META: Array<{
  id: PackageGroupId;
  label_ru: string;
  hint: string;
  source_summary: string;
}> = [
  {
    id: "package_ul",
    label_ru: "Пакет: ЮЛ",
    hint: "Реквизиты компании, выбранной в анкете пакета. Не путать с заказчиком сделки.",
    source_summary: SESSION_LE,
  },
  {
    id: "package_ip",
    label_ru: "Пакет: ИП",
    hint: "Реквизиты ИП, выбранного в анкете пакета. Источник тот же, что у ЮЛ, но ent_*-колонки.",
    source_summary: SESSION_LE,
  },
  {
    id: "package_fl",
    label_ru: "Пакет: ФЛ",
    hint: "Физлицо по выбранной роли в анкете пакета (company_head / responsible_person / …). Роль выбирается там же, не здесь.",
    source_summary: SESSION_PERSON,
  },
  {
    id: "package_roles",
    label_ru: "Пакет: Роли",
    hint: "Роли пакета с физлицом, выбранным в анкете. Один токен на роль: {{package.role.PKR-XXXXXX}}. Содержимое подставляется по output_template роли (по умолчанию «должность, ФИО»).",
    source_summary:
      "document_package_role_catalog.public_id → document_package_session_participants.role_key → legal_details_persons + metadata.position",
  },
];

export function getPackagePlaceholdersByGroup(
  groupId: PackageGroupId,
): PackagePlaceholderItem[] {
  return PACKAGE_PLACEHOLDER_CATALOG.filter((i) => i.groupId === groupId);
}

/**
 * Sprint 3F §D/E: Построить items группы «Пакет: Роли» из БД-каталога ролей.
 * Сами роли (включая custom) хранятся в `document_package_role_catalog`;
 * этот хелпер — read-only адаптер для UI каталога плейсхолдеров.
 *
 * Канонический Word-токен: `{{package.role.PKR-XXXXXX}}`.
 * Старый формат `{{package.roles.<role_key>.<attr>}}` остаётся как deprecated alias,
 * см. document_package_token_aliases.
 */
export interface PackageRoleCatalogRow {
  public_id: string;          // PKR-XXXXXX
  role_key: string;
  label: string;              // ru
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  package_template_id: string;
  package_template_name: string;
  output_template: string | null;
  sort_order: number;
}

export function buildPackageRoleItems(
  rows: PackageRoleCatalogRow[],
): PackagePlaceholderItem[] {
  return rows
    .filter((r) => r.is_active)
    .map<PackagePlaceholderItem>((r) => ({
      groupId: "package_roles",
      label_ru: `${r.package_template_name} — ${r.label}`,
      source_table: "legal_details_persons",
      source_path:
        `document_package_role_catalog.public_id='${r.public_id}' → ` +
        `document_package_session_participants WHERE role_key='${r.role_key}'`,
      billing_fld_analog: null,
      reused_fld: null,
      package_token: `{{package.role.${r.public_id}}}`,
      package_resolver_hint:
        r.output_template
          ? `output_template: ${r.output_template}`
          : 'output_template (NULL) → дефолт «{{position}}, {{full_name}}»',
      status: "copy_ready",
      tech_key: `package.role.${r.public_id}`,
    }));
}
