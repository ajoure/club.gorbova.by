// Shared helper: DOCX → PDF через Gotenberg на VPS hoster.by
// Конфиг читается из integration_instances (provider='hosterby', category='other')
// Ключи в config:
//   gotenberg_url           — https://pdf.gorbova.by
//   gotenberg_basic_user    — Basic Auth username (опционально)
//   gotenberg_basic_pass    — Basic Auth password (опционально)
//   gotenberg_enabled       — boolean
//
// Хранение: super_admin-only AUTH GUARD в hosterby-api защищает чтение config.
// Сервер-side helper берёт config напрямую через service_role (RLS не применяется).
// Клиенту никогда не возвращаются gotenberg_basic_user / gotenberg_basic_pass —
// только *_last4 / masked-флаги (см. gotenberg_get_status).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const GOTENBERG_TIMEOUT_MS = 60_000;
export const GOTENBERG_HEALTH_TIMEOUT_MS = 10_000;
export const PDF_MIN_SIZE_BYTES = 10 * 1024;

export type GotenbergErrorCode =
  | "GOTENBERG_NOT_CONFIGURED"
  | "GOTENBERG_DISABLED"
  | "GOTENBERG_SSRF_BLOCKED"
  | "GOTENBERG_UNREACHABLE"
  | "GOTENBERG_AUTH_FAILED"
  | "GOTENBERG_HTTP_ERROR"
  | "GOTENBERG_NOT_PDF"
  | "GOTENBERG_PDF_TOO_SMALL"
  | "GOTENBERG_TIMEOUT";

export interface GotenbergConfig {
  url: string;
  basicUser?: string;
  basicPass?: string;
  enabled: boolean;
}

export class GotenbergError extends Error {
  code: GotenbergErrorCode;
  details?: Record<string, unknown>;
  constructor(code: GotenbergErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function isSsrfSafeUrl(url: string): boolean {
  try {
    const p = new URL(url);
    const h = p.hostname.toLowerCase();
    if (h === "localhost" || h === "::1") return false;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return false;
    if (/^169\.254\./.test(h) || /^100\.64\./.test(h)) return false;
    if (h === "metadata.google.internal") return false;
    if (p.protocol !== "https:" && p.protocol !== "http:") return false;
    return true;
  } catch {
    return false;
  }
}

export async function loadGotenbergConfig(adminClient: SupabaseClient): Promise<GotenbergConfig> {
  const { data, error } = await adminClient
    .from("integration_instances")
    .select("config")
    .eq("provider", "hosterby")
    .eq("category", "other")
    .maybeSingle();
  if (error || !data) {
    throw new GotenbergError("GOTENBERG_NOT_CONFIGURED", "Интеграция hoster.by не найдена");
  }
  const cfg = (data.config ?? {}) as Record<string, unknown>;
  const url = cfg.gotenberg_url as string | undefined;
  if (!url) throw new GotenbergError("GOTENBERG_NOT_CONFIGURED", "gotenberg_url не задан");
  const enabled = cfg.gotenberg_enabled === true;
  return {
    url: url.replace(/\/+$/, ""),
    basicUser: cfg.gotenberg_basic_user as string | undefined,
    basicPass: cfg.gotenberg_basic_pass as string | undefined,
    enabled,
  };
}

function authHeader(cfg: GotenbergConfig): Record<string, string> {
  if (cfg.basicUser && cfg.basicPass) {
    const creds = btoa(`${cfg.basicUser}:${cfg.basicPass}`);
    return { Authorization: `Basic ${creds}` };
  }
  return {};
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface HealthCheckResult {
  ok: boolean;
  http_status?: number;
  latency_ms: number;
  error?: string;
  code?: GotenbergErrorCode;
}

export async function gotenbergHealthCheck(cfg: GotenbergConfig): Promise<HealthCheckResult> {
  if (!isSsrfSafeUrl(cfg.url)) {
    return { ok: false, latency_ms: 0, code: "GOTENBERG_SSRF_BLOCKED", error: "URL указывает на внутренний адрес" };
  }
  const t0 = performance.now();
  try {
    const resp = await fetchWithTimeout(`${cfg.url}/health`, { headers: authHeader(cfg) }, GOTENBERG_HEALTH_TIMEOUT_MS);
    const latency = Math.round(performance.now() - t0);
    if (resp.status === 401 || resp.status === 403) {
      await resp.text();
      return { ok: false, http_status: resp.status, latency_ms: latency, code: "GOTENBERG_AUTH_FAILED", error: `Auth failed: HTTP ${resp.status}` };
    }
    await resp.text();
    return { ok: resp.ok, http_status: resp.status, latency_ms: latency, error: resp.ok ? undefined : `HTTP ${resp.status}` };
  } catch (e) {
    const latency = Math.round(performance.now() - t0);
    const isTimeout = e instanceof Error && e.name === "AbortError";
    return { ok: false, latency_ms: latency, code: isTimeout ? "GOTENBERG_TIMEOUT" : "GOTENBERG_UNREACHABLE", error: String(e) };
  }
}

// Конвертация DOCX → PDF через Gotenberg LibreOffice route
export async function convertDocxToPdf(cfg: GotenbergConfig, docxBuffer: Uint8Array, fileName = "document.docx"): Promise<Uint8Array> {
  if (!cfg.enabled) throw new GotenbergError("GOTENBERG_DISABLED", "Gotenberg integration отключена");
  if (!isSsrfSafeUrl(cfg.url)) throw new GotenbergError("GOTENBERG_SSRF_BLOCKED", "URL внутренний");

  const form = new FormData();
  form.append("files", new Blob([docxBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), fileName);

  let resp: Response;
  try {
    resp = await fetchWithTimeout(`${cfg.url}/forms/libreoffice/convert`, {
      method: "POST",
      headers: authHeader(cfg),
      body: form,
    }, GOTENBERG_TIMEOUT_MS);
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "AbortError";
    throw new GotenbergError(
      isTimeout ? "GOTENBERG_TIMEOUT" : "GOTENBERG_UNREACHABLE",
      isTimeout ? "Превышен таймаут конвертации" : `Сетевая ошибка: ${String(e)}`,
    );
  }

  if (resp.status === 401 || resp.status === 403) {
    await resp.text();
    throw new GotenbergError("GOTENBERG_AUTH_FAILED", `Auth failed: HTTP ${resp.status}`);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new GotenbergError("GOTENBERG_HTTP_ERROR", `HTTP ${resp.status}`, { body: txt.slice(0, 500) });
  }

  const ct = resp.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/pdf")) {
    await resp.arrayBuffer().catch(() => {});
    throw new GotenbergError("GOTENBERG_NOT_PDF", `Ожидался application/pdf, получен ${ct}`);
  }

  const ab = await resp.arrayBuffer();
  const pdf = new Uint8Array(ab);
  if (pdf.length < PDF_MIN_SIZE_BYTES) {
    throw new GotenbergError("GOTENBERG_PDF_TOO_SMALL", `PDF слишком маленький: ${pdf.length} байт`);
  }
  return pdf;
}

// Минимальный тестовый DOCX (кириллица + таблица), собирается через npm:docx
export async function buildTestDocx(): Promise<Uint8Array> {
  const docxMod = await import("npm:docx@9.5.1");
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = docxMod;
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: "Тестовая конвертация Gotenberg", bold: true, size: 32 })] }),
        new Paragraph({ children: [new TextRun({ text: "Привет, мир! Это проверка DOCX → PDF.", size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "Кириллица: АБВГДЕЁЖЗ абвгдеёжз", size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: " " })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [
              new TableCell({ children: [new Paragraph("Колонка 1")] }),
              new TableCell({ children: [new Paragraph("Колонка 2")] }),
            ]}),
            new TableRow({ children: [
              new TableCell({ children: [new Paragraph("Строка 1, ячейка А")] }),
              new TableCell({ children: [new Paragraph("Строка 1, ячейка Б")] }),
            ]}),
            new TableRow({ children: [
              new TableCell({ children: [new Paragraph("Тест 2")] }),
              new TableCell({ children: [new Paragraph("Значение 42")] }),
            ]}),
          ],
        }),
      ],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

// Маскирование значений конфига для возврата клиенту (UI status)
export function maskGotenbergConfig(cfg: Record<string, unknown> | null | undefined) {
  const c = cfg ?? {};
  const url = (c.gotenberg_url as string | undefined) ?? null;
  const basicUser = c.gotenberg_basic_user as string | undefined;
  const basicPass = c.gotenberg_basic_pass as string | undefined;
  return {
    configured: Boolean(url),
    enabled: c.gotenberg_enabled === true,
    url,
    basic_auth: Boolean(basicUser && basicPass),
    basic_user_last4: basicUser ? basicUser.slice(-4) : null,
    basic_pass_last4: basicPass ? basicPass.slice(-4) : null,
    last_health_check: (c.gotenberg_last_health_check as Record<string, unknown> | undefined) ?? null,
    last_test_convert: (c.gotenberg_last_test_convert as Record<string, unknown> | undefined) ?? null,
  };
}

export function makeAdminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
