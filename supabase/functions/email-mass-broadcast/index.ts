import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmailAccount {
  id: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_password: string;
  smtp_encryption: string;
  from_name: string;
  from_email: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64Utf8(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

async function getEmailAccount(supabase: any): Promise<EmailAccount | null> {
  // Try integration_instances first
  const { data: integration } = await supabase
    .from("integration_instances")
    .select("*")
    .eq("category", "email")
    .eq("is_default", true)
    .maybeSingle();

  if (integration?.config) {
    const config = integration.config as Record<string, unknown>;
    return {
      id: integration.id,
      email: config.email as string || "",
      smtp_host: config.smtp_host as string || "",
      smtp_port: Number(config.smtp_port) || 465,
      smtp_password: config.smtp_password as string || "",
      smtp_encryption: config.smtp_encryption as string || "SSL",
      from_name: config.from_name as string || integration.alias,
      from_email: config.from_email as string || config.email as string || "",
    };
  }

  // Try email_accounts
  const { data: account } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();

  return account;
}

async function sendEmailViaSMTP(params: {
  to: string;
  subject: string;
  html: string;
  account: EmailAccount;
}): Promise<boolean> {
  const { account } = params;

  let smtpHost = account.smtp_host;
  let smtpPort = account.smtp_port || 465;
  const username = account.email;
  let password = account.smtp_password;
  const fromName = account.from_name || "Gorbova.by";
  const fromEmail = account.from_email || account.email;

  // Auto-detect SMTP settings
  if (!smtpHost) {
    const domain = username.split("@")[1]?.toLowerCase();
    const smtpSettings: Record<string, { host: string; port: number }> = {
      "yandex.ru": { host: "smtp.yandex.ru", port: 465 },
      "yandex.com": { host: "smtp.yandex.ru", port: 465 },
      "gmail.com": { host: "smtp.gmail.com", port: 465 },
      "mail.ru": { host: "smtp.mail.ru", port: 465 },
    };
    const detected = smtpSettings[domain] || { host: "smtp.yandex.ru", port: 465 };
    smtpHost = detected.host;
    smtpPort = detected.port;
  }

  if (!password && smtpHost.includes("yandex")) {
    password = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
  }

  if (!password) {
    throw new Error(`SMTP password not set for ${username}`);
  }

  let conn: Deno.TlsConn;
  conn = await Deno.connectTls({ hostname: smtpHost, port: smtpPort });

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
        throw new Error(`SMTP error ${code}: ${response.trim()}`);
      }
    }
    return response;
  }

  try {
    const greeting = await readResponse();
    if (parseSmtpCode(greeting) !== 220) throw new Error(`SMTP greeting failed`);

    const domain = username.split("@")[1] || "gorbova.by";
    await sendCommand(`EHLO ${domain}`, [250]);
    await sendCommand("AUTH LOGIN", [334]);
    await sendCommand(b64Utf8(username), [334]);
    
    const passResp = await sendCommand(b64Utf8(password));
    if (parseSmtpCode(passResp) !== 235) throw new Error("SMTP auth failed");

    await sendCommand(`MAIL FROM:<${fromEmail}>`, [250]);
    await sendCommand(`RCPT TO:<${params.to}>`, [250, 251]);
    await sendCommand("DATA", [354]);

    const boundary = `boundary_${crypto.randomUUID()}`;
    const subjectEncoded = `=?UTF-8?B?${b64Utf8(params.subject)}?=`;
    const htmlPart = wrapBase64(b64Utf8(params.html));

    const dataLines = [
      `From: "${fromName}" <${fromEmail}>`,
      `To: ${params.to}`,
      `Subject: ${subjectEncoded}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
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
    if (parseSmtpCode(dataResp) !== 250) throw new Error("SMTP DATA failed");

    try { await sendCommand("QUIT"); } catch { /* ignore */ }
    return true;
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify admin authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin permission
    const { data: hasPermission } = await supabase.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'entitlements.manage',
    });

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { subject, html, filters } = await req.json();

    if (!subject || !html) {
      return new Response(
        JSON.stringify({ error: 'Subject and HTML are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting email broadcast...');

    // Get email account
    const emailAccount = await getEmailAccount(supabase);
    if (!emailAccount) {
      return new Response(
        JSON.stringify({ error: 'No email account configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get recipients based on filters
    let query = supabase
      .from('profiles')
      .select('user_id, email, full_name')
      .not('email', 'is', null);

    const { data: profiles } = await query.limit(1000);

    if (!profiles?.length) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, failed: 0, message: 'No recipients found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let filteredProfiles = profiles;

    // Apply filters
    if (filters?.hasActiveSubscription) {
      const { data: activeAccess } = await supabase
        .from('telegram_access')
        .select('user_id')
        .or('active_until.is.null,active_until.gt.now()');

      const activeUserIds = new Set(activeAccess?.map(a => a.user_id) || []);
      filteredProfiles = filteredProfiles.filter(p => activeUserIds.has(p.user_id));
    }

    if (filters?.productId) {
      const { data: productSubs } = await supabase
        .from('subscriptions_v2')
        .select('user_id')
        .eq('product_id', filters.productId)
        .eq('status', 'active');

      const productUserIds = new Set(productSubs?.map(s => s.user_id) || []);
      filteredProfiles = filteredProfiles.filter(p => productUserIds.has(p.user_id));
    }

    console.log(`Sending to ${filteredProfiles.length} recipients`);

    let sent = 0;
    let failed = 0;

    for (const profile of filteredProfiles) {
      if (!profile.email) continue;

      try {
        await sendEmailViaSMTP({
          to: profile.email,
          subject,
          html,
          account: emailAccount,
        });
        sent++;
        console.log(`Email sent to ${profile.email}`);

        // Log to email_logs
        await supabase.from('email_logs').insert({
          direction: 'outgoing',
          from_email: emailAccount.from_email || emailAccount.email,
          to_email: profile.email,
          subject,
          body_html: html,
          status: 'sent',
          profile_id: profile.user_id,
          template_code: 'mass_broadcast',
        });

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failed++;
        console.error(`Failed to send to ${profile.email}:`, error);

        await supabase.from('email_logs').insert({
          direction: 'outgoing',
          from_email: emailAccount.from_email || emailAccount.email,
          to_email: profile.email,
          subject,
          body_html: html,
          status: 'failed',
          error_message: (error as Error).message,
          profile_id: profile.user_id,
          template_code: 'mass_broadcast',
        });
      }
    }

    // Log to audit_logs
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'email_mass_broadcast',
      meta: {
        sent,
        failed,
        total: sent + failed,
        subject,
      },
    });

    console.log(`Email broadcast complete: sent=${sent}, failed=${failed}`);

    return new Response(
      JSON.stringify({ success: true, sent, failed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Email broadcast error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
