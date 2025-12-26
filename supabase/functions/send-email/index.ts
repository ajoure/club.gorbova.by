import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

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

// Base64 encoding for auth
function base64Encode(str: string): string {
  return btoa(str);
}

// Send email via SMTP using raw socket
async function sendEmailViaSMTP(to: string, subject: string, html: string, text?: string): Promise<void> {
  const smtpHost = "smtp.yandex.ru";
  const smtpPort = 465;
  const username = "noreply@gorbova.by";
  const password = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";

  // Connect with TLS
  const conn = await Deno.connectTls({
    hostname: smtpHost,
    port: smtpPort,
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function readResponse(): Promise<string> {
    const buffer = new Uint8Array(4096);
    const bytesRead = await conn.read(buffer);
    if (bytesRead === null) throw new Error("Connection closed");
    return decoder.decode(buffer.subarray(0, bytesRead));
  }

  async function sendCommand(cmd: string): Promise<string> {
    console.log(`SMTP > ${cmd.replace(/AUTH LOGIN.*/, 'AUTH LOGIN [hidden]')}`);
    await conn.write(encoder.encode(cmd + "\r\n"));
    const response = await readResponse();
    console.log(`SMTP < ${response.trim()}`);
    return response;
  }

  try {
    // Read greeting
    const greeting = await readResponse();
    console.log(`SMTP < ${greeting.trim()}`);

    // EHLO
    await sendCommand(`EHLO gorbova.by`);

    // AUTH LOGIN
    await sendCommand(`AUTH LOGIN`);
    await sendCommand(base64Encode(username));
    await sendCommand(base64Encode(password));

    // MAIL FROM
    await sendCommand(`MAIL FROM:<${username}>`);

    // RCPT TO
    await sendCommand(`RCPT TO:<${to}>`);

    // DATA
    await sendCommand(`DATA`);

    // Construct email with MIME
    const boundary = `boundary_${Date.now()}`;
    const emailContent = [
      `From: "Gorbova.by" <${username}>`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${base64Encode(subject)}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Encode(text || ""),
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Encode(html),
      ``,
      `--${boundary}--`,
      `.`,
    ].join("\r\n");

    await sendCommand(emailContent);

    // QUIT
    await sendCommand(`QUIT`);

  } finally {
    conn.close();
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, subject, html, text }: EmailRequest = await req.json();

    console.log(`Sending email to: ${to}, subject: ${subject}`);

    await sendEmailViaSMTP(to, subject, html, text);

    console.log("Email sent successfully to:", to);

    return new Response(
      JSON.stringify({ success: true, message: "Email sent successfully" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
