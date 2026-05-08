/**
 * Unified Token Registry — единый источник правды для UI-лейблов токенов.
 *
 * Registry-first rule:
 * Before creating any new token, search existing key in fields_registry.
 * If key exists — reuse 1:1. Only create new if truly missing.
 *
 * Dual-Class Token Model (see docs/TOKEN_ARCHITECTURE.md):
 *
 *   Class A — registry-backed data tokens.
 *     Canonical format: {{cf.<entity_type>.<PUBLIC_ID>}}
 *     Example: {{cf.legal_details.FLD-000042}}
 *     Resolved via: public_id → fields_registry → DB column / field_values_v2
 *
 *   Class B — computed / domain / package tokens.
 *     Format: {{canonical.key}}
 *     Example: {{meeting.date}}
 *     Resolved via: canonical key → resolver function
 *
 *   Legacy exception: {{cf.product.<UUID>}} — legacy compatibility only,
 *   NOT a canonical format for new Class A token families.
 *
 * Groups (with token class):
 * 1. CONTACT_TOKENS — Class B, 1:1 с resolveContactTokens() в edge functions
 * 2. DATETIME_TOKENS — Class B, 1:1 с resolveSystemTokens() в _shared/systemTokens.ts
 * 3. Product custom fields — Class A [legacy compat], UUID-based: {{cf.product.<UUID>}}
 * 4. Legal details fields — Class A [implemented], public_id-based: {{cf.legal_details.FLD-000042}}
 * 5. Person fields — Class B, metadata из fields_registry, token example: {{person.full_name}}
 * 6. Entity-person link fields — Class B, metadata из fields_registry, token example: {{entity_person.position}}
 * 7. Document fields — Class B, metadata из fields_registry, token example: {{document.number}}
 * 8. Meeting fields — Class B, metadata из fields_registry, token example: {{meeting.date}}
 * 9. Entity computed fields — Class B, metadata из fields_registry, token example: {{entity.name}}
 *
 * External token format (SoT):
 *   Class A: {{cf.<entity_type>.<PUBLIC_ID>}} — example: {{cf.legal_details.FLD-000042}}
 *   Class B: {{canonical.key}} — example: {{meeting.date}}
 * UI показывает label, хранит tokenString.
 */

import { supabase } from "@/integrations/supabase/client";

export interface TokenDef {
  key: string;
  label: string;
  tokenString: string;
  group:
    | "contact"
    | "datetime"
    | "product"
    | "legal_details"
    | "person"
    | "entity_person"
    | "document"
    | "meeting"
    | "entity"
    | "package_role"
    | "package_default"
    | "package_array"
    | "agenda"
    | "decision"
    // Sprint 10: act-document context groups (loaded from document_token_registry by category)
    | "act_contact"
    | "act_customer"
    | "act_customer_signer"
    | "act_executor"
    | "act_order"
    | "act_product"
    | "act_tariff"
    | "act_offer"
    | "act_document"
    | "act_system"
    | "act_legal_details";
  badge: string;
  searchKeywords: string;
}

/** Standard contact tokens — strictly 1:1 with edge function resolveContactTokens */
export const CONTACT_TOKENS: TokenDef[] = [
  { key: "full_name", label: "Полное имя", tokenString: "{{full_name}}", group: "contact", badge: "Текст", searchKeywords: "полное имя full_name фио" },
  { key: "first_name", label: "Имя", tokenString: "{{first_name}}", group: "contact", badge: "Текст", searchKeywords: "имя first_name" },
  { key: "last_name", label: "Фамилия", tokenString: "{{last_name}}", group: "contact", badge: "Текст", searchKeywords: "фамилия last_name" },
  { key: "email", label: "Email", tokenString: "{{email}}", group: "contact", badge: "Текст", searchKeywords: "email почта" },
  { key: "phone", label: "Телефон", tokenString: "{{phone}}", group: "contact", badge: "Текст", searchKeywords: "телефон phone" },
  { key: "telegram_username", label: "Telegram username", tokenString: "{{telegram_username}}", group: "contact", badge: "Текст", searchKeywords: "telegram username телеграм" },
];

/** System date/time tokens — strictly 1:1 with resolveSystemTokens in _shared/systemTokens.ts */
export const DATETIME_TOKENS: TokenDef[] = [
  { key: "today", label: "Сегодня (дд.мм.гггг)", tokenString: "{{today}}", group: "datetime", badge: "Дата", searchKeywords: "сегодня today дата" },
  { key: "tomorrow", label: "Завтра", tokenString: "{{tomorrow}}", group: "datetime", badge: "Дата", searchKeywords: "завтра tomorrow" },
  { key: "yesterday", label: "Вчера", tokenString: "{{yesterday}}", group: "datetime", badge: "Дата", searchKeywords: "вчера yesterday" },
  { key: "now", label: "Сейчас (дата+время)", tokenString: "{{now}}", group: "datetime", badge: "Дата", searchKeywords: "сейчас now время" },
  { key: "month_name", label: "Месяц (словом)", tokenString: "{{month_name}}", group: "datetime", badge: "Дата", searchKeywords: "месяц month название" },
  { key: "month", label: "Месяц (01-12)", tokenString: "{{month}}", group: "datetime", badge: "Дата", searchKeywords: "месяц month число" },
  { key: "year", label: "Год", tokenString: "{{year}}", group: "datetime", badge: "Дата", searchKeywords: "год year" },
  { key: "day", label: "День (01-31)", tokenString: "{{day}}", group: "datetime", badge: "Дата", searchKeywords: "день day число" },
  { key: "weekday", label: "День недели", tokenString: "{{weekday}}", group: "datetime", badge: "Дата", searchKeywords: "день недели weekday" },
];

const DATA_TYPE_BADGES: Record<string, string> = {
  text: "Текст",
  number: "Число",
  boolean: "Да/Нет",
  date: "Дата",
  json: "JSON",
  url: "URL",
  select: "Список",
  multiselect: "Мульти",
};

/** Extract search_keywords from options JSONB */
function extractSearchKeywords(f: { label: string; key: string; options?: unknown }): string {
  const opts = f.options as Record<string, unknown> | null;
  const kw = opts?.search_keywords as string | undefined;
  return kw ? `${f.label} ${kw}` : `${f.label} ${f.key}`;
}

/** Generic loader for fields_registry by entity_type */
async function loadFieldsByEntityType(
  entityType: string,
  group: TokenDef["group"],
): Promise<TokenDef[]> {
  const { data, error } = await supabase
    .from("fields_registry")
    .select("id, entity_type, key, label, data_type, public_id, options")
    .eq("entity_type", entityType)
    .is("archived_at", null)
    .order("display_order");

  if (error || !data) return [];

  return data.map((f) => ({
    key: f.id,
    label: f.label,
    // Canonical token: use the registry key directly (e.g. {{person.full_name}})
    tokenString: `{{${f.key}}}`,
    group,
    badge: DATA_TYPE_BADGES[f.data_type] ?? f.data_type,
    searchKeywords: extractSearchKeywords(f),
  }));
}

/** Load product custom fields from fields_registry (dynamic, UUID-based legacy) */
export async function loadProductFields(): Promise<TokenDef[]> {
  const { data, error } = await supabase
    .from("fields_registry")
    .select("id, entity_type, key, label, data_type")
    .eq("entity_type", "product")
    .is("archived_at", null)
    .order("label");

  if (error || !data) return [];

  return data.map((f) => ({
    key: f.id,
    label: f.label,
    tokenString: `{{cf.product.${f.id}}}`,
    group: "product" as const,
    badge: DATA_TYPE_BADGES[f.data_type] ?? f.data_type,
    searchKeywords: `${f.label} ${f.key} продукт product`,
  }));
}

/** Load legal_details fields from fields_registry (dynamic, public_id-based canonical) */
export async function loadLegalDetailsFields(): Promise<TokenDef[]> {
  const { data, error } = await supabase
    .from("fields_registry")
    .select("id, entity_type, key, label, data_type, public_id")
    .eq("entity_type", "legal_details")
    .is("archived_at", null)
    .order("display_order");

  if (error || !data) return [];

  return data
    .filter((f) => !!f.public_id)
    .map((f) => ({
      key: f.id,
      label: f.label,
      tokenString: `{{cf.legal_details.${f.public_id}}}`,
      group: "legal_details" as const,
      badge: DATA_TYPE_BADGES[f.data_type] ?? f.data_type,
      searchKeywords: `${f.label} ${f.key} реквизиты legal ${f.public_id}`,
    }));
}

/** Load person fields — entity_type = 'person' */
export async function loadPersonFields(): Promise<TokenDef[]> {
  return loadFieldsByEntityType("person", "person");
}

/** Load entity_person link fields — entity_type = 'entity_person' */
export async function loadEntityPersonFields(): Promise<TokenDef[]> {
  return loadFieldsByEntityType("entity_person", "entity_person");
}

/** Load document fields — entity_type = 'document' */
export async function loadDocumentFields(): Promise<TokenDef[]> {
  return loadFieldsByEntityType("document", "document");
}

/** Load meeting fields — entity_type = 'meeting' */
export async function loadMeetingFields(): Promise<TokenDef[]> {
  return loadFieldsByEntityType("meeting", "meeting");
}

/** Load entity computed fields — entity_type = 'entity' */
export async function loadEntityFields(): Promise<TokenDef[]> {
  return loadFieldsByEntityType("entity", "entity");
}

/**
 * Load package fields from fields_registry.
 * Splits into three sub-groups:
 * - package_role: scalar role tokens (signer, chairperson, secretary)
 * - package_default: scalar package-level defaults (already covered by meeting.*)
 * - package_array: array/loop tokens (participants, registered_persons)
 */
export async function loadPackageFields(): Promise<{
  roles: TokenDef[];
  arrays: TokenDef[];
}> {
  const { data, error } = await supabase
    .from("fields_registry")
    .select("id, entity_type, key, label, data_type, public_id, options")
    .eq("entity_type", "package")
    .is("archived_at", null)
    .order("display_order");

  if (error || !data) return { roles: [], arrays: [] };

  const roles: TokenDef[] = [];
  const arrays: TokenDef[] = [];

  for (const f of data) {
    const opts = f.options as Record<string, unknown> | null;
    const strategy = opts?.source_strategy as string | undefined;
    const isArray = f.data_type === "array" || strategy === "loop";

    const def: TokenDef = {
      key: f.id,
      label: f.label,
      tokenString: `{{${f.key}}}`,
      group: isArray ? "package_array" : "package_role",
      badge: isArray ? "Массив" : (DATA_TYPE_BADGES[f.data_type] ?? f.data_type),
      searchKeywords: extractSearchKeywords(f),
    };

    if (isArray) {
      arrays.push(def);
    } else {
      roles.push(def);
    }
  }

  return { roles, arrays };
}

/** Load agenda fields — entity_type = 'agenda' */
export async function loadAgendaFields(): Promise<TokenDef[]> {
  return loadFieldsByEntityType("agenda", "agenda");
}

/** Load decision fields — entity_type = 'decision' */
export async function loadDecisionFields(): Promise<TokenDef[]> {
  return loadFieldsByEntityType("decision", "decision");
}

// Internal caches (populated by react-query in components)
let _productFieldsCache: TokenDef[] = [];
let _legalDetailsFieldsCache: TokenDef[] = [];
let _personFieldsCache: TokenDef[] = [];
let _entityPersonFieldsCache: TokenDef[] = [];
let _documentFieldsCache: TokenDef[] = [];
let _meetingFieldsCache: TokenDef[] = [];
let _entityFieldsCache: TokenDef[] = [];
let _packageRolesCache: TokenDef[] = [];
let _packageArraysCache: TokenDef[] = [];
let _agendaFieldsCache: TokenDef[] = [];
let _decisionFieldsCache: TokenDef[] = [];

// Sprint 10: act-context tokens (sourced from public.document_token_registry)
let _actTokensByCategoryCache: Record<string, TokenDef[]> = {};

export function setProductFieldsCache(fields: TokenDef[]) {
  _productFieldsCache = fields;
}

export function setLegalDetailsFieldsCache(fields: TokenDef[]) {
  _legalDetailsFieldsCache = fields;
}

export function setPersonFieldsCache(fields: TokenDef[]) {
  _personFieldsCache = fields;
}

export function setEntityPersonFieldsCache(fields: TokenDef[]) {
  _entityPersonFieldsCache = fields;
}

export function setDocumentFieldsCache(fields: TokenDef[]) {
  _documentFieldsCache = fields;
}

export function setMeetingFieldsCache(fields: TokenDef[]) {
  _meetingFieldsCache = fields;
}

export function setEntityFieldsCache(fields: TokenDef[]) {
  _entityFieldsCache = fields;
}

export function setPackageRolesCache(fields: TokenDef[]) {
  _packageRolesCache = fields;
}

export function setPackageArraysCache(fields: TokenDef[]) {
  _packageArraysCache = fields;
}

export function setAgendaFieldsCache(fields: TokenDef[]) {
  _agendaFieldsCache = fields;
}

export function setDecisionFieldsCache(fields: TokenDef[]) {
  _decisionFieldsCache = fields;
}

/**
 * Runtime lookup: tokenString → label.
 * Used to render chips from saved SoT strings.
 * Returns null if token is unknown (UNMAPPED).
 */
export function tokenStringToLabel(tokenString: string): string | null {
  const allCaches: TokenDef[][] = [
    CONTACT_TOKENS,
    DATETIME_TOKENS,
    _productFieldsCache,
    _legalDetailsFieldsCache,
    _personFieldsCache,
    _entityPersonFieldsCache,
    _documentFieldsCache,
    _meetingFieldsCache,
    _entityFieldsCache,
    _packageRolesCache,
    _packageArraysCache,
    _agendaFieldsCache,
    _decisionFieldsCache,
  ];

  for (const cache of allCaches) {
    const found = cache.find((t) => t.tokenString === tokenString);
    if (found) return found.label;
  }

  return null; // UNMAPPED
}

/**
 * Extract short UUID from a custom field token for UNMAPPED display.
 * {{cf.product.abc123-def456}} → "abc123…"
 * {{cf.legal_details.FLD-000042}} → "FLD-000042"
 */
export function extractShortUuid(tokenString: string): string {
  // Check for FLD-* pattern first
  const fldMatch = tokenString.match(/\{\{cf\.\w+\.(FLD-\d+)\}\}/);
  if (fldMatch) return fldMatch[1];

  const match = tokenString.match(/\{\{cf\.\w+\.([^}]+)\}\}/);
  if (match) {
    const uuid = match[1];
    return uuid.length > 8 ? uuid.slice(0, 8) + "…" : uuid;
  }
  return tokenString.replace(/\{\{|\}\}/g, "");
}

/**
 * Document token group definitions for use with TokenizedRichInput.
 * Returns configured groups from cached registry data.
 * 
 * Groups are split into:
 * - Scalar entity/person/meeting/document groups
 * - Package roles (scalar, role-context)
 * - Package arrays/loops (participants, registered_persons)
 * - Agenda/Decision arrays
 */
export function getDocumentTokenGroups(): Array<{ heading: string; tokens: TokenDef[] }> {
  const groups: Array<{ heading: string; tokens: TokenDef[] }> = [];
  
  if (_entityFieldsCache.length > 0) {
    groups.push({ heading: "Юрлицо (вычисляемые)", tokens: _entityFieldsCache });
  }
  if (_personFieldsCache.length > 0) {
    groups.push({ heading: "Физлицо", tokens: _personFieldsCache });
  }
  if (_entityPersonFieldsCache.length > 0) {
    groups.push({ heading: "Связь лицо ↔ юрлицо", tokens: _entityPersonFieldsCache });
  }
  if (_meetingFieldsCache.length > 0) {
    groups.push({ heading: "Собрание", tokens: _meetingFieldsCache });
  }
  if (_documentFieldsCache.length > 0) {
    groups.push({ heading: "Документ", tokens: _documentFieldsCache });
  }
  // Package roles (scalar)
  if (_packageRolesCache.length > 0) {
    groups.push({ heading: "Роли в пакете", tokens: _packageRolesCache });
  }
  // Package arrays/loops
  if (_packageArraysCache.length > 0) {
    groups.push({ heading: "Списки пакета (массивы)", tokens: _packageArraysCache });
  }
  // Agenda
  if (_agendaFieldsCache.length > 0) {
    groups.push({ heading: "Повестка дня", tokens: _agendaFieldsCache });
  }
  // Decisions
  if (_decisionFieldsCache.length > 0) {
    groups.push({ heading: "Решения", tokens: _decisionFieldsCache });
  }

  return groups;
}

/**
 * Resolver contract for array/loop tokens.
 * 
 * REGISTRY: Array tokens are stored in fields_registry with data_type='array'
 * and options.source_strategy='loop'. The item_schema in options defines
 * the expected shape of each array element.
 * 
 * SOURCE: The resolver collects array data from the relevant source tables:
 * - package.participants → legal_details_entity_person_links + legal_details_persons
 * - package.registered_persons → same source, filtered by registration status
 * - agenda.items → package metadata or dedicated agenda table
 * - decision.items → derived from agenda items with voting results
 * 
 * PAYLOAD: Each array element is a plain object matching item_schema keys.
 * Example: { full_name: "Иванов И.И.", share_percent: 50, votes_count: 100 }
 * 
 * DOCXTEMPLATER LOOP SYNTAX:
 * {#package.participants}
 *   {full_name} — {share_percent}%
 * {/package.participants}
 * 
 * VALIDATION: Required fields from item_schema are checked at generation time.
 * Missing required fields generate warnings in token_manifest_snapshot.
 * 
 * @see PATCH 2.5 master token matrix for full mapping
 */
export type ArrayTokenResolverContract = {
  /** Canonical key of the array token (e.g. "package.participants") */
  key: string;
  /** Source strategy from options */
  sourceStrategy: "loop";
  /** Schema of each item in the array */
  itemSchema: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
  }>;
};

// ─── Context-based token source adapter ────────────────────────────

/**
 * Token context determines which token groups are available in the picker.
 * 
 * - "messages" — Contact + DateTime + Product (default, Telegram/email)
 * - "documents" — messages + LegalDetails + Entity + Person + EntityPerson + Document + Meeting
 * - "documents:annual_meeting" — documents + Package roles + Package arrays + Agenda + Decision
 * 
 * New integrations MUST use tokenContext. Do NOT use extraTokenGroups for new features.
 */
export type TokenContext = "messages" | "documents" | "documents:annual_meeting";

/**
 * Load and cache all token groups required by a given context.
 * Returns groups ready for picker rendering.
 * 
 * Call this once on component mount, results are cached in module-level variables.
 */
export async function loadTokensForContext(context: TokenContext): Promise<void> {
  // "messages" context: product fields only (contact/datetime are static)
  const productPromise = loadProductFields().then(setProductFieldsCache);
  
  if (context === "messages") {
    await productPromise;
    return;
  }

  // "documents" context: add legal_details, entity, person, entity_person, document, meeting
  const promises: Promise<void>[] = [
    productPromise,
    loadLegalDetailsFields().then(setLegalDetailsFieldsCache),
    loadEntityFields().then(setEntityFieldsCache),
    loadPersonFields().then(setPersonFieldsCache),
    loadEntityPersonFields().then(setEntityPersonFieldsCache),
    loadDocumentFields().then(setDocumentFieldsCache),
    loadMeetingFields().then(setMeetingFieldsCache),
  ];

  if (context === "documents:annual_meeting") {
    // Add package roles, package arrays, agenda, decision
    promises.push(
      loadPackageFields().then(({ roles, arrays }) => {
        setPackageRolesCache(roles);
        setPackageArraysCache(arrays);
      }),
      loadAgendaFields().then(setAgendaFieldsCache),
      loadDecisionFields().then(setDecisionFieldsCache),
    );
  }

  await Promise.all(promises);
}

/**
 * Get token groups for a given context from cached data.
 * Call loadTokensForContext() first to populate caches.
 */
export function getTokenGroupsForContext(context: TokenContext): Array<{ heading: string; tokens: TokenDef[] }> {
  const groups: Array<{ heading: string; tokens: TokenDef[] }> = [];

  // All contexts get Contact + DateTime (static, always available)
  // Product fields
  if (_productFieldsCache.length > 0) {
    groups.push({ heading: "Продукт", tokens: _productFieldsCache });
  }

  if (context === "messages") return groups;

  // "documents" and "documents:annual_meeting"
  if (_legalDetailsFieldsCache.length > 0) {
    groups.push({ heading: "Реквизиты", tokens: _legalDetailsFieldsCache });
  }
  if (_entityFieldsCache.length > 0) {
    groups.push({ heading: "Юрлицо (вычисляемые)", tokens: _entityFieldsCache });
  }
  if (_personFieldsCache.length > 0) {
    groups.push({ heading: "Физлицо", tokens: _personFieldsCache });
  }
  if (_entityPersonFieldsCache.length > 0) {
    groups.push({ heading: "Связь лицо ↔ юрлицо", tokens: _entityPersonFieldsCache });
  }
  if (_meetingFieldsCache.length > 0) {
    groups.push({ heading: "Собрание", tokens: _meetingFieldsCache });
  }
  if (_documentFieldsCache.length > 0) {
    groups.push({ heading: "Документ", tokens: _documentFieldsCache });
  }

  if (context !== "documents:annual_meeting") return groups;

  // Annual meeting specific
  if (_packageRolesCache.length > 0) {
    groups.push({ heading: "Роли в пакете", tokens: _packageRolesCache });
  }
  if (_packageArraysCache.length > 0) {
    groups.push({ heading: "Списки пакета (массивы)", tokens: _packageArraysCache });
  }
  if (_agendaFieldsCache.length > 0) {
    groups.push({ heading: "Повестка дня", tokens: _agendaFieldsCache });
  }
  if (_decisionFieldsCache.length > 0) {
    groups.push({ heading: "Решения", tokens: _decisionFieldsCache });
  }

  return groups;
}
