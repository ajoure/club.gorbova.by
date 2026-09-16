import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BANK_STATEMENT_ANALYZER_SECTION_CODE,
  resolveSectionAccess,
} from "../_shared/ai-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_FILES = 5;
const MAX_TEXT_CHARS = 120_000;
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_UNP_LOOKUPS = 300;

type IncomingImage = { base64: string; filename: string; mimeType?: string };
type Payment = {
  date?: string | null;
  time?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  purpose?: string | null;
  recipient_unp?: string | null;
  recipient_name?: string | null;
  recipient_account?: string | null;
  source_ref?: string | null;
};
type RegistryResult = { found: boolean; data?: { full_name?: string; short_name?: string; unp?: string } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUnp(value: unknown): string | null {
  const digits = text(value).replace(/\D/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

function normalizeName(value: string | null | undefined): string {
  return (value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, " ")
    .replace(/\b(ооо|зао|одо|чуп|уп|ип|республиканское|унитарное|общество|с ограниченной ответственностью|с дополнительной ответственностью|закрытое|акционерное|индивидуальный предприниматель)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conservative comparison: a missing / badly extracted name is reviewable,
 * not a fraud assertion. A materially different name is marked as a mismatch.
 */
function compareNames(statementName: string | null | undefined, officialName: string): "match" | "mismatch" | "needs_review" {
  const left = normalizeName(statementName);
  const right = normalizeName(officialName);
  if (left.length < 3 || right.length < 3) return "needs_review";
  if (left === right || left.includes(right) || right.includes(left)) return "match";

  const a = new Set(left.split(" ").filter((word) => word.length > 2));
  const b = new Set(right.split(" ").filter((word) => word.length > 2));
  if (!a.size || !b.size) return "needs_review";
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.min(a.size, b.size) >= 0.7 ? "match" : "mismatch";
}

function cleanCell(value: unknown, fallback = "—"): string {
  const rendered = value === null || value === undefined ? "" : String(value).trim();
  return rendered ? rendered.replace(/\|/g, "\\|").replace(/\n+/g, " ") : fallback;
}

function parseModelJson(raw: string): Payment[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
  const parsed = JSON.parse(fenced.trim()) as { payments?: unknown };
  if (!Array.isArray(parsed.payments)) return [];
  return parsed.payments
    .filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
    .map((row) => ({
      date: text(row.date) || null,
      time: text(row.time) || null,
      amount: typeof row.amount === "number" ? row.amount : text(row.amount) || null,
      currency: text(row.currency) || null,
      purpose: text(row.purpose) || null,
      recipient_unp: normalizeUnp(row.recipient_unp),
      recipient_name: text(row.recipient_name) || null,
      recipient_account: text(row.recipient_account) || null,
      source_ref: text(row.source_ref) || null,
    }))
    .filter((row) => row.recipient_unp || row.recipient_name || row.purpose);
}

async function extractPaymentsWithAi(
  apiKey: string,
  fileContents: string,
  images: IncomingImage[],
): Promise<Payment[]> {
  const system = `Ты извлекаешь только исходящие платежи из банковской выписки Республики Беларусь. Верни строго JSON без Markdown: {"payments":[...]}. Каждый элемент: date, time, amount, currency, purpose, recipient_unp, recipient_name, recipient_account, source_ref. УНП — только 9 цифр или null. Не выдумывай значения. Название получателя бери именно из выписки, не исправляй его. source_ref — номер строки/документа, если виден. Не оценивай добросовестность и не делай выводов о мошенничестве.`;
  const userContent: Array<Record<string, unknown>> = [{
    type: "text",
    text: `Извлеки платежи из следующей выписки.\n\n${fileContents || "Текст не извлечён; используй приложенное изображение."}`,
  }];
  for (const image of images) {
    const matched = /^data:([^;]+);base64,(.*)$/s.exec(image.base64);
    const raw = matched ? matched[2] : image.base64;
    const mime = matched ? matched[1] : (image.mimeType || "image/jpeg");
    userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${raw}` } });
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`AI gateway error ${response.status}`);
  const content = JSON.parse(body)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("AI returned an empty extraction");
  return parseModelJson(content);
}

async function lookupUnp(supabaseUrl: string, serviceKey: string, unp: string): Promise<RegistryResult | null> {
  const response = await fetch(`${supabaseUrl}/functions/v1/grp-lookup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ unp }),
  });
  if (!response.ok) return null;
  const result = await response.json().catch(() => null);
  return result && typeof result === "object" ? result as RegistryResult : null;
}

function renderReport(rows: Array<Payment & { official_name?: string | null; outcome: "match" | "mismatch" | "needs_review" | "not_found" | "unavailable" }>) {
  const mismatches = rows.filter((row) => row.outcome === "mismatch");
  const review = rows.filter((row) => row.outcome === "needs_review" || row.outcome === "not_found");
  const unavailable = rows.filter((row) => row.outcome === "unavailable");
  const lines = [
    "### Анализ выписки",
    `Проверено платежей: **${rows.length}**. Несовпадений: **${mismatches.length}**. Нужна ручная проверка: **${review.length}**. МНС временно недоступен: **${unavailable.length}**.`,
    "",
  ];
  if (!mismatches.length) {
    lines.push("Несовпадений между названием получателя в выписке и официальным названием по УНП не найдено.");
  } else {
    lines.push("#### Несовпадения", "", "| Дата и время | Сумма | Название в выписке | УНП | Официальное название МНС | Назначение / реквизиты |", "|---|---:|---|---|---|---|");
    for (const row of mismatches) {
      lines.push(`| ${cleanCell([row.date, row.time].filter(Boolean).join(" "))} | ${cleanCell([row.amount, row.currency].filter(Boolean).join(" "))} | ${cleanCell(row.recipient_name)} | ${cleanCell(row.recipient_unp)} | ${cleanCell(row.official_name)} | ${cleanCell([row.purpose, row.recipient_account].filter(Boolean).join("; "))} |`);
    }
  }
  if (review.length) {
    lines.push("", "#### Требует ручной проверки", "", "| Дата и время | УНП | Что не удалось надёжно сопоставить |", "|---|---|---|");
    for (const row of review) {
      const reason = row.outcome === "not_found"
        ? "МНС не вернул плательщика по указанному УНП"
        : `В выписке нет или неполно распознано название получателя; МНС: ${cleanCell(row.official_name)}`;
      lines.push(`| ${cleanCell([row.date, row.time].filter(Boolean).join(" "))} | ${cleanCell(row.recipient_unp)} | ${reason} |`);
    }
  }
  lines.push("", "Это контроль совпадения реквизитов, а не вывод о нарушении. Перед решением проверьте первичный платёжный документ.");
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!authHeader || !supabaseUrl || !anonKey || !serviceKey || !aiKey) return json({ error: "Сервис временно недоступен" }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Необходима авторизация" }, 401);

    const body = await req.json().catch(() => ({}));
    const fileContents = typeof body.file_contents === "string" ? body.file_contents.trim() : "";
    const fileNames = Array.isArray(body.file_names) ? body.file_names.filter((name: unknown) => typeof name === "string").slice(0, MAX_FILES) : [];
    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES).filter((image: unknown): image is IncomingImage => !!image && typeof image === "object" && typeof (image as IncomingImage).base64 === "string") : [];
    if (!fileNames.length || fileNames.length > MAX_FILES || (!fileContents && !images.length)) return json({ error: "Загрузите выписку в поддерживаемом формате" }, 400);
    if (fileContents.length > MAX_TEXT_CHARS) return json({ error: `Выписка слишком объёмная для одного анализа (максимум ${MAX_TEXT_CHARS.toLocaleString("ru-RU")} символов)` }, 413);
    if (images.some((image) => image.base64.length * 0.75 > MAX_IMAGE_BYTES)) return json({ error: "Один из файлов слишком большой" }, 413);

    const service = createClient(supabaseUrl, serviceKey);
    if (!await resolveSectionAccess(service, user.id, BANK_STATEMENT_ANALYZER_SECTION_CODE)) {
      return json({ error: "Сервис «Анализ выписки» не входит в ваши активные продукты.", denial_reason: "bank_statement_analysis_not_in_products" }, 403);
    }

    const payments = await extractPaymentsWithAi(aiKey, fileContents, images);
    const uniqueUnps = [...new Set(payments.map((row) => row.recipient_unp).filter((unp): unp is string => !!unp))].slice(0, MAX_UNP_LOOKUPS);
    const registry = new Map<string, RegistryResult | null>();
    for (const unp of uniqueUnps) registry.set(unp, await lookupUnp(supabaseUrl, serviceKey, unp));

    const rows = payments.map((payment) => {
      if (!payment.recipient_unp) return { ...payment, outcome: "needs_review" as const, official_name: null };
      const result = registry.get(payment.recipient_unp);
      if (result == null) return { ...payment, outcome: "unavailable" as const, official_name: null };
      if (!result.found || !result.data?.full_name) return { ...payment, outcome: "not_found" as const, official_name: null };
      const officialName = result.data.full_name;
      return { ...payment, official_name: officialName, outcome: compareNames(payment.recipient_name, officialName) };
    });
    const metadata = {
      scenario_code: "bank_statement_analysis",
      scenario_type: "file_analysis",
      launcher_title_snapshot: "Анализ выписки",
      payments_count: rows.length,
      mismatches_count: rows.filter((row) => row.outcome === "mismatch").length,
      needs_review_count: rows.filter((row) => row.outcome === "needs_review").length,
      registry_not_found_count: rows.filter((row) => row.outcome === "not_found").length,
      registry_unavailable_count: rows.filter((row) => row.outcome === "unavailable").length,
      // Deliberately no statement data, counterparties or file contents in audit/history.
      source_retained: false,
    };
    return json({ content: renderReport(rows), metadata });
  } catch (error) {
    console.error("bank-statement-analyzer error", error instanceof Error ? error.message : "unknown");
    return json({ error: "Не удалось обработать выписку. Попробуйте другой файл или повторите позже." }, 500);
  }
});
