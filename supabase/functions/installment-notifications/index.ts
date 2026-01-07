import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  action: "test" | "upcoming" | "success" | "failed";
  email?: string;
  installment_id?: string;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

async function sendEmailViaSMTP(params: {
  to: string;
  subject: string;
  html: string;
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
}): Promise<void> {
  const { smtpHost, smtpPort, username, password, fromName, fromEmail } = params;

  console.log(`Sending via SMTP: ${smtpHost}:${smtpPort} as ${username}`);

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

    const domain = username.split("@")[1] || "gorbova.by";
    await sendCommand(`EHLO ${domain}`, [250]);

    await sendCommand("AUTH LOGIN", [334]);
    await sendCommand(b64Utf8(username), [334]);

    const passResp = await sendCommand(b64Utf8(password));
    const passCode = parseSmtpCode(passResp);
    if (passCode !== 235) {
      throw new Error(`SMTP authentication failed (${passCode}).`);
    }

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
    console.log(`SMTP < ${dataResp.trim()}`);
    const dataCode = parseSmtpCode(dataResp);
    if (dataCode !== 250) {
      throw new Error(`SMTP DATA not accepted (${dataCode}): ${dataResp.trim()}`);
    }

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

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log(`Getting email account for sending to ${to}`);
  
  // Get default email account
  const { data: account, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log(`Email account query result: ${JSON.stringify({ account: account?.email, error: error?.message })}`);

  if (!account) {
    throw new Error("No active email account found");
  }

  let password = account.smtp_password;
  
  // Fallback for Yandex SMTP
  if (!password && account.smtp_host?.includes("yandex")) {
    password = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
  }

  if (!password) {
    throw new Error(`SMTP password not set for ${account.email}`);
  }

  await sendEmailViaSMTP({
    to,
    subject,
    html,
    smtpHost: account.smtp_host || "smtp.yandex.ru",
    smtpPort: account.smtp_port || 465,
    username: account.email,
    password,
    fromName: account.from_name || "Gorbova Club",
    fromEmail: account.from_email || account.email,
  });
}

async function sendTestEmail(email: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6366f1;">🧪 Тестовое письмо</h1>
      <p>Это тестовое письмо для проверки работы почтовой системы.</p>
      <p><strong>Дата:</strong> ${new Date().toLocaleString("ru-RU")}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #6b7280; font-size: 14px;">
        Система уведомлений о рассрочках работает корректно! ✅
      </p>
    </div>
  `;
  
  await sendEmail(email, "🧪 Тест почты - Система рассрочек", html);
}

async function sendUpcomingPaymentNotification(installmentId: string): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const { data: installment, error } = await supabase
    .from("installment_payments")
    .select(`
      *,
      subscription:subscriptions_v2(
        user_id,
        product:products_v2(name)
      )
    `)
    .eq("id", installmentId)
    .single();

  if (error || !installment) {
    throw new Error(`Installment not found: ${installmentId}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", installment.subscription.user_id)
    .single();

  if (!profile?.email) {
    throw new Error("User email not found");
  }

  const dueDate = new Date(installment.due_date).toLocaleDateString("ru-RU");
  const productName = installment.subscription.product?.name || "Продукт";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #f59e0b;">📅 Напоминание о платеже</h1>
      <p>Здравствуйте${profile.full_name ? `, ${profile.full_name}` : ""}!</p>
      <p>Напоминаем, что через 3 дня будет списан очередной платёж по рассрочке.</p>
      
      <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Продукт:</strong> ${productName}</p>
        <p style="margin: 10px 0 0;"><strong>Сумма:</strong> ${installment.amount} ${installment.currency}</p>
        <p style="margin: 10px 0 0;"><strong>Дата списания:</strong> ${dueDate}</p>
        <p style="margin: 10px 0 0;"><strong>Платёж:</strong> ${installment.payment_number} из ${installment.total_payments}</p>
      </div>
      
      <p style="color: #6b7280;">
        Убедитесь, что на вашей карте достаточно средств для списания.
      </p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #9ca3af; font-size: 12px;">
        С уважением, команда Gorbova Club
      </p>
    </div>
  `;

  await sendEmail(profile.email, `📅 Напоминание о платеже ${dueDate}`, html);
}

async function sendSuccessNotification(installmentId: string): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const { data: installment, error } = await supabase
    .from("installment_payments")
    .select(`
      *,
      subscription:subscriptions_v2(
        user_id,
        product:products_v2(name)
      )
    `)
    .eq("id", installmentId)
    .single();

  if (error || !installment) {
    throw new Error(`Installment not found: ${installmentId}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", installment.subscription.user_id)
    .single();

  if (!profile?.email) {
    throw new Error("User email not found");
  }

  const productName = installment.subscription.product?.name || "Продукт";
  const remainingPayments = installment.total_payments - installment.payment_number;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #10b981;">✅ Платёж прошёл успешно</h1>
      <p>Здравствуйте${profile.full_name ? `, ${profile.full_name}` : ""}!</p>
      <p>Платёж по рассрочке успешно списан.</p>
      
      <div style="background: #d1fae5; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Продукт:</strong> ${productName}</p>
        <p style="margin: 10px 0 0;"><strong>Сумма:</strong> ${installment.amount} ${installment.currency}</p>
        <p style="margin: 10px 0 0;"><strong>Платёж:</strong> ${installment.payment_number} из ${installment.total_payments}</p>
        ${remainingPayments > 0 
          ? `<p style="margin: 10px 0 0;"><strong>Осталось платежей:</strong> ${remainingPayments}</p>`
          : `<p style="margin: 10px 0 0; color: #059669;"><strong>🎉 Рассрочка полностью оплачена!</strong></p>`
        }
      </div>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #9ca3af; font-size: 12px;">
        С уважением, команда Gorbova Club
      </p>
    </div>
  `;

  await sendEmail(profile.email, `✅ Платёж по рассрочке прошёл успешно`, html);
}

async function sendFailedNotification(installmentId: string): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const { data: installment, error } = await supabase
    .from("installment_payments")
    .select(`
      *,
      subscription:subscriptions_v2(
        user_id,
        product:products_v2(name)
      )
    `)
    .eq("id", installmentId)
    .single();

  if (error || !installment) {
    throw new Error(`Installment not found: ${installmentId}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", installment.subscription.user_id)
    .single();

  if (!profile?.email) {
    throw new Error("User email not found");
  }

  const productName = installment.subscription.product?.name || "Продукт";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #ef4444;">❌ Ошибка при списании</h1>
      <p>Здравствуйте${profile.full_name ? `, ${profile.full_name}` : ""}!</p>
      <p>К сожалению, не удалось списать платёж по рассрочке.</p>
      
      <div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Продукт:</strong> ${productName}</p>
        <p style="margin: 10px 0 0;"><strong>Сумма:</strong> ${installment.amount} ${installment.currency}</p>
        <p style="margin: 10px 0 0;"><strong>Платёж:</strong> ${installment.payment_number} из ${installment.total_payments}</p>
        ${installment.error_message 
          ? `<p style="margin: 10px 0 0;"><strong>Причина:</strong> ${installment.error_message}</p>`
          : ""
        }
      </div>
      
      <p style="color: #dc2626;">
        <strong>Что делать?</strong>
      </p>
      <ul>
        <li>Проверьте баланс вашей карты</li>
        <li>Убедитесь, что карта не заблокирована</li>
        <li>Свяжитесь с поддержкой, если проблема повторяется</li>
      </ul>
      
      <p>Мы повторим попытку списания в ближайшее время.</p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #9ca3af; font-size: 12px;">
        С уважением, команда Gorbova Club
      </p>
    </div>
  `;

  await sendEmail(profile.email, `❌ Ошибка при списании по рассрочке`, html);
}

async function sendUpcomingReminders(): Promise<{ sent: number; errors: string[] }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
  const startOfDay = new Date(threeDaysFromNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(threeDaysFromNow);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: installments, error } = await supabase
    .from("installment_payments")
    .select("id")
    .eq("status", "pending")
    .gte("due_date", startOfDay.toISOString())
    .lte("due_date", endOfDay.toISOString());

  if (error) {
    throw new Error(`Failed to fetch installments: ${error.message}`);
  }

  let sent = 0;
  const errors: string[] = [];

  for (const installment of installments || []) {
    try {
      await sendUpcomingPaymentNotification(installment.id);
      sent++;
    } catch (err: any) {
      errors.push(`${installment.id}: ${err.message}`);
    }
  }

  return { sent, errors };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, email, installment_id }: NotificationRequest = await req.json();

    console.log(`Notification request: action=${action}, email=${email}, installment_id=${installment_id}`);

    switch (action) {
      case "test":
        if (!email) throw new Error("Email is required for test action");
        await sendTestEmail(email);
        return new Response(
          JSON.stringify({ success: true, message: `Test email sent to ${email}` }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );

      case "upcoming":
        if (installment_id) {
          await sendUpcomingPaymentNotification(installment_id);
          return new Response(
            JSON.stringify({ success: true, message: "Upcoming payment notification sent" }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        } else {
          const result = await sendUpcomingReminders();
          return new Response(
            JSON.stringify({ success: true, ...result }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

      case "success":
        if (!installment_id) throw new Error("installment_id is required for success action");
        await sendSuccessNotification(installment_id);
        return new Response(
          JSON.stringify({ success: true, message: "Success notification sent" }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );

      case "failed":
        if (!installment_id) throw new Error("installment_id is required for failed action");
        await sendFailedNotification(installment_id);
        return new Response(
          JSON.stringify({ success: true, message: "Failed notification sent" }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("Error in installment-notifications:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
