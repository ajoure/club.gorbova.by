import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text?: string;
  account_id?: string; // Optional: specify which email account to use
  product_id?: string; // Optional: use email account mapped to this product
  // Context for logging
  context?: {
    user_id?: string;
    profile_id?: string;
    subscription_id?: string;
    event_type?: string;
    meta?: Record<string, unknown>;
  };
}

interface EmailAccount {
  id: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_password: string;
  smtp_encryption: string;
  from_name: string;
  from_email: string;
  is_default: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64Utf8(value: string): string {
  return encode(encoder.encode(value).buffer);
}

function wrapBase64(value: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += lineLength) lines.push(value.slice(i, i + lineLength));
  return lines.join("\r\n");
}

function parseSmtpCode(response: string): number {
  const m = response.match(/^(\d{3})/m);
  return m ? Number(m[1]) : 0;
}

async function getEmailAccount(supabase: any, accountId?: string, productId?: string): Promise<EmailAccount | null> {
  // Helper to find password from email_accounts by email
  async function findPasswordByEmail(email: string): Promise<string | null> {
    const { data } = await supabase
      .from("email_accounts")
      .select("smtp_password")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle();
    return data?.smtp_password || null;
  }

  // If product_id is provided, check for product-email mapping first
  if (productId && !accountId) {
    const { data: mapping } = await supabase
      .from("product_email_mappings")
      .select("email_account_id")
      .eq("product_id", productId)
      .eq("is_active", true)
      .maybeSingle();
    
    if (mapping?.email_account_id) {
      console.log(`Using email account from product mapping: ${mapping.email_account_id}`);
      accountId = mapping.email_account_id;
    }
  }

  // First try integration_instances for email category
  if (accountId) {
    // Try integration_instances first
    const { data: integration } = await supabase
      .from("integration_instances")
      .select("*")
      .eq("id", accountId)
      .eq("category", "email")
      .maybeSingle();
    
    if (integration?.config) {
      const config = integration.config as Record<string, unknown>;
      const email = config.email as string || config.from_email as string || "";
      // Check both password field names (smtp_password and password)
      let password = config.smtp_password as string || config.password as string || "";
      if (!password && email) {
        password = await findPasswordByEmail(email) || "";
      }
      
      return {
        id: integration.id,
        email,
        smtp_host: config.smtp_host as string || "",
        smtp_port: Number(config.smtp_port) || 465,
        smtp_password: password,
        smtp_encryption: config.smtp_encryption as string || "SSL",
        from_name: config.from_name as string || integration.alias,
        from_email: config.from_email as string || email,
        is_default: integration.is_default,
      };
    }

    // Then try email_accounts
    const { data, error } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("is_active", true)
      .eq("id", accountId)
      .maybeSingle();
    
    if (!error && data) return data;
  }
  
  // Try default integration_instances for email
  const { data: defaultIntegration } = await supabase
    .from("integration_instances")
    .select("*")
    .eq("category", "email")
    .eq("is_default", true)
    .maybeSingle();
  
  if (defaultIntegration?.config) {
    const config = defaultIntegration.config as Record<string, unknown>;
    const email = config.email as string || config.from_email as string || "";
    let password = config.smtp_password as string || config.password as string || "";
    if (!password && email) {
      password = await findPasswordByEmail(email) || "";
    }
    
    return {
      id: defaultIntegration.id,
      email,
      smtp_host: config.smtp_host as string || "",
      smtp_port: Number(config.smtp_port) || 465,
      smtp_password: password,
      smtp_encryption: config.smtp_encryption as string || "SSL",
      from_name: config.from_name as string || defaultIntegration.alias,
      from_email: config.from_email as string || email,
      is_default: true,
    };
  }
  
  // Try default email_accounts
  const { data: defaultAccount } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();
  
  if (defaultAccount) return defaultAccount;
  
  // Fallback to any integration or email_accounts
  const { data: anyIntegration } = await supabase
    .from("integration_instances")
    .select("*")
    .eq("category", "email")
    .limit(1)
    .maybeSingle();
  
  if (anyIntegration?.config) {
    const config = anyIntegration.config as Record<string, unknown>;
    const email = config.email as string || config.from_email as string || "";
    let password = config.smtp_password as string || config.password as string || "";
    if (!password && email) {
      password = await findPasswordByEmail(email) || "";
    }
    
    return {
      id: anyIntegration.id,
      email,
      smtp_host: config.smtp_host as string || "",
      smtp_port: Number(config.smtp_port) || 465,
      smtp_password: password,
      smtp_encryption: config.smtp_encryption as string || "SSL",
      from_name: config.from_name as string || anyIntegration.alias,
      from_email: config.from_email as string || email,
      is_default: false,
    };
  }
  
  const { data: fallback } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  
  return fallback;
}

async function sendEmailViaSMTP(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  account: EmailAccount;
}): Promise<{ queueId?: string; smtpHost: string; smtpPort: number }> {
  const { account } = params;
  
  let smtpHost = account.smtp_host;
  let smtpPort = account.smtp_port || 465;
  const username = account.email;
  let password = account.smtp_password;
  const fromName = account.from_name || "Gorbova.by";
  const fromEmail = account.from_email || account.email;

  // Auto-detect SMTP settings if not provided
  if (!smtpHost) {
    const domain = username.split("@")[1]?.toLowerCase();
    const smtpSettings: Record<string, { host: string; port: number }> = {
      "yandex.ru": { host: "smtp.yandex.ru", port: 465 },
      "yandex.com": { host: "smtp.yandex.ru", port: 465 },
      "ya.ru": { host: "smtp.yandex.ru", port: 465 },
      "gmail.com": { host: "smtp.gmail.com", port: 465 },
      "mail.ru": { host: "smtp.mail.ru", port: 465 },
      "outlook.com": { host: "smtp-mail.outlook.com", port: 587 },
      "hotmail.com": { host: "smtp-mail.outlook.com", port: 587 },
    };
    
    const detected = smtpSettings[domain] || { host: "smtp.yandex.ru", port: 465 };
    smtpHost = detected.host;
    smtpPort = detected.port;
    console.log(`Auto-detected SMTP settings for ${domain}: ${smtpHost}:${smtpPort}`);
  }

  // Fallback for Yandex SMTP: use backend secret if password isn't stored in DB config
  if (!password && smtpHost.includes("yandex")) {
    const envPass = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
    if (envPass) password = envPass;
  }

  if (!password) {
    throw new Error(`SMTP password not set for account ${username}. Please configure the SMTP password in integration settings.`);
  }

  console.log(`Sending via SMTP: ${smtpHost}:${smtpPort} as ${username}`);

  let conn: Deno.TlsConn | Deno.TcpConn;
  
  // Connect based on encryption type
  if (account.smtp_encryption === "TLS" || smtpPort === 587) {
    // STARTTLS - connect plain first, then upgrade
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
  } else {
    // SSL/TLS - connect with TLS directly
    conn = await Deno.connectTls({ hostname: smtpHost, port: smtpPort });
  }

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
    const safeCmd = cmd.startsWith("AUTH") ? "AUTH [hidden]" : 
                    cmd.length > 50 && !cmd.startsWith("MAIL") && !cmd.startsWith("RCPT") 
                    ? cmd.substring(0, 50) + "..." : cmd;
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

    // Extract domain from email
    const domain = username.split("@")[1] || "gorbova.by";
    await sendCommand(`EHLO ${domain}`, [250]);

    // AUTH LOGIN
    await sendCommand("AUTH LOGIN", [334]);
    await sendCommand(b64Utf8(username), [334]);

    const passResp = await sendCommand(b64Utf8(password));
    const passCode = parseSmtpCode(passResp);
    if (passCode !== 235) {
      throw new Error(
        `SMTP authentication failed (${passCode}). Check SMTP password for ${username}.`,
      );
    }

    await sendCommand(`MAIL FROM:<${fromEmail}>`, [250]);
    await sendCommand(`RCPT TO:<${params.to}>`, [250, 251]);
    await sendCommand("DATA", [354]);

    const boundary = `boundary_${crypto.randomUUID()}`;
    const subjectEncoded = `=?UTF-8?B?${b64Utf8(params.subject)}?=`;

    const textPart = wrapBase64(b64Utf8(params.text || ""));
    const htmlPart = wrapBase64(b64Utf8(params.html));

    const dataLines = [
      `From: "${fromName}" <${fromEmail}>`,
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

    await conn.write(encoder.encode(dataLines + "\r\n"));
    const dataResp = await readResponse();
    console.log(`SMTP < ${dataResp.trim()}`);
    const dataCode = parseSmtpCode(dataResp);
    if (dataCode !== 250) {
      throw new Error(`SMTP DATA not accepted (${dataCode}): ${dataResp.trim()}`);
    }

    // Best-effort queue id extraction (Yandex returns: "Ok: queued on ... <queueId>")
    const queueMatch = dataResp.match(/queued[^\s]*\s+.*\s([A-Za-z0-9_-]+)\s*$/m);
    const queueId = queueMatch?.[1];

    try {
      await sendCommand("QUIT");
    } catch {
      // ignore
    }

    return { queueId, smtpHost, smtpPort };
  } finally {
    try {
      conn.close();
    } catch {
      // ignore
    }
  }

  // Unreachable; return satisfies TS
  return { smtpHost, smtpPort };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { to, subject, html, text, account_id, product_id, context }: EmailRequest = await req.json();

    // PATCH-6: Log the received context for debugging - single source of truth
    const ctx = context ?? null;
    console.log('[send-email] Received full context:', JSON.stringify(ctx));
    console.log('[send-email] Key context fields:', JSON.stringify({
      user_id: ctx?.user_id ?? 'NULL',
      profile_id: ctx?.profile_id ?? 'NULL',
      subscription_id: ctx?.subscription_id ?? 'NULL',
      event_type: ctx?.event_type ?? 'NULL',
    }));

    console.log(`Email request: to=${to}, subject=${subject}, account_id=${account_id || "default"}, product_id=${product_id || "none"}, context=${ctx ? 'yes' : 'no'}`);

    // Get email account from database (with product mapping support)
    const account = await getEmailAccount(supabase, account_id, product_id);
    
    if (!account) {
      throw new Error("No active email account found. Please configure an email account first.");
    }

    console.log(`Using email account: ${account.email} (${account.from_name || "no name"})`);

    const sendResult = await sendEmailViaSMTP({ to, subject, html, text, account });

    // PATCH-6: Log to email_logs using ctx - ENSURE subscription_id and event_type are NOT NULL
    try {
      const emailLogMeta = {
        ...(ctx?.meta || {}),
        event_type: ctx?.event_type || null,
        subscription_id: ctx?.subscription_id || null,
        smtp_host: sendResult.smtpHost,
        smtp_port: sendResult.smtpPort,
        account_id: account.id,
      };
      
      console.log('[send-email] Writing email_log with meta:', JSON.stringify({
        subscription_id: emailLogMeta.subscription_id,
        event_type: emailLogMeta.event_type,
      }));
      
      const { error: logError } = await supabase.from('email_logs').insert({
        user_id: ctx?.user_id || null,
        profile_id: ctx?.profile_id || null,
        direction: 'outgoing',
        from_email: account.from_email || account.email,
        to_email: to,
        subject,
        body_html: html,
        body_text: text || null,
        provider: 'yandex_smtp',
        provider_message_id: sendResult.queueId || null,
        status: 'sent',
        meta: emailLogMeta,
      });
      
      if (logError) {
        console.error('[send-email] Failed to log email:', logError);
      } else {
        console.log('[send-email] Email logged successfully with subscription_id:', emailLogMeta.subscription_id);
      }
    } catch (logErr) {
      console.error('Failed to log email to email_logs:', logErr);
      // Don't fail the request if logging fails
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Email accepted by SMTP server",
      from: account.from_email || account.email,
      to,
      smtp_host: sendResult.smtpHost,
      smtp_port: sendResult.smtpPort,
      queue_id: sendResult.queueId,
      note: "Доставка может занять время. Проверьте Спам/Промоакции. Ответ 250 означает, что SMTP сервер принял письмо в очередь.",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending email:", error);
    
    // Log failed email attempt
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabaseForLog = createClient(supabaseUrl, supabaseKey);
      
      // Try to extract context from request body (best effort)
      const bodyText = await req.text().catch(() => '{}');
      let parsedBody: any = {};
      try { parsedBody = JSON.parse(bodyText); } catch {}
      
      await supabaseForLog.from('email_logs').insert({
        user_id: parsedBody?.context?.user_id || null,
        profile_id: parsedBody?.context?.profile_id || null,
        direction: 'outgoing',
        from_email: 'unknown',
        to_email: parsedBody?.to || 'unknown',
        subject: parsedBody?.subject || null,
        status: 'failed',
        error_message: error?.message || 'Unknown error',
        meta: {
          event_type: parsedBody?.context?.event_type || null,
          subscription_id: parsedBody?.context?.subscription_id || null,
          error_details: error?.message,
        },
      });
    } catch (logErr) {
      console.error('Failed to log email error:', logErr);
    }
    
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
