/**
 * Unified Token Registry — единый источник правды для UI-лейблов токенов.
 * 
 * Четыре группы:
 * 1. CONTACT_TOKENS — 1:1 с resolveContactTokens() в edge functions
 * 2. DATETIME_TOKENS — 1:1 с resolveSystemTokens() в _shared/systemTokens.ts
 * 3. Product custom fields — динамически из fields_registry (UUID-based legacy)
 * 4. Legal details fields — динамически из fields_registry (public_id-based canonical)
 * 
 * SoT хранения: {{first_name}}, {{today}}, {{cf.product.<uuid>}}, {{cf.legal_details.<FLD-XXXXXX>}}
 * UI показывает label, хранит tokenString.
 */

import { supabase } from "@/integrations/supabase/client";

export interface TokenDef {
  key: string;
  label: string;
  tokenString: string;
  group: "contact" | "datetime" | "product" | "legal_details";
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

  return data.map((f) => ({
    key: f.id,
    label: f.label,
    // Canonical token: through public_id, not UUID
    tokenString: f.public_id ? `{{cf.legal_details.${f.public_id}}}` : `{{cf.legal_details.${f.id}}}`,
    group: "legal_details" as const,
    badge: DATA_TYPE_BADGES[f.data_type] ?? f.data_type,
    searchKeywords: `${f.label} ${f.key} реквизиты legal ${f.public_id || ""}`,
  }));
}

// Internal cache for product fields (populated by react-query in components)
let _productFieldsCache: TokenDef[] = [];
let _legalDetailsFieldsCache: TokenDef[] = [];

export function setProductFieldsCache(fields: TokenDef[]) {
  _productFieldsCache = fields;
}

export function setLegalDetailsFieldsCache(fields: TokenDef[]) {
  _legalDetailsFieldsCache = fields;
}

/**
 * Runtime lookup: tokenString → label.
 * Used to render chips from saved SoT strings.
 * Returns null if token is unknown (UNMAPPED).
 */
export function tokenStringToLabel(tokenString: string): string | null {
  // Check contact tokens
  const contact = CONTACT_TOKENS.find((t) => t.tokenString === tokenString);
  if (contact) return contact.label;

  // Check datetime tokens
  const datetime = DATETIME_TOKENS.find((t) => t.tokenString === tokenString);
  if (datetime) return datetime.label;

  // Check product custom fields cache
  const product = _productFieldsCache.find((t) => t.tokenString === tokenString);
  if (product) return product.label;

  // Check legal_details fields cache
  const legal = _legalDetailsFieldsCache.find((t) => t.tokenString === tokenString);
  if (legal) return legal.label;

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
