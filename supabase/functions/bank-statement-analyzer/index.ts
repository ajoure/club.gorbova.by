import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BANK_STATEMENT_ANALYZER_SECTION_CODE,
  resolveSectionAccess,
} from "../_shared/ai-access.ts";
import { compareCounterpartyNames } from "../_shared/bank-statement-matching.ts";
import { batchBankStatementImages, splitBankStatementText } from "../_shared/bank-statement-chunking.ts";
import { validateBankStatementInput } from "../_shared/bank-statement-input.ts";
import { lookupWithConcurrency } from "../_shared/bank-statement-registry.ts";
import {
  parseBankStatementExtraction,
  type ExtractedBankStatementPayment,
} from "../_shared/bank-statement-extraction.ts";
import {
  renderBankStatementReport,
  type BankStatementReportRow,
} from "../_shared/bank-statement-report.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_UNP_LOOKUPS = 300;
const MNS_LOOKUP_CONCURRENCY = 20;
const AI_TIMEOUT_MS = 65_000;
const REGISTRY_BUDGET_MS = 55_000;
const REGISTRY_REQUEST_TIMEOUT_MS = 3_500;
const AI_CONCURRENCY = 4;

type IncomingImage = { base64: string; filename: string; mimeType?: string };
type RegistryResult = { found: boolean; data?: { full_name?: string; short_name?: string; unp?: string } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function extractPaymentsWithAi(
  apiKey: string,
  fileContents: string,
  images: IncomingImage[],
): Promise<{ statement_recognized: boolean; payments: ExtractedBankStatementPayment[] }> {
  const system = `Ты извлекаешь только исходящие платежи из банковской выписки Республики Беларусь. Верни строго JSON без Markdown: {"statement_recognized":true|false,"payments":[...]}. statement_recognized=true только если файл действительно читается как банковская выписка; иначе false и payments=[]. Каждый элемент payments: date, time, amount, currency, purpose, recipient_unp, recipient_name, recipient_account, source_ref. УНП — только 9 цифр или null. Не выдумывай значения. Название получателя бери именно из выписки, не исправляй его. source_ref — номер строки/документа, если виден. Не оценивай добросовестность и не делай выводов о мошенничестве.`;
  const textChunks = splitBankStatementText(fileContents);
  const imageBatches = batchBankStatementImages(images);
  const hasSubstantiveText = fileContents.replace(/\[[^\]]+\]/g, "").trim().length > 0;
  const inputs = [
    ...(hasSubstantiveText ? textChunks.map((text) => ({ text, images: [] as IncomingImage[] })) : []),
    ...imageBatches.map((batch) => ({ text: "", images: batch })),
  ];
  if (!inputs.length) inputs.push({ text: "", images: [] });

  const extractOne = async (input: { text: string; images: IncomingImage[] }, index: number) => {
    const userContent: Array<Record<string, unknown>> = [{
      type: "text",
      text: inputs.length > 1
        ? `Это часть ${index + 1} из ${inputs.length} одной банковской выписки. Извлеки платежи только из этой части.\n\n${input.text}`
        : `Извлеки платежи из следующей выписки.\n\n${input.text || "Текст не извлечён; используй приложенный PDF или изображение."}`,
    }];
    for (const image of input.images) {
      const matched = /^data:([^;]+);base64,(.*)$/s.exec(image.base64);
      const raw = matched ? matched[2] : image.base64;
      const mime = matched ? matched[1] : (image.mimeType || "image/jpeg");
      userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${raw}` } });
    }

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          temperature: 0,
          messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
        }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("AI_EXTRACTION_TIMEOUT");
      }
      throw error;
    }
    const body = await response.text();
    if (!response.ok) throw new Error(`AI gateway error ${response.status}`);
    const content = JSON.parse(body)?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("AI returned an empty extraction");
    return parseBankStatementExtraction(content);
  };

  const results: Awaited<ReturnType<typeof extractOne>>[] = new Array(inputs.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, inputs.length) }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex++;
      results[index] = await extractOne(inputs[index], index);
    }
  }));

  return {
    statement_recognized: results.some((result) => result.statement_recognized),
    payments: results.flatMap((result) => result.payments),
  };
}

async function lookupUnp(supabaseUrl: string, serviceKey: string, unp: string, deadline: number): Promise<RegistryResult | null> {
  try {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const response = await fetch(`${supabaseUrl}/functions/v1/grp-lookup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ unp }),
      signal: AbortSignal.timeout(Math.min(REGISTRY_REQUEST_TIMEOUT_MS, remaining)),
    });
    if (!response.ok) return null;
    const result = await response.json().catch(() => null);
    return result && typeof result === "object" ? result as RegistryResult : null;
  } catch {
    // One unavailable registry lookup must not discard the whole statement.
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  try {
    const startedAt = Date.now();
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!authHeader) return json({ error: "Необходима авторизация" }, 401);
    if (!supabaseUrl || !anonKey || !serviceKey || !aiKey) return json({ error: "Сервис временно недоступен" }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Необходима авторизация" }, 401);

    const body = await req.json().catch(() => ({}));
    const fileContents = typeof body.file_contents === "string" ? body.file_contents.trim() : "";
    const inputError = validateBankStatementInput({ fileNames: body.file_names, images: body.images, unsupportedFiles: body.unsupported_files });
    if (inputError) return json({ error: inputError }, 400);
    const fileNames = body.file_names as string[];
    const images = (body.images || []) as IncomingImage[];
    if (!fileContents && !images.length) return json({ error: "Загрузите выписку в поддерживаемом формате" }, 400);
    const service = createClient(supabaseUrl, serviceKey);
    if (!await resolveSectionAccess(service, user.id, BANK_STATEMENT_ANALYZER_SECTION_CODE)) {
      return json({ error: "Сервис «Анализ выписки» не входит в ваши активные продукты.", denial_reason: "bank_statement_analysis_not_in_products" }, 403);
    }

    const extraction = await extractPaymentsWithAi(aiKey, fileContents, images);
    console.log("bank-statement-analyzer stage", JSON.stringify({ stage: "ai_complete", elapsed_ms: Date.now() - startedAt, payments_count: extraction.payments.length, image_count: images.length, text_chars: fileContents.length }));
    if (!extraction.statement_recognized) {
      return json({ error: "Не удалось надёжно распознать банковскую выписку. Проверьте файл или загрузите экспорт в PDF, XLSX, CSV, XML либо изображение." }, 422);
    }
    const payments = extraction.payments;
    const uniqueUnps = [...new Set(payments.map((row) => row.recipient_unp).filter((unp): unp is string => !!unp))].slice(0, MAX_UNP_LOOKUPS);
    const registryDeadline = Date.now() + REGISTRY_BUDGET_MS;
    const registry = await lookupWithConcurrency(
      uniqueUnps,
      MNS_LOOKUP_CONCURRENCY,
      (unp) => lookupUnp(supabaseUrl, serviceKey, unp, registryDeadline),
    );
    console.log("bank-statement-analyzer stage", JSON.stringify({ stage: "registry_complete", elapsed_ms: Date.now() - startedAt, unique_unp_count: uniqueUnps.length }));

    const rows: BankStatementReportRow[] = payments.map((payment) => {
      if (!payment.recipient_unp) return { ...payment, outcome: "needs_review" as const, official_name: null };
      const result = registry.get(payment.recipient_unp);
      if (result == null) return { ...payment, outcome: "unavailable" as const, official_name: null };
      if (!result.found || !result.data?.full_name) return { ...payment, outcome: "not_found" as const, official_name: null };
      const officialName = result.data.full_name;
      return { ...payment, official_name: officialName, outcome: compareCounterpartyNames(payment.recipient_name, officialName) };
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
    return json({ content: renderBankStatementReport(rows), metadata });
  } catch (error) {
    console.error("bank-statement-analyzer error", error instanceof Error ? error.message : "unknown");
    if (error instanceof Error && error.message === "AI_EXTRACTION_TIMEOUT") {
      return json({ error: "Распознавание выписки заняло слишком много времени. Повторите анализ или загрузите PDF с текстовым слоем / экспорт XLSX либо CSV." }, 504);
    }
    return json({ error: "Не удалось обработать выписку. Попробуйте другой файл или повторите позже." }, 500);
  }
});
