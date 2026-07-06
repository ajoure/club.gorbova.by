// Минимальный SMTP-отправитель для Яндекса (smtp.yandex.ru:465, SSL).
// Используется auth-email-hook для отправки писем аутентификации напрямую
// через корпоративный ящик noreply@gorbova.by, минуя инфраструктуру Lovable.
//
// Логика взята из supabase/functions/send-email/index.ts (sendEmailViaSMTP),
// но без зависимости от account/integration_instances — параметры передаются явно.
import { encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";
import { encodeAddressHeader, encodeMimeHeader } from "./mime-header.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64Utf8(value: string): string {
  return encode(encoder.encode(value).buffer);
}

function wrapBase64(value: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += lineLength) {
    lines.push(value.slice(i, i + lineLength));
  }
  return lines.join("\r\n");
}

function parseSmtpCode(response: string): number {
  const m = response.match(/^(\d{3})/m);
  return m ? Number(m[1]) : 0;
}

export interface YandexSmtpParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName: string;
  fromEmail: string;
  /** Optional Reply-To display name; email is required if display name present. */
  replyToName?: string;
  replyToEmail?: string;
  smtpHost?: string;
  smtpPort?: number;
  username: string;
  password: string;
}

export async function sendViaYandexSmtp(
  params: YandexSmtpParams,
): Promise<{ queueId?: string }> {
  const smtpHost = params.smtpHost || "smtp.yandex.ru";
  const smtpPort = params.smtpPort || 465;
  const conn = await Deno.connectTls({ hostname: smtpHost, port: smtpPort });

  async function readResponse(): Promise<string> {
    let out = "";
    const buf = new Uint8Array(4096);
    while (!out.includes("\n")) {
      const n = await conn.read(buf);
      if (n === null) break;
      out += decoder.decode(buf.subarray(0, n));
      if (n < buf.length) break;
    }
    return out;
  }

  async function sendCommand(cmd: string, expectCodes?: number[]): Promise<string> {
    await conn.write(encoder.encode(cmd + "\r\n"));
    const response = await readResponse();
    if (expectCodes && expectCodes.length) {
      const code = parseSmtpCode(response);
      if (!expectCodes.includes(code)) {
        throw new Error(`SMTP unexpected response ${code}: ${response.trim()}`);
      }
    }
    return response;
  }

  try {
    const greeting = await readResponse();
    if (parseSmtpCode(greeting) !== 220) {
      throw new Error(`SMTP greeting failed: ${greeting.trim()}`);
    }

    const domain = params.username.split("@")[1] || "gorbova.by";
    await sendCommand(`EHLO ${domain}`, [250]);
    await sendCommand("AUTH LOGIN", [334]);
    await sendCommand(b64Utf8(params.username), [334]);
    const passResp = await sendCommand(b64Utf8(params.password));
    if (parseSmtpCode(passResp) !== 235) {
      throw new Error(`SMTP authentication failed: ${passResp.trim()}`);
    }

    await sendCommand(`MAIL FROM:<${params.fromEmail}>`, [250]);
    await sendCommand(`RCPT TO:<${params.to}>`, [250, 251]);
    await sendCommand("DATA", [354]);

    const altBoundary = `alt_${crypto.randomUUID()}`;
    const subjectEncoded = `=?UTF-8?B?${b64Utf8(params.subject)}?=`;
    const textPart = wrapBase64(b64Utf8(params.text || ""));
    const htmlPart = wrapBase64(b64Utf8(params.html));

    const lines: string[] = [
      `From: "${params.fromName}" <${params.fromEmail}>`,
      `To: ${params.to}`,
      `Subject: ${subjectEncoded}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      `--${altBoundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      textPart,
      "",
      `--${altBoundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      htmlPart,
      "",
      `--${altBoundary}--`,
      "",
      ".",
    ];

    await conn.write(encoder.encode(lines.join("\r\n") + "\r\n"));
    const dataResp = await readResponse();
    if (parseSmtpCode(dataResp) !== 250) {
      throw new Error(`SMTP DATA not accepted: ${dataResp.trim()}`);
    }

    const queueMatch = dataResp.match(/queued[^\s]*\s+.*\s([A-Za-z0-9_-]+)\s*$/m);
    const queueId = queueMatch?.[1];

    try {
      await sendCommand("QUIT");
    } catch {
      // ignore
    }

    return { queueId };
  } finally {
    try {
      conn.close();
    } catch {
      // ignore
    }
  }
}
