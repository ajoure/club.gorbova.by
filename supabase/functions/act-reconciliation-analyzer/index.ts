import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ACT_RECONCILIATION_SECTION_CODE,
  resolveSectionAccess,
} from "../_shared/ai-access.ts";
import { validateActReconciliationInput } from "../_shared/act-reconciliation-input.ts";
import { parseActReconciliationExtraction } from "../_shared/act-reconciliation-extraction.ts";
import { renderActReconciliationReport } from "../_shared/act-reconciliation-report.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const AI_TIMEOUT_MS = 105_000;

type IncomingImage = { base64: string; filename: string; mimeType?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function imagePart(image: IncomingImage): Record<string, unknown> {
  const matched = /^data:([^;]+);base64,(.*)$/s.exec(image.base64);
  const raw = matched ? matched[2] : image.base64;
  const mime = matched ? matched[1] : (image.mimeType || "image/jpeg");
  return { type: "image_url", image_url: { url: `data:${mime};base64,${raw}` } };
}

async function reconcileWithAi(apiKey: string, fileContents: string, fileNames: string[], images: IncomingImage[]) {
  const system = `Ты сверяешь ровно два акта сверки взаимных расчётов. Не выдумывай операции и суммы. Учитывай, что дебет одной стороны может соответствовать кредиту другой. Сопоставляй операции по сумме, дате, номеру документа и назначению; небольшое смещение даты отмечай как date_mismatch, а не как две пропавшие операции. Верни строго JSON без Markdown:
{
  "acts_recognized": true|false,
  "documents": [{"file_name":string|null,"organization_name":string|null,"counterparty_name":string|null,"organization_unp":string|null,"counterparty_unp":string|null,"period_from":string|null,"period_to":string|null,"opening_balance":string|null,"closing_balance":string|null,"currency":string|null}],
  "matched_operations_count": number,
  "differences": [{"type":"missing_in_first"|"missing_in_second"|"amount_mismatch"|"date_mismatch"|"details_mismatch"|"balance_mismatch"|"needs_review","first_date":string|null,"second_date":string|null,"first_document":string|null,"second_document":string|null,"first_description":string|null,"second_description":string|null,"first_amount":string|null,"second_amount":string|null,"currency":string|null,"explanation":string}],
  "warnings": [string]
}
acts_recognized=true только если распознаны именно два акта и можно определить их операции или сальдо. documents должен содержать ровно два элемента в порядке файлов. Для каждой разницы приводи данные обеих сторон, если они есть. Если качество не позволяет сделать вывод, используй needs_review и добавь конкретное предупреждение. Не составляй письмо: оно формируется отдельно.`;
  const userContent: Array<Record<string, unknown>> = [{
    type: "text",
    text: `Файл 1: ${fileNames[0]}\nФайл 2: ${fileNames[1]}\n\nСодержимое файлов с явными границами:\n${fileContents || "Текст не извлечён; используй приложенные изображения и их имена."}`,
  }];
  for (const image of images) userContent.push(imagePart(image));

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
      throw new Error("ACT_RECONCILIATION_TIMEOUT");
    }
    throw error;
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`AI gateway error ${response.status}`);
  const content = JSON.parse(body)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("ACT_RECONCILIATION_EMPTY");
  return parseActReconciliationExtraction(content);
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
    if (!authHeader) return json({ error: "Необходима авторизация" }, 401);
    if (!supabaseUrl || !anonKey || !serviceKey || !aiKey) return json({ error: "Сервис временно недоступен" }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Необходима авторизация" }, 401);

    const body = await req.json().catch(() => ({}));
    const fileContents = typeof body.file_contents === "string" ? body.file_contents.trim() : "";
    const inputError = validateActReconciliationInput({
      fileNames: body.file_names,
      fileContents,
      images: body.images,
      unsupportedFiles: body.unsupported_files,
    });
    if (inputError) return json({ error: inputError }, 400);
    const fileNames = body.file_names as string[];
    const images = (body.images || []) as IncomingImage[];

    const service = createClient(supabaseUrl, serviceKey);
    if (!await resolveSectionAccess(service, user.id, ACT_RECONCILIATION_SECTION_CODE)) {
      return json({ error: "Сервис «Сверка актов» не входит в ваши активные продукты.", denial_reason: "act_reconciliation_not_in_products" }, 403);
    }

    const result = await reconcileWithAi(aiKey, fileContents, fileNames, images);
    if (!result.acts_recognized) {
      return json({ error: "Не удалось надёжно распознать два акта сверки. Проверьте порядок файлов и загрузите PDF с текстом, XLSX, CSV или чёткие сканы." }, 422);
    }
    return json({
      content: renderActReconciliationReport(result),
      metadata: {
        scenario_code: "act_reconciliation",
        scenario_type: "file_analysis",
        launcher_title_snapshot: "Сверка актов",
        matched_operations_count: result.matched_operations_count,
        differences_count: result.differences.length,
        warnings_count: result.warnings.length,
        source_retained: false,
      },
    });
  } catch (error) {
    console.error("act-reconciliation-analyzer error", error instanceof Error ? error.message : "unknown");
    if (error instanceof Error && error.message === "ACT_RECONCILIATION_TIMEOUT") {
      return json({ error: "Сверка заняла слишком много времени. Загрузите акты за меньший период или используйте XLSX/CSV либо PDF с текстовым слоем." }, 504);
    }
    return json({ error: "Не удалось сверить акты. Проверьте файлы и повторите анализ." }, 500);
  }
});
