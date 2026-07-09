/**
 * Тонкий HTTP-клиент к API «Ресурс Развития».
 *
 * Правила:
 *  - Basic Auth (login:password) в заголовке.
 *  - Content-Type: application/json, метод всегда POST (по документации РР).
 *  - Ретрай — только для сетевых ошибок и 5xx/429, не для 4xx.
 *  - Логировать только host+pathname+method+status+duration.
 *    Query string полностью отбрасываем; тело запроса/ответа не логируем.
 */

export interface RRHttpCallInput {
  baseUrl: string;
  path: string; // например "/createOrder" или "/{id}/getOrderStatus"
  login: string;
  password: string;
  body: unknown;
  correlationId?: string;
  timeoutMs?: number;
}

export interface RRHttpCallResult {
  ok: boolean;
  status: number;
  json: unknown;
  durationMs: number;
  /** Безопасное описание запроса для лога/audit. Без query, без секретов. */
  safeCallDescriptor: {
    method: "POST";
    host: string;
    pathname: string;
    status: number;
    durationMs: number;
  };
}

function toBasic(login: string, password: string): string {
  return "Basic " + btoa(`${login}:${password}`);
}

function safeDescriptor(
  url: string,
  status: number,
  durationMs: number,
): RRHttpCallResult["safeCallDescriptor"] {
  const u = new URL(url);
  return {
    method: "POST",
    host: u.host,
    pathname: u.pathname,
    status,
    durationMs,
  };
}

export async function rrHttpPost(
  input: RRHttpCallInput,
): Promise<RRHttpCallResult> {
  const url = input.baseUrl.replace(/\/$/, "") + input.path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000);

  const started = Date.now();
  try {
    const headers: Record<string, string> = {
      "Authorization": toBasic(input.login, input.password),
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (input.correlationId) {
      headers["X-Correlation-ID"] = input.correlationId;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body ?? {}),
      signal: controller.signal,
    });

    const durationMs = Date.now() - started;
    let json: unknown = null;
    const text = await resp.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    return {
      ok: resp.ok,
      status: resp.status,
      json,
      durationMs,
      safeCallDescriptor: safeDescriptor(url, resp.status, durationMs),
    };
  } catch (e) {
    const durationMs = Date.now() - started;
    return {
      ok: false,
      status: 0,
      json: { error: { text: (e as Error).message, code: "network_error" } },
      durationMs,
      safeCallDescriptor: safeDescriptor(url, 0, durationMs),
    };
  } finally {
    clearTimeout(timeout);
  }
}
