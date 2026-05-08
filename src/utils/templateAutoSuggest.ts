/**
 * templateAutoSuggest — Sprint 11 C2 client-side helper.
 *
 * Сканирует plain text DOCX и предлагает ID-first замены на каноничные поля
 * через `document_token_registry → fields_registry.public_id`.
 *
 * Никаких автоматических замен — только suggestions для подтверждения админом.
 */
import { supabase } from "@/integrations/supabase/client";

export type FieldDataType =
  | "string" | "text" | "number" | "money" | "date" | "datetime" | "boolean"
  | "enum" | "json" | "email" | "phone";

export interface RegistryFieldRef {
  field_public_id: string;
  token_key: string;
  ui_label: string;
  category: string;
  data_type: FieldDataType | string;
}

export type SuggestionStatus = "suggested" | "accepted" | "changed" | "skipped";

export interface MarkupSuggestion {
  id: string; // local uid
  original_text: string;
  suggested_field_public_id: string | null;
  suggested_label: string | null;
  field_public_id: string | null; // финальное (после accept/changed)
  placeholder: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  status: SuggestionStatus;
  // позиции в plain text (для подсветки)
  match_start?: number;
  match_end?: number;
}

let _registryCache: RegistryFieldRef[] | null = null;

export async function loadRegistryRefs(): Promise<RegistryFieldRef[]> {
  if (_registryCache) return _registryCache;
  const { data } = await supabase
    .from("document_token_registry")
    .select("token_key, ui_label, category, fields_registry!document_token_registry_field_id_fkey(public_id)")
    .is("archived_at", null);
  const refs: RegistryFieldRef[] = [];
  for (const row of (data ?? []) as any[]) {
    const fid = row.fields_registry?.public_id;
    if (!fid) continue;
    refs.push({
      field_public_id: fid,
      token_key: row.token_key,
      ui_label: row.ui_label,
      category: row.category,
    });
  }
  _registryCache = refs;
  return refs;
}

// ───────────── helpers ─────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function findByToken(refs: RegistryFieldRef[], token: string): RegistryFieldRef | undefined {
  return refs.find((r) => r.token_key === token);
}

// ───────────── pattern definitions ─────────────

interface PatternHit {
  original_text: string;
  match_start: number;
  match_end: number;
  token_key: string;
  confidence: MarkupSuggestion["confidence"];
  reason: string;
}

/**
 * Регулярки для типовых элементов договора/акта.
 * Все hit-ы ссылаются на token_key из document_token_registry.
 */
function findPatternHits(text: string): PatternHit[] {
  const hits: PatternHit[] = [];

  // Сумма + валюта (BYN/руб/EUR/USD/PLN)
  const amountRe = /(\d{1,3}(?:[ \u00A0]?\d{3})*(?:[.,]\d{1,2})?)\s?(BYN|руб(?:лей|ля|ль)?|р\.|RUB|USD|US\$|долл(?:аров)?|EUR|евро|€|PLN|зл(?:отых)?)/giu;
  for (const m of text.matchAll(amountRe)) {
    hits.push({
      original_text: m[0],
      match_start: m.index ?? 0,
      match_end: (m.index ?? 0) + m[0].length,
      token_key: "deal.amount",
      confidence: "medium",
      reason: "regex: сумма + валюта",
    });
  }

  // Дата в формате 01.01.2024 / 01.01.2024 г.
  const dateRe = /\b(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\b\s?(г\.?)?/g;
  for (const m of text.matchAll(dateRe)) {
    hits.push({
      original_text: m[0].trim(),
      match_start: m.index ?? 0,
      match_end: (m.index ?? 0) + m[0].length,
      token_key: "document.date",
      confidence: "medium",
      reason: "regex: дата",
    });
  }

  // Валюта отдельно (если стоит после суммы — high; иначе игнорим в этом блоке)
  // (уже учтено в amount)

  // Email
  const emailRe = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  for (const m of text.matchAll(emailRe)) {
    hits.push({
      original_text: m[0],
      match_start: m.index ?? 0,
      match_end: (m.index ?? 0) + m[0].length,
      token_key: "customer.email",
      confidence: "medium",
      reason: "regex: email",
    });
  }

  // УНП (9 цифр)
  const unpRe = /УНП[:\s]*(\d{9})/gi;
  for (const m of text.matchAll(unpRe)) {
    hits.push({
      original_text: m[1],
      match_start: (m.index ?? 0) + m[0].indexOf(m[1]),
      match_end: (m.index ?? 0) + m[0].indexOf(m[1]) + m[1].length,
      token_key: "customer.unp",
      confidence: "high",
      reason: "regex: УНП",
    });
  }

  return hits;
}

/**
 * Метки-якоря: ищем строки вида «Сумма: X», «Заказчик: X», «Исполнитель: X»,
 * «Услуги: X», «Срок: X». confidence=high, original_text = значение справа.
 */
const LABEL_ANCHORS: Array<{ re: RegExp; token_key: string; reason: string }> = [
  { re: /(?:Сумма(?:\s+к\s+оплате)?)\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "deal.amount", reason: "label: Сумма" },
  { re: /Заказчик\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "customer.name", reason: "label: Заказчик" },
  { re: /Исполнитель\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "executor.name", reason: "label: Исполнитель" },
  { re: /(?:Наименование\s+)?услуг(?:и|а)\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "deal.product_name", reason: "label: Услуга" },
  { re: /Тариф\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "deal.tariff_name", reason: "label: Тариф" },
  { re: /(?:Срок\s+(?:оплаты|оказания|действия|доступа))\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "deal.access_days", reason: "label: Срок" },
  { re: /(?:Дата(?:\s+документа)?)\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "document.date", reason: "label: Дата" },
  { re: /(?:№|Номер(?:\s+документа)?)\s*[:—-]?\s*([\w\d\-/]+)/gi, token_key: "document.number", reason: "label: Номер" },
  { re: /Валюта\s*[:—-]\s*([^\n\r]+?)(?=$|[\n\r])/gi, token_key: "deal.currency", reason: "label: Валюта" },
];

function findLabelHits(text: string): PatternHit[] {
  const hits: PatternHit[] = [];
  for (const { re, token_key, reason } of LABEL_ANCHORS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = (m[1] ?? "").trim();
      if (!value || value.length > 200) continue;
      const valStart = m.index + m[0].lastIndexOf(m[1]);
      hits.push({
        original_text: value,
        match_start: valStart,
        match_end: valStart + m[1].length,
        token_key,
        confidence: "high",
        reason,
      });
    }
  }
  return hits;
}

/**
 * Главная точка: возвращает список suggestions, не пересекающихся по диапазону.
 */
export async function buildAutoSuggestions(rawText: string): Promise<MarkupSuggestion[]> {
  const refs = await loadRegistryRefs();
  const allHits = [...findLabelHits(rawText), ...findPatternHits(rawText)];

  // ранжировать: high → medium → low; по позиции
  const order = { high: 0, medium: 1, low: 2 } as const;
  allHits.sort((a, b) => order[a.confidence] - order[b.confidence] || a.match_start - b.match_start);

  // дедуп по диапазону: если новый перекрывает уже принятый — пропустить
  const taken: Array<{ s: number; e: number }> = [];
  const out: MarkupSuggestion[] = [];
  for (const h of allHits) {
    if (taken.some((t) => !(h.match_end <= t.s || h.match_start >= t.e))) continue;
    const ref = findByToken(refs, h.token_key);
    if (!ref) continue;
    taken.push({ s: h.match_start, e: h.match_end });
    out.push({
      id: uid(),
      original_text: h.original_text,
      suggested_field_public_id: ref.field_public_id,
      suggested_label: ref.ui_label,
      field_public_id: ref.field_public_id,
      placeholder: `{{field:${ref.field_public_id}}}`,
      confidence: h.confidence,
      reason: h.reason,
      status: "suggested",
      match_start: h.match_start,
      match_end: h.match_end,
    });
  }
  return out;
}
