import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64Utf8(value: string): string {
  return encode(encoder.encode(value).buffer);
}

function wrapBase64(value: string, lineLength = 76): string {
  // SMTP base64 is commonly wrapped at 76 chars per RFC 2045
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += lineLength) lines.push(value.slice(i, i + lineLength));
  return lines.join("\r\n");
}

function parseSmtpCode(response: string): number {
  const m = response.match(/^(\d{3})/m);
  return m ? Number(m[1]) : 0;
}

async function sendEmailViaSMTP(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const smtpHost = "smtp.yandex.ru";
  const smtpPort = 465;
  const username = "noreply@gorbova.by";
  const password = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";

  if (!password) {
    throw new Error("YANDEX_SMTP_PASSWORD is not set");
  }

  const conn = await Deno.connectTls({ hostname: smtpHost, port: smtpPort });

  async function readResponse(): Promise<string> {
    // Read until we see a line break (good enough for SMTP replies here)
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
    const safeCmd = cmd.startsWith("AUTH") ? "AUTH [hidden]" : cmd;
    console.log(`SMTP > ${safeCmd}`);

    await conn.write(encoder.encode(cmd + "\r\n"));
    const response = await readResponse();
    console.log(`SMTP < ${response.trim()}`);

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
    console.log(`SMTP < ${greeting.trim()}`);
    const greetCode = parseSmtpCode(greeting);
    if (greetCode !== 220) {
      throw new Error(`SMTP greeting failed: ${greeting.trim()}`);
    }

    await sendCommand("EHLO gorbova.by", [250]);

    // AUTH LOGIN (Yandex supports LOGIN)
    await sendCommand("AUTH LOGIN", [334]);
    await sendCommand(b64Utf8(username), [334]);

    const passResp = await sendCommand(b64Utf8(password));
    const passCode = parseSmtpCode(passResp);
    if (passCode !== 235) {
      // Most common: 535 invalid credentials (needs app password)
      throw new Error(
        `SMTP authentication failed (${passCode}). Check Yandex 360 mailbox SMTP/app password for ${username}.`,
      );
    }

    await sendCommand(`MAIL FROM:<${username}>`, [250]);
    await sendCommand(`RCPT TO:<${params.to}>`, [250, 251]);
    await sendCommand("DATA", [354]);

    const boundary = `boundary_${crypto.randomUUID()}`;
    const subjectEncoded = `=?UTF-8?B?${b64Utf8(params.subject)}?=`;

    const textPart = wrapBase64(b64Utf8(params.text || ""));
    const htmlPart = wrapBase64(b64Utf8(params.html));

    const dataLines = [
      `From: "Gorbova.by" <${username}>`,
      `To: ${params.to}`,
      `Subject: ${subjectEncoded}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      textPart,
      "",
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      htmlPart,
      "",
      `--${boundary}--`,
      "",
      ".",
    ].join("\r\n");

    // DATA must end with <CRLF>.<CRLF>
    await conn.write(encoder.encode(dataLines + "\r\n"));
    const dataResp = await readResponse();
    console.log(`SMTP < ${dataResp.trim()}`);
    const dataCode = parseSmtpCode(dataResp);
    if (dataCode !== 250) {
      throw new Error(`SMTP DATA not accepted (${dataCode}): ${dataResp.trim()}`);
    }

    // QUIT
    try {
      await sendCommand("QUIT");
    } catch {
      // ignore
    }
  } finally {
    try {
      conn.close();
    } catch {
      // ignore
    }
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, subject, html, text }: EmailRequest = await req.json();

    console.log(`Sending email to: ${to}, subject: ${subject}`);

    await sendEmailViaSMTP({ to, subject, html, text });

    return new Response(JSON.stringify({ success: true, message: "Email sent successfully" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending email:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
