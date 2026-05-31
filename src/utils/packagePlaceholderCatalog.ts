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
 *
 * Sprint 3K (2026-05): добавлен `example_value` (демо-значение в колонке
 * «Пример» каталога — зеркало биллинговых групп). Удалены визуальные
 * дубликаты «ФИО кратко» для ЮЛ/ИП/ФЛ — краткая/подписная форма теперь
 * выбирается через modifier (`format=short|signature_short`) в строке
 * полного ФИО. Backend-резолв и старые Word-токены с modifiers не тронуты.
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
  /**
   * Sprint 3K: демо-пример значения для колонки «Пример» каталога.
   * Согласован с `src/constants/demoLegalDetails.ts` (ООО «Тестовая Компания»,
   * Федорчук Сергей Валерьевич и т.п.). Для `pending_field` / `deferred` / иных
   * non-ready — `null` (UI покажет подсказку резолвера).
   */
  example_value: string | null;
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
  example_value: string | null,
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
    example_value,
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
  example_value: string | null,
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
    example_value,
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
    example_value: null,
  };
}

/* =========================================================================
 * Demo values (зеркало src/constants/demoLegalDetails.ts + DEMO_PERSON_NAME).
 * Используются только для колонки «Пример» каталога плейсхолдеров.
 * ========================================================================= */
const EX_PERSON_FULL = "Федорчук Сергей Валерьевич";
const EX_DIRECTOR_FULL = "Иванов Иван Иванович";
const EX_PHONE = "+375 29 7000000";
const EX_BANK_NAME = "ОАО «Беларусбанк»";
const EX_BANK_CODE = "AKBBBY2X";
const EX_BANK_ACCOUNT = "BY00ABCD0000000000000000";
const EX_ADDR_FULL_LE = "220000, г. Минск, ул. Тестовая, д. 1, оф. 1";

/* =========================================================================
 * Пакет: ЮЛ — зеркало «Заказчик ЮЛ» (FLD-000323..346).
 * Источник: client_legal_details (leg_*, общие banking, phone, email).
 * ========================================================================= */
const PACKAGE_UL: PackagePlaceholderItem[] = [
  // Sprint 3L: short_name первым → FLD lookup даёт «ЗАО «Ажур инкам»».
  ready("package_ul", "Краткое название", "FLD-000345", "FLD-000011",
    "client_legal_details", "leg_name", "package.ul.short_name",
    "ООО «Тестовая Компания»"),
  ready("package_ul", "Название", "FLD-000342", "FLD-000011",
    "client_legal_details", "leg_name", "package.ul.name",
    "Тестовая Компания"),
  ready("package_ul", "Форма собственности", "FLD-000343", "FLD-000010",
    "client_legal_details", "leg_org_form", "package.ul.org_form",
    "ООО"),
  ready("package_ul", "УНП", "FLD-000346", "FLD-000009",
    "client_legal_details", "leg_unp", "package.ul.unp",
    "987654321"),
  ready("package_ul", "Юридический адрес (полный)", "FLD-000330", "FLD-000012",
    "client_legal_details", "leg_address", "package.ul.address_full",
    EX_ADDR_FULL_LE),
  ready("package_ul", "Руководитель ФИО", "FLD-000338", "FLD-000014",
    "client_legal_details", "leg_director_name", "package.ul.director_full_name",
    EX_DIRECTOR_FULL),
  // Sprint 3K: дубликат «Руководитель ФИО (кратко)» удалён из UI-каталога.
  // Краткая/подписная форма теперь выбирается через modifier:
  //   {{package.ul.FLD-000014|format=short}} → «Иванов И.И.»
  //   {{package.ul.FLD-000014|format=signature_short}} → «И.И.Иванов»
  // Backend-резолв и старые Word-токены с modifiers не тронуты.
  ready("package_ul", "Руководитель должность", "FLD-000339", "FLD-000013",
    "client_legal_details", "leg_director_position", "package.ul.director_position",
    "директор"),
  ready("package_ul", "Действует на основании", "FLD-000323", "FLD-000015",
    "client_legal_details", "leg_acts_on_basis", "package.ul.acts_on_basis",
    "Устава"),
  ready("package_ul", "Банк", "FLD-000337", "FLD-000005",
    "client_legal_details", "bank_name", "package.ul.bank_name",
    EX_BANK_NAME),
  ready("package_ul", "БИК / код банка", "FLD-000336", "FLD-000006",
    "client_legal_details", "bank_code", "package.ul.bank_code",
    EX_BANK_CODE),
  ready("package_ul", "Расчётный счёт / IBAN", "FLD-000335", "FLD-000004",
    "client_legal_details", "bank_account", "package.ul.bank_account",
    EX_BANK_ACCOUNT),
  ready("package_ul", "Телефон", "FLD-000344", "FLD-000007",
    "client_legal_details", "phone", "package.ul.phone",
    EX_PHONE),
  ready("package_ul", "Email", "FLD-000341", "FLD-000008",
    "client_legal_details", "email", "package.ul.email",
    "demo.company@example.com"),
  // Sprint 3E: адресный breakdown ЮЛ — jsonb-path (плоских колонок НЕТ; SOT = leg_address_structured).
  readyJson("package_ul", "Адрес: улица", "FLD-000334", "FLD-000035",
    "client_legal_details", "leg_address_structured", "street", "package.ul.address_street",
    "Тестовая"),
  readyJson("package_ul", "Адрес: дом", "FLD-000331", "FLD-000036",
    "client_legal_details", "leg_address_structured", "house", "package.ul.address_house",
    "1"),
  readyJson("package_ul", "Адрес: корпус", "FLD-000325", "FLD-000037",
    "client_legal_details", "leg_address_structured", "building", "package.ul.address_building",
    "А"),
  readyJson("package_ul", "Адрес: помещение/квартира", "FLD-000324", "FLD-000038",
    "client_legal_details", "leg_address_structured", "apartment", "package.ul.address_apartment",
    "1"),
  readyJson("package_ul", "Адрес: населённый пункт", "FLD-000326", "FLD-000039",
    "client_legal_details", "leg_address_structured", "city", "package.ul.address_city",
    "Минск"),
  readyJson("package_ul", "Адрес: область", "FLD-000333", "FLD-000040",
    "client_legal_details", "leg_address_structured", "region", "package.ul.address_region",
    "Минская область"),
  readyJson("package_ul", "Адрес: индекс", "FLD-000332", "FLD-000041",
    "client_legal_details", "leg_address_structured", "postal_code", "package.ul.address_postal_code",
    "220000"),
  readyJson("package_ul", "Адрес: страна", "FLD-000328", "FLD-000042",
    "client_legal_details", "leg_address_structured", "country", "package.ul.address_country",
    "Беларусь"),
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
    "client_legal_details", "ent_name", "package.ip.name",
    EX_PERSON_FULL),
  // Sprint 3K: дубликат «ФИО (кратко)» удалён — выбор через modifier
  //   {{package.ip.FLD-000017|format=short}} → «Федорчук С.В.»
  ready("package_ip", "УНП", "FLD-000296", "FLD-000016",
    "client_legal_details", "ent_unp", "package.ip.unp",
    "123456789"),
  ready("package_ip", "Адрес полный", "FLD-000280", "FLD-000018",
    "client_legal_details", "ent_address", "package.ip.address_full",
    EX_ADDR_FULL_LE),
  ready("package_ip", "Действует на основании", "FLD-000273", "FLD-000019",
    "client_legal_details", "ent_acts_on_basis", "package.ip.acts_on_basis",
    "свидетельства о государственной регистрации"),
  ready("package_ip", "Банк", "FLD-000287", "FLD-000005",
    "client_legal_details", "bank_name", "package.ip.bank_name",
    EX_BANK_NAME),
  ready("package_ip", "БИК / код банка", "FLD-000286", "FLD-000006",
    "client_legal_details", "bank_code", "package.ip.bank_code",
    EX_BANK_CODE),
  ready("package_ip", "Расчётный счёт / IBAN", "FLD-000285", "FLD-000004",
    "client_legal_details", "bank_account", "package.ip.bank_account",
    EX_BANK_ACCOUNT),
  ready("package_ip", "Телефон", "FLD-000294", "FLD-000007",
    "client_legal_details", "phone", "package.ip.phone",
    EX_PHONE),
  ready("package_ip", "Email", "FLD-000292", "FLD-000008",
    "client_legal_details", "email", "package.ip.email",
    "demo.ip@example.com"),
  // Sprint 3E: адресный breakdown ИП — jsonb-path (плоских колонок НЕТ; SOT = ent_address_structured).
  readyJson("package_ip", "Адрес: улица", "FLD-000284", "FLD-000043",
    "client_legal_details", "ent_address_structured", "street", "package.ip.address_street",
    "Тестовая"),
  readyJson("package_ip", "Адрес: дом", "FLD-000281", "FLD-000044",
    "client_legal_details", "ent_address_structured", "house", "package.ip.address_house",
    "1"),
  readyJson("package_ip", "Адрес: корпус", "FLD-000275", "FLD-000045",
    "client_legal_details", "ent_address_structured", "building", "package.ip.address_building",
    "А"),
  readyJson("package_ip", "Адрес: помещение/квартира", "FLD-000274", "FLD-000046",
    "client_legal_details", "ent_address_structured", "apartment", "package.ip.address_apartment",
    "1"),
  readyJson("package_ip", "Адрес: населённый пункт", "FLD-000276", "FLD-000047",
    "client_legal_details", "ent_address_structured", "city", "package.ip.address_city",
    "Минск"),
  readyJson("package_ip", "Адрес: область", "FLD-000283", "FLD-000048",
    "client_legal_details", "ent_address_structured", "region", "package.ip.address_region",
    "Минская область"),
  readyJson("package_ip", "Адрес: индекс", "FLD-000282", "FLD-000049",
    "client_legal_details", "ent_address_structured", "postal_code", "package.ip.address_postal_code",
    "220000"),
  readyJson("package_ip", "Адрес: страна", "FLD-000278", "FLD-000050",
    "client_legal_details", "ent_address_structured", "country", "package.ip.address_country",
    "Беларусь"),
  deferred("package_ip", "Адрес: район", "FLD-000279", "pending_field",
    "package.ip.address_district",
    "Источник есть: ent_address_structured->>'district'. FLD в fields_registry отсутствует — backlog."),
  deferred("package_ip", "Адрес: район города", "FLD-000277", "pending_field",
    "package.ip.address_city_district",
    "Источник есть: ent_address_structured->>'city_district'. FLD в fields_registry отсутствует — backlog."),
  deferred("package_ip", "Руководитель ФИО", "FLD-000289", "deferred",
    "package.ip.director_full_name",
    "Для ИП руководитель = сам предприниматель; решается резолвером в Sprint 3E."),
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
    "legal_details_persons", "full_name", "package.fl.full_name",
    EX_PERSON_FULL),
  // Sprint 3K: дубликат «ФИО кратко» удалён — выбор через modifier
  //   {{package.fl.FLD-000372|format=short}} → «Федорчук С.В.»
  //   {{package.fl.FLD-000372|format=signature_short}} → «С.В.Федорчук»
  ready("package_fl", "Дата рождения", "FLD-000311", "FLD-000021",
    "legal_details_persons", "birth_date", "package.fl.birth_date",
    "15.01.1990"),
  ready("package_fl", "Личный номер", "FLD-000321", "FLD-000027",
    "legal_details_persons", "personal_number", "package.fl.personal_number",
    "1234567A009PB1"),
  ready("package_fl", "Паспорт серия", "FLD-000319", "FLD-000022",
    "legal_details_persons", "passport_series", "package.fl.passport_series",
    "MP"),
  ready("package_fl", "Паспорт номер", "FLD-000317", "FLD-000023",
    "legal_details_persons", "passport_number", "package.fl.passport_number",
    "7654321"),
  ready("package_fl", "Паспорт серия и номер", "FLD-000318", "FLD-000023",
    "legal_details_persons", "passport_number_full", "package.fl.passport_number_full",
    "MP 7654321"),
  ready("package_fl", "Паспорт кем выдан", "FLD-000315", "FLD-000024",
    "legal_details_persons", "passport_issued_by", "package.fl.passport_issued_by",
    "Тестовым РУВД г. Минска"),
  ready("package_fl", "Паспорт дата выдачи", "FLD-000316", "FLD-000025",
    "legal_details_persons", "passport_issued_date", "package.fl.passport_issued_date",
    "05.06.2018"),
  ready("package_fl", "Паспорт действителен до", "FLD-000320", "FLD-000026",
    "legal_details_persons", "passport_valid_until", "package.fl.passport_valid_until",
    "05.06.2028"),
  ready("package_fl", "Телефон", "FLD-000322", "FLD-000007",
    "legal_details_persons", "phone", "package.fl.phone",
    EX_PHONE),
  ready("package_fl", "Email", "FLD-000312", "FLD-000008",
    "legal_details_persons", "email", "package.fl.email",
    "demo.user@example.com"),
  // Sprint 3E: адресный breakdown ФЛ — jsonb-path (SOT = legal_details_persons.address_structured).
  // FLD переиспользуются из ind_address_* (FLD-000028..034). Где FLD нет — pending_field.
  readyJson("package_fl", "Адрес: улица", "FLD-000307", "FLD-000032",
    "legal_details_persons", "address_structured", "street", "package.fl.address_street",
    "Тестовая"),
  readyJson("package_fl", "Адрес: дом", "FLD-000304", "FLD-000033",
    "legal_details_persons", "address_structured", "house", "package.fl.address_house",
    "1"),
  readyJson("package_fl", "Адрес: помещение/квартира", "FLD-000297", "FLD-000034",
    "legal_details_persons", "address_structured", "apartment", "package.fl.address_apartment",
    "1"),
  readyJson("package_fl", "Адрес: населённый пункт", "FLD-000299", "FLD-000031",
    "legal_details_persons", "address_structured", "city", "package.fl.address_city",
    "Минск"),
  readyJson("package_fl", "Адрес: область", "FLD-000306", "FLD-000029",
    "legal_details_persons", "address_structured", "region", "package.fl.address_region",
    "Минская область"),
  readyJson("package_fl", "Адрес: район", "FLD-000302", "FLD-000030",
    "legal_details_persons", "address_structured", "district", "package.fl.address_district",
    "Минский район"),
  readyJson("package_fl", "Адрес: индекс", "FLD-000305", "FLD-000028",
    "legal_details_persons", "address_structured", "postal_code", "package.fl.address_postal_code",
    "220000"),
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
    "legal_details_persons", "bank_account", "package.fl.bank_account",
    EX_BANK_ACCOUNT),
  ready("package_fl", "Банк", "FLD-000310", "FLD-000005",
    "legal_details_persons", "bank_name", "package.fl.bank_name",
    EX_BANK_NAME),
  ready("package_fl", "БИК / код банка", "FLD-000309", "FLD-000006",
    "legal_details_persons", "bank_code", "package.fl.bank_code",
    EX_BANK_CODE),
];

export const PACKAGE_PLACEHOLDER_CATALOG: PackagePlaceholderItem[] = [
  ...PACKAGE_UL,
  ...PACKAGE_IP,
  ...PACKAGE_FL,
];

/* =========================================================================
 * Sprint 3J-UI — modifier-controls parity с billing UI.
 *
 * Backend SOT для модификаторов:
 *   - _shared/packageFieldFormatter.ts (Sprint 3J backend parity)
 *   - canonical-document-generate-strict (parser + resolver)
 *
 * UI здесь НЕ форматирует значения — только helper для построения итогового
 * copy-токена с modifiers. Whitelist совпадает с billing (FieldChipNode.ts):
 *   |format=words   — для numeric/date (прописью)
 *   |format=long    — для package.*.org_form (расширенная форма)
 *   |case=<...>     — для text + numeric|format=words
 * Для `package_roles` (`{{ln-XXXXXX}}`) модификаторы не добавляются (§5).
 * ========================================================================= */

import type { FieldCase, FieldFormat } from "@/components/ai-documents/extensions/FieldChipNode";

/** Псевдо-тип данных для выбора UI-контролов RowSettingsCell.
 *  Sprint 3J-Roles: добавлен `person_name` для ФИО-полей (директор ЮЛ, ФИО ФЛ)
 *  и для package_roles ({{ln-XXXXXX}}). У этого kind свои controls:
 *  ФИО полностью / кратко / для подписи + падеж.
 */
export type PackageItemDataKind = "text" | "date" | "boolean" | "person_name" | "other";

/**
 * Tech-keys ФИО-полей, для которых backend whitelisted
 * `format=short|signature_short` (см. PERSON_NAME_PACKAGE_BAG_KEYS в
 * canonical-document-generate-strict + FIO_PACKAGE_TECH_KEYS в orchestrator).
 *
 * Sprint 3K: удалены legacy-tech-keys устранённых дубликатов
 * (`package.ul.director_short_name`, `package.fl.full_name_short`).
 * Backend по-прежнему понимает Word-токены с `|format=short|signature_short`
 * на основном FLD (директор/ФИО полностью).
 */
const PERSON_NAME_PACKAGE_TECH_KEYS: ReadonlySet<string> = new Set([
  "package.ul.director_full_name",
  "package.fl.full_name",
]);

export function classifyPackageItem(item: PackagePlaceholderItem): PackageItemDataKind {
  if (item.status !== "copy_ready") return "other";
  if (item.groupId === "package_roles") return "person_name";
  if (PERSON_NAME_PACKAGE_TECH_KEYS.has(item.tech_key)) return "person_name";
  const k = item.tech_key;
  if (/(birth_date|issued_date|valid_until)/.test(k)) return "date";
  return "text";
}

/** `|format=long` поддерживается backend'ом только для `package.*.org_form`. */
export function supportsLongFormat(item: PackagePlaceholderItem): boolean {
  return /\.org_form$/.test(item.tech_key);
}

/** Sprint 3J-Roles: поддержка `format=short|signature_short` для ФИО-полей и ролей. */
export function supportsPersonNameFormats(item: PackagePlaceholderItem): boolean {
  return classifyPackageItem(item) === "person_name";
}

/**
 * Построить итоговый copy-токен пакетного плейсхолдера с модификаторами.
 * Берёт базовый `package_token` (`{{package.ul.FLD-000011}}` или `{{ln-000012}}`)
 * и добавляет `|format=...|case=...` (всегда в порядке format → case — backend
 * читает оба порядка, но UI пишет один канонический).
 *
 * Sprint 3J-Roles canon: `format=full` НЕ добавляется в токен — это default
 * (`{{ln-000012}}` уже значит full). В токен попадают только short/signature_short
 * и совместимые с item модификаторы.
 */
export function buildPackagePlaceholderToken(
  item: PackagePlaceholderItem,
  format: FieldFormat | null,
  caseModifier: FieldCase | null,
  includePosition = false,
  joinMode: 'semicolon' | 'comma' | 'newline' | null = null,
): string | null {
  if (!item.package_token) return null;
  const inner = item.package_token.replace(/^\{\{/, "").replace(/\}\}$/, "");
  const parts: string[] = [inner];
  // Sprint 3J-Roles: для package_roles разрешён только person_name format whitelist;
  // прочие форматы (long/words/text) игнорируются — их backend не понимает у ln-токенов.
  const isRole = item.groupId === "package_roles";
  const personName = supportsPersonNameFormats(item);

  let effectiveFormat: FieldFormat | null = format;
  if (isRole && effectiveFormat && effectiveFormat !== "short" && effectiveFormat !== "signature_short") {
    effectiveFormat = null;
  }
  if (effectiveFormat && !personName && (effectiveFormat === "short" || effectiveFormat === "signature_short")) {
    // ФИО-форматы доступны только для person_name kind.
    effectiveFormat = null;
  }
  // `full` — default, в токен не добавляется.
  if (effectiveFormat === ("full" as unknown as FieldFormat)) {
    effectiveFormat = null;
  }

  // Sprint 3N canonical order: format → case → include_position → join.
  // include_position и join действуют только для ln-ролей; для остальных — игнорируются.
  // join=semicolon — default backend'а, в токен не пишется.
  if (effectiveFormat) parts.push(`format=${effectiveFormat}`);
  if (caseModifier) parts.push(`case=${caseModifier}`);
  if (isRole && includePosition) parts.push("include_position=true");
  if (isRole && joinMode && joinMode !== "semicolon") parts.push(`join=${joinMode}`);
  return `{{${parts.join("|")}}}`;
}

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
    hint: "Роли пакета с физлицом, выбранным в анкете документа. Один токен на роль: {{ln-XXXXXX}}. Содержимое подставляется по output_template роли (по умолчанию «должность, ФИО»).",
    source_summary:
      "document_package_role_catalog.public_id → document_package_item_role_assignments → legal_details_persons + metadata.position",
  },
];

export function getPackagePlaceholdersByGroup(
  groupId: PackageGroupId,
): PackagePlaceholderItem[] {
  return PACKAGE_PLACEHOLDER_CATALOG.filter((i) => i.groupId === groupId);
}

/**
 * Sprint 3H: Построить items группы «Пакет: Роли» из БД-каталога ролей.
 * Сами роли (включая custom) хранятся в `document_package_role_catalog`;
 * этот хелпер — read-only адаптер для UI каталога плейсхолдеров.
 *
 * Канонический Word-токен: `{{ln-XXXXXX}}` (Word-friendly, без `package.role.`-префикса).
 * Старые форматы `{{package.role.PKR-XXXXXX}}` и `{{package.roles.<role_key>.<attr>}}`
 * больше не поддерживаются: реальных шаблонов с ними нет (proof Sprint 3G §7),
 * валидатор маркирует их как `invalid_legacy_role_placeholder` (error).
 */
export interface PackageRoleCatalogRow {
  public_id: string;          // ln-XXXXXX (канон Sprint 3H). Legacy PKR-NNNNNN мигрированы.
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
        `document_package_item_role_assignments (по package_template_item_id)`,
      billing_fld_analog: null,
      reused_fld: null,
      package_token: `{{${r.public_id}}}`,
      package_resolver_hint:
        r.output_template
          ? `output_template: ${r.output_template}`
          : 'output_template (NULL) → дефолт «{{position}}, {{full_name}}»',
      status: "copy_ready",
      tech_key: `ln.${r.public_id}`,
      // Роль рендерится по output_template из БД — статичного «примера» нет,
      // UI покажет hint резолвера.
      example_value: null,
    }));
}
