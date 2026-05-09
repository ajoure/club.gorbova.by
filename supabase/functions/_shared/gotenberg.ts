// Shared helper: DOCX/HTML → PDF через Gotenberg на VPS hoster.by
//
// Source of truth for credentials:
//   url:        DB integration_instances.config.gotenberg_url  ||  ENV GOTENBERG_BASE_URL
//   user:       DB                                  basic_user ||  ENV GOTENBERG_USERNAME
//   password:   ONLY ENV GOTENBERG_PASSWORD (никогда не хранится в DB plain-text)
//   enabled:    DB.gotenberg_enabled (default: true если url задан хотя бы где-то)
//
// SSRF: жёсткий allowlist (`pdf.gorbova.by` в prod, `127.0.0.1` только если ALLOW_LOCAL=true).
// Сетевые retry: 1 retry на network/timeout/5xx, никогда на 4xx.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const GOTENBERG_TIMEOUT_MS = 120_000;
export const GOTENBERG_HEALTH_TIMEOUT_MS = 10_000;
export const PDF_MIN_SIZE_BYTES = 10 * 1024;

const ALLOWED_HOSTS_PROD = new Set<string>(["pdf.gorbova.by"]);
const ALLOWED_HOSTS_DEV = new Set<string>(["127.0.0.1", "localhost"]);

export type GotenbergErrorCode =
  | "GOTENBERG_NOT_CONFIGURED"
  | "GOTENBERG_DISABLED"
  | "GOTENBERG_URL_NOT_ALLOWED"
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
  source: { url: "db" | "env" | "none"; user: "db" | "env" | "none"; pass: "env" | "none" };
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

function isUrlAllowed(url: string): { ok: true } | { ok: false; reason: GotenbergErrorCode; msg: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "GOTENBERG_URL_NOT_ALLOWED", msg: "Некорректный URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "GOTENBERG_URL_NOT_ALLOWED", msg: "Только http(s)" };
  }
  const host = parsed.hostname.toLowerCase();
  const allowLocal = (Deno.env.get("GOTENBERG_ALLOW_LOCAL") ?? "").toLowerCase() === "true";
  if (ALLOWED_HOSTS_PROD.has(host)) return { ok: true };
  if (allowLocal && ALLOWED_HOSTS_DEV.has(host)) return { ok: true };
  // SSRF guard для не-allowlisted
  if (
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) || /^169\.254\./.test(host) ||
    /^100\.64\./.test(host) || host === "::1" || host === "metadata.google.internal" || host === "localhost"
  ) {
    return { ok: false, reason: "GOTENBERG_SSRF_BLOCKED", msg: `SSRF: ${host} запрещён` };
  }
  return { ok: false, reason: "GOTENBERG_URL_NOT_ALLOWED", msg: `Хост ${host} не в allowlist (разрешён только pdf.gorbova.by)` };
}

export async function loadGotenbergConfig(adminClient: SupabaseClient): Promise<GotenbergConfig> {
  const envUrl = (Deno.env.get("GOTENBERG_BASE_URL") ?? "").trim();
  const envUser = (Deno.env.get("GOTENBERG_USERNAME") ?? "").trim();
  const envPass = (Deno.env.get("GOTENBERG_PASSWORD") ?? "").trim();

  let dbUrl: string | undefined;
  let dbUser: string | undefined;
  let dbEnabled: boolean | undefined;
  try {
    const { data } = await adminClient
      .from("integration_instances")
      .select("config")
      .eq("provider", "hosterby")
      .eq("category", "other")
      .maybeSingle();
    const cfg = (data?.config ?? {}) as Record<string, unknown>;
    dbUrl = (cfg.gotenberg_url as string | undefined)?.trim() || undefined;
    dbUser = (cfg.gotenberg_basic_user as string | undefined)?.trim() || undefined;
    dbEnabled = typeof cfg.gotenberg_enabled === "boolean" ? cfg.gotenberg_enabled : undefined;
  } catch {
    // нет инстанса — fallback только на ENV
  }

  const url = dbUrl || envUrl;
  if (!url) {
    throw new GotenbergError("GOTENBERG_NOT_CONFIGURED", "GOTENBERG_BASE_URL не задан (ни в DB, ни в ENV)");
  }
  const basicUser = dbUser || envUser || undefined;
  const basicPass = envPass || undefined; // ВАЖНО: пароль ТОЛЬКО из ENV

  // Если URL/user задан, но пароль — нет, и URL требует Basic Auth → fail при первом запросе с AUTH_FAILED.
  // Здесь не падаем, чтобы health-check мог отработать и сообщить осмысленно.

  const enabled = dbEnabled ?? true;

  return {
    url: url.replace(/\/+$/, ""),
    basicUser,
    basicPass,
    enabled,
    source: {
      url: dbUrl ? "db" : envUrl ? "env" : "none",
      user: dbUser ? "db" : envUser ? "env" : "none",
      pass: envPass ? "env" : "none",
    },
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

// Один retry на network error / timeout / HTTP 5xx. НЕТ retry на 4xx.
async function fetchWithRetry(url: string, init: RequestInit, ms: number): Promise<Response> {
  try {
    const r = await fetchWithTimeout(url, init, ms);
    if (r.status >= 500 && r.status <= 599) {
      await r.text().catch(() => {});
      return await fetchWithTimeout(url, init, ms);
    }
    return r;
  } catch (e) {
    // network/timeout → 1 retry
    return await fetchWithTimeout(url, init, ms);
  }
}

export interface HealthCheckResult {
  ok: boolean;
  http_status?: number;
  latency_ms: number;
  error?: string;
  code?: GotenbergErrorCode;
  modules?: { status?: string; chromium?: string; libreoffice?: string };
}

export async function gotenbergHealthCheck(cfg: GotenbergConfig): Promise<HealthCheckResult> {
  const allow = isUrlAllowed(cfg.url);
  if (!allow.ok) return { ok: false, latency_ms: 0, code: allow.reason, error: allow.msg };
  const t0 = performance.now();
  try {
    const resp = await fetchWithTimeout(`${cfg.url}/health`, { headers: authHeader(cfg) }, GOTENBERG_HEALTH_TIMEOUT_MS);
    const latency = Math.round(performance.now() - t0);
    const text = await resp.text().catch(() => "");
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, http_status: resp.status, latency_ms: latency, code: "GOTENBERG_AUTH_FAILED", error: `Auth failed: HTTP ${resp.status}` };
    }
    let modules: HealthCheckResult["modules"] | undefined;
    try {
      const parsed = JSON.parse(text);
      const details = (parsed?.details ?? parsed) as Record<string, unknown>;
      modules = {
        status: parsed?.status as string | undefined,
        chromium: (details?.chromium as { status?: string } | undefined)?.status,
        libreoffice: (details?.libreoffice as { status?: string } | undefined)?.status,
      };
    } catch { /* not JSON, ignore */ }
    return {
      ok: resp.ok,
      http_status: resp.status,
      latency_ms: latency,
      modules,
      error: resp.ok ? undefined : `HTTP ${resp.status}`,
    };
  } catch (e) {
    const latency = Math.round(performance.now() - t0);
    const isTimeout = e instanceof Error && e.name === "AbortError";
    return { ok: false, latency_ms: latency, code: isTimeout ? "GOTENBERG_TIMEOUT" : "GOTENBERG_UNREACHABLE", error: String(e) };
  }
}

async function postFormForPdf(cfg: GotenbergConfig, path: string, form: FormData): Promise<Uint8Array> {
  if (!cfg.enabled) throw new GotenbergError("GOTENBERG_DISABLED", "Gotenberg отключён");
  const allow = isUrlAllowed(cfg.url);
  if (!allow.ok) throw new GotenbergError(allow.reason, allow.msg);
  let resp: Response;
  try {
    resp = await fetchWithRetry(`${cfg.url}${path}`, {
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
    await resp.text().catch(() => {});
    throw new GotenbergError("GOTENBERG_AUTH_FAILED", `Auth failed: HTTP ${resp.status}`);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new GotenbergError("GOTENBERG_HTTP_ERROR", `HTTP ${resp.status}`, { body: txt.slice(0, 500) });
  }
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/pdf")) {
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

// DOCX → PDF (LibreOffice route)
export async function convertDocxToPdf(cfg: GotenbergConfig, docxBuffer: Uint8Array, fileName = "document.docx"): Promise<Uint8Array> {
  const form = new FormData();
  form.append("files", new Blob([docxBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), fileName);
  return await postFormForPdf(cfg, "/forms/libreoffice/convert", form);
}

// HTML → PDF (Chromium route). HTML должен быть полным документом (`<!doctype html><html>…`).
export async function convertHtmlToPdf(cfg: GotenbergConfig, html: string): Promise<Uint8Array> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  return await postFormForPdf(cfg, "/forms/chromium/convert/html", form);
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

// Маскирование значений конфига для возврата клиенту (UI status).
// Никогда не возвращает реальный пароль (его и нет в DB) — только источник + last4 ENV-пароля.
export function maskGotenbergConfig(cfg: Record<string, unknown> | null | undefined) {
  const c = cfg ?? {};
  const dbUrl = (c.gotenberg_url as string | undefined) ?? null;
  const dbUser = c.gotenberg_basic_user as string | undefined;
  const envUrl = (Deno.env.get("GOTENBERG_BASE_URL") ?? "").trim() || null;
  const envUser = (Deno.env.get("GOTENBERG_USERNAME") ?? "").trim() || null;
  const envPass = (Deno.env.get("GOTENBERG_PASSWORD") ?? "").trim() || "";
  const effectiveUrl = dbUrl || envUrl;
  const effectiveUser = dbUser || envUser;
  return {
    configured: Boolean(effectiveUrl),
    enabled: c.gotenberg_enabled !== false,
    url: effectiveUrl,
    url_source: dbUrl ? "db" : envUrl ? "env" : "none",
    basic_user_last4: effectiveUser ? effectiveUser.slice(-4) : null,
    basic_user_source: dbUser ? "db" : envUser ? "env" : "none",
    password_configured: envPass.length > 0,
    password_last4: envPass ? envPass.slice(-4) : null,
    password_source: envPass ? "env" : "none",
    last_health_check: (c.gotenberg_last_health_check as Record<string, unknown> | undefined) ?? null,
    last_test_convert: (c.gotenberg_last_test_convert as Record<string, unknown> | undefined) ?? null,
  };
}

export function makeAdminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
