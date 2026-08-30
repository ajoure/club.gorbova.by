import { createClient } from "npm:@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface GenerateRequest {
  order_id: string;
  document_type?: "invoice_act"; // Only one type now
  client_details_id?: string;
  executor_id?: string;
  send_email?: boolean;
  send_telegram?: boolean;
}

// Telegram API helper
async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

// Get email account for sending
async function getEmailAccount(supabase: any): Promise<any | null> {
  // First try integration_instances for email
  const { data: integration } = await supabase
    .from("integration_instances")
    .select("*")
    .eq("category", "email")
    .eq("is_default", true)
    .maybeSingle();
  
  if (integration?.config) {
    const config = integration.config as Record<string, unknown>;
    const email = config.email as string || config.from_email as string || "";
    let password = config.smtp_password as string || config.password as string || "";
    
    // Fallback to Yandex env password
    if (!password && email.includes("yandex")) {
      password = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
    }
    
    return {
      id: integration.id,
      email,
      smtp_host: config.smtp_host as string || "smtp.yandex.ru",
      smtp_port: Number(config.smtp_port) || 465,
      smtp_password: password,
      from_name: config.from_name as string || integration.alias || "Gorbova.by",
      from_email: config.from_email as string || email,
    };
  }

  // Fallback to email_accounts
  const { data: account } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();
  
  if (account) {
    let password = account.smtp_password;
    if (!password) {
      password = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
    }
    return { ...account, smtp_password: password };
  }
  
  return null;
}

// Get Telegram bot token
async function getTelegramBotToken(supabase: any): Promise<string | null> {
  const { data: club } = await supabase
    .from("telegram_clubs")
    .select("bot_id, telegram_bots(bot_token_encrypted)")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  
  if (club?.telegram_bots?.bot_token_encrypted) {
    return club.telegram_bots.bot_token_encrypted;
  }
  
  // Fallback: direct bot query
  const { data: bot } = await supabase
    .from("telegram_bots")
    .select("bot_token_encrypted")
    .limit(1)
    .maybeSingle();
  
  return bot?.bot_token_encrypted || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { order_id, client_details_id, executor_id, send_email, send_telegram }: GenerateRequest = await req.json();
    const document_type = "invoice_act"; // Always generate combined document

    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch order with related data
    const { data: order, error: orderError } = await supabase
      .from("orders_v2")
      .select(`
        id, order_number, final_price, currency, status, created_at, customer_email, customer_phone,
        payer_type, purchase_snapshot, user_id,
        products_v2(id, name, code),
        tariffs(id, name, code)
      `)
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check user access
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, full_name, telegram_user_id")
      .eq("user_id", user.id)
      .single();

    // Check if user owns this order or has admin rights
    const { data: userOrder } = await supabase
      .from("orders_v2")
      .select("id")
      .eq("id", order_id)
      .eq("user_id", user.id)
      .single();

    const isOwner = !!userOrder;
    
    // Check admin permissions
    const { data: adminCheck } = await supabase
      .from("user_roles_v2")
      .select("roles!inner(code)")
      .eq("user_id", user.id)
      .in("roles.code", ["super_admin", "admin"]);

    const isAdmin = (adminCheck?.length || 0) > 0;

    if (!isOwner && !isAdmin) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get executor (use provided or default)
    let executor;
    if (executor_id) {
      const { data } = await supabase
        .from("executors")
        .select("*")
        .eq("id", executor_id)
        .single();
      executor = data;
    } else {
      const { data } = await supabase
        .from("executors")
        .select("*")
        .eq("is_default", true)
        .eq("is_active", true)
        .single();
      executor = data;
    }

    if (!executor) {
      return new Response(JSON.stringify({ error: "No executor found. Please configure an executor in admin panel." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get client legal details
    let clientDetails = null;
    if (client_details_id) {
      const { data } = await supabase
        .from("client_legal_details")
        .select("*")
        .eq("id", client_details_id)
        .single();
      clientDetails = data;
    } else if (profile) {
      // Try to get default client details
      const { data } = await supabase
        .from("client_legal_details")
        .select("*")
        .eq("profile_id", profile.id)
        .eq("is_default", true)
        .single();
      clientDetails = data;
    }

    // Generate document number
    const year = new Date().getFullYear();
    const docPrefix = "СА"; // Счёт-акт
    
    // Get next sequence number
    const { count } = await supabase
      .from("generated_documents")
      .select("*", { count: "exact", head: true })
      .eq("document_type", "invoice_act")
      .gte("created_at", `${year}-01-01`);

    const seqNum = (count || 0) + 1;
    const documentNumber = `${docPrefix}-${String(year).slice(-2)}-${String(seqNum).padStart(5, "0")}`;

    // Create snapshots - if no legal details, use profile data
    const clientSnapshot = clientDetails || {
      client_type: "individual",
      name: profile?.full_name || "Физическое лицо",
      phone: order.customer_phone || null,
      email: order.customer_email || profile?.email || null,
    };

    const executorSnapshot = {
      id: executor.id,
      full_name: executor.full_name,
      short_name: executor.short_name,
      legal_form: executor.legal_form,
      unp: executor.unp,
      legal_address: executor.legal_address,
      bank_name: executor.bank_name,
      bank_code: executor.bank_code,
      bank_account: executor.bank_account,
      director_position: executor.director_position,
      director_full_name: executor.director_full_name,
      director_short_name: executor.director_short_name,
      acts_on_basis: executor.acts_on_basis,
      phone: executor.phone,
      email: executor.email,
    };

    const orderProducts = order.products_v2 as any;
    const orderTariffs = order.tariffs as any;
    const purchaseSnapshot = order.purchase_snapshot as Record<string, any> | null;
    
    const orderSnapshot = {
      id: order.id,
      order_number: order.order_number,
      final_price: order.final_price,
      currency: order.currency,
      created_at: order.created_at,
      product_name: orderProducts?.name || purchaseSnapshot?.product_name || "Услуга",
      tariff_name: orderTariffs?.name || purchaseSnapshot?.tariff_name || "",
    };

    // Save document record
    const { data: docRecord, error: docError } = await supabase
      .from("generated_documents")
      .insert({
        order_id: order.id,
        profile_id: profile?.id || user.id,
        document_type,
        document_number: documentNumber,
        document_date: new Date().toISOString().split("T")[0],
        executor_id: executor.id,
        client_details_id: clientDetails?.id,
        executor_snapshot: executorSnapshot,
        client_snapshot: clientSnapshot,
        order_snapshot: orderSnapshot,
        status: "generated",
      })
      .select()
      .single();

    if (docError) {
      console.error("Error saving document:", docError);
      return new Response(JSON.stringify({ error: "Failed to save document" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate document content (HTML)
    const documentHtml = generateDocumentHtml(document_type, {
      documentNumber,
      documentDate: new Date().toLocaleDateString("ru-RU"),
      executor: executorSnapshot,
      client: clientSnapshot,
      order: orderSnapshot,
    });

    const results = {
      email_sent: false,
      telegram_sent: false,
      email_error: null as string | null,
      telegram_error: null as string | null,
    };

    // Send email if requested
    if (send_email) {
      const recipientEmail = order.customer_email || profile?.email;
      if (recipientEmail) {
        try {
          const emailAccount = await getEmailAccount(supabase);
          if (emailAccount) {
            const docTypeName = "Счёт-акт";
            const serviceName = orderSnapshot.tariff_name 
              ? `${orderSnapshot.product_name} — ${orderSnapshot.tariff_name}`
              : orderSnapshot.product_name;
            
            const emailHtml = generateEmailTemplate({
              docTypeName,
              documentNumber,
              documentDate: new Date().toLocaleDateString("ru-RU"),
              serviceName,
              amount: `${order.final_price.toFixed(2)} ${order.currency}`,
              executor: executorSnapshot,
              documentHtml,
            });

            // Call send-email function
            const { error: emailError } = await supabase.functions.invoke("send-email", {
              body: {
                to: recipientEmail,
                subject: `${docTypeName} № ${documentNumber} от ${executorSnapshot.short_name || executorSnapshot.full_name}`,
                html: emailHtml,
                text: `${docTypeName} № ${documentNumber}. Услуга: ${serviceName}. Сумма: ${order.final_price.toFixed(2)} ${order.currency}`,
              },
            });

            if (emailError) {
              console.error("Email send error:", emailError);
              results.email_error = emailError.message;
            } else {
              results.email_sent = true;
              
              // Update document record
              await supabase
                .from("generated_documents")
                .update({
                  sent_to_email: recipientEmail,
                  sent_at: new Date().toISOString(),
                })
                .eq("id", docRecord.id);
            }
          } else {
            results.email_error = "Email account not configured";
          }
        } catch (e) {
          console.error("Email error:", e);
          results.email_error = e instanceof Error ? e.message : "Unknown email error";
        }
      } else {
        results.email_error = "No recipient email";
      }
    }

    // Send Telegram if requested
    if (send_telegram) {
      const telegramUserId = profile?.telegram_user_id;
      if (telegramUserId) {
        try {
          const botToken = await getTelegramBotToken(supabase);
          if (botToken) {
            const docTypeName = "📄 Счёт-акт";
            const serviceName = orderSnapshot.tariff_name 
              ? `${orderSnapshot.product_name} — ${orderSnapshot.tariff_name}`
              : orderSnapshot.product_name;
            
            const telegramMessage = generateTelegramMessage({
              docTypeName,
              documentNumber,
              documentDate: new Date().toLocaleDateString("ru-RU"),
              serviceName,
              amount: `${order.final_price.toFixed(2)} ${order.currency}`,
              executor: executorSnapshot,
            });

            const sendResult = await telegramRequest(botToken, "sendMessage", {
              chat_id: telegramUserId,
              text: telegramMessage,
              parse_mode: "HTML",
            });

            if (sendResult.ok) {
              results.telegram_sent = true;
            } else {
              results.telegram_error = sendResult.description || "Telegram send failed";
            }
          } else {
            results.telegram_error = "Telegram bot not configured";
          }
        } catch (e) {
          console.error("Telegram error:", e);
          results.telegram_error = e instanceof Error ? e.message : "Unknown telegram error";
        }
      } else {
        results.telegram_error = "User has no Telegram linked";
      }
    }

    return new Response(JSON.stringify({
      success: true,
      document: {
        id: docRecord.id,
        document_number: documentNumber,
        document_type,
        executor: executorSnapshot,
        client: clientSnapshot,
        order: orderSnapshot,
        profile: {
          full_name: profile?.full_name || null,
          email: profile?.email || null,
        },
      },
      send_results: results,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Email template
function generateEmailTemplate(data: {
  docTypeName: string;
  documentNumber: string;
  documentDate: string;
  serviceName: string;
  amount: string;
  executor: any;
  documentHtml: string;
}): string {
  const { docTypeName, documentNumber, documentDate, serviceName, amount, executor, documentHtml } = data;
  const executorName = executor.short_name || executor.full_name;
  
  return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docTypeName} № ${documentNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 30px; }
    .info-box { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #666; }
    .info-value { font-weight: 600; color: #333; }
    .amount { font-size: 24px; color: #6366f1; font-weight: 700; }
    .document-section { margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; }
    .button { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 20px; }
    .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${docTypeName}</h1>
      <p style="margin: 10px 0 0; opacity: 0.9;">№ ${documentNumber} от ${documentDate}</p>
    </div>
    
    <div class="content">
      <p>Здравствуйте!</p>
      
      <p>Направляем вам ${docTypeName.toLowerCase()} за оказанные услуги.</p>
      
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Услуга</span>
          <span class="info-value">${serviceName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Номер документа</span>
          <span class="info-value">${documentNumber}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Дата</span>
          <span class="info-value">${documentDate}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Сумма</span>
          <span class="info-value amount">${amount}</span>
        </div>
      </div>
      
      <p><strong>От кого:</strong> ${executor.legal_form || ""} "${executorName}"<br>
      УНП: ${executor.unp}</p>
      
      <div class="document-section">
        <p style="font-weight: 600; margin-bottom: 15px;">Документ:</p>
        ${documentHtml}
      </div>
    </div>
    
    <div class="footer">
      <p>Это автоматическое сообщение. Если у вас есть вопросы, свяжитесь с нами.</p>
      <p>© ${new Date().getFullYear()} ${executorName}</p>
    </div>
  </div>
</body>
</html>`;
}

// Telegram message template
function generateTelegramMessage(data: {
  docTypeName: string;
  documentNumber: string;
  documentDate: string;
  serviceName: string;
  amount: string;
  executor: any;
}): string {
  const { docTypeName, documentNumber, documentDate, serviceName, amount, executor } = data;
  const executorName = executor.short_name || executor.full_name;
  
  return `${docTypeName}

<b>Документ:</b> № ${documentNumber}
<b>Дата:</b> ${documentDate}
<b>Услуга:</b> ${serviceName}
<b>Сумма:</b> ${amount}

<b>Исполнитель:</b> ${executor.legal_form || ""} "${executorName}"
УНП: ${executor.unp}

—
<i>Это закрывающий документ, подтверждающий оплату услуг. Сохраните его для бухгалтерского учёта.</i>

Документ также доступен в вашем личном кабинете в разделе «Мои покупки» → «Документы».`;
}

// Number to Russian words converter
function numberToWordsRu(num: number): string {
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  
  if (num === 0) return 'ноль';
  if (num < 0) return 'минус ' + numberToWordsRu(-num);
  
  let result = '';
  
  if (num >= 1000) {
    const thousands = Math.floor(num / 1000);
    if (thousands === 1) result += 'одна тысяча ';
    else if (thousands === 2) result += 'две тысячи ';
    else if (thousands >= 3 && thousands <= 4) result += ones[thousands] + ' тысячи ';
    else result += ones[thousands] + ' тысяч ';
    num %= 1000;
  }
  
  if (num >= 100) {
    result += hundreds[Math.floor(num / 100)] + ' ';
    num %= 100;
  }
  
  if (num >= 10 && num < 20) {
    result += teens[num - 10] + ' ';
  } else {
    if (num >= 20) {
      result += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
    }
    if (num > 0) {
      result += ones[num] + ' ';
    }
  }
  
  return result.trim();
}

// Date to Russian format
function dateToRussianFormat(date: Date): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Short name from full name
function fullNameToInitials(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

function generateDocumentHtml(
  _type: string,
  data: {
    documentNumber: string;
    documentDate: string;
    executor: any;
    client: any;
    order: any;
  }
) {
  const { documentNumber, executor, client, order } = data;
  const docDate = new Date();
  const dateFormatted = dateToRussianFormat(docDate);
  
  const executorName = executor.short_name || executor.full_name;
  const serviceName = order.tariff_name 
    ? `${order.product_name} — ${order.tariff_name}`
    : order.product_name;
  const price = order.final_price;
  const currency = order.currency || 'BYN';
  const priceInWords = numberToWordsRu(Math.floor(price));
  
  // Client name based on type
  let clientName = '';
  let clientSignature = '';
  const clientType = client.client_type || 'individual';
  
  if (clientType === 'individual') {
    clientName = client.ind_full_name || client.name || 'Физическое лицо';
    clientSignature = fullNameToInitials(clientName);
  } else if (clientType === 'entrepreneur') {
    clientName = client.ent_name || 'ИП';
    clientSignature = fullNameToInitials(clientName);
  } else {
    clientName = client.leg_name || 'Юридическое лицо';
    clientSignature = fullNameToInitials(client.leg_director_name || clientName);
  }
  
  const clientPhone = client.phone || '';
  const clientEmail = client.email || '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.4; }
    .header { text-align: right; margin-bottom: 20px; }
    .title { text-align: center; font-weight: bold; margin: 20px 0; }
    .parties { margin-bottom: 20px; text-align: justify; }
    .terms { margin-bottom: 20px; }
    .terms ol { padding-left: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid black; padding: 8px; text-align: center; font-size: 10pt; }
    th { background-color: #f0f0f0; }
    .total-row { font-weight: bold; }
    .sum-text { margin: 15px 0; }
    .details { margin: 20px 0; }
    .signatures { margin-top: 40px; display: flex; justify-content: space-between; }
    .signature-block { width: 45%; }
    .signature-line { border-bottom: 1px solid black; margin-top: 40px; }
    @media print { body { margin: 15mm; } }
  </style>
</head>
<body>
  <div class="header">
    <strong>оказанных услуг</strong>
  </div>
  
  <div class="title">
    СЧЁТ-АКТ<br>
    № ${documentNumber}<br>
    г. Минск ${dateFormatted} года
  </div>
  
  <div class="parties">
    ${executor.full_name}, именуемый в дальнейшем «Исполнитель», действующий на основании ${executor.acts_on_basis || 'Устава'}, с одной стороны и ${clientType === 'individual' ? `физическое лицо ${clientName}` : clientName}, именуемое в дальнейшем «Заказчик» с другой стороны, вместе именуемые «Стороны», составили настоящий счёт-акт (далее Счёт) о том, что:
  </div>
  
  <div class="terms">
    <ol>
      <li>Заказчик подтверждает, что ознакомлен с условиями публичного Договора, размещенного в сети интернет по адресу: http://gorbova.by/dokuments.</li>
      <li>Счёт является основанием для оплаты услуг Исполнителя и его оплата является акцептом публичного Договора, указанного в п. 1 настоящего счёт-акта.</li>
      <li>Стороны пришли к соглашению, что подписание Сторонами Счёта подтверждает оказание услуг Исполнителем в полном объёме. После подписания Заказчик и Исполнитель друг к другу претензий не имеют.</li>
      <li>Если Счёт составлен в валюте, то оплата его производится в белорусских рублях по курсу Национального Банка Республики Беларусь на дату проведения банком платежа.</li>
    </ol>
  </div>
  
  <table>
    <thead>
      <tr>
        <th>Наименование оказываемых услуг</th>
        <th>Единица измерения</th>
        <th>Количество</th>
        <th>Цена без НДС, ${currency}</th>
        <th>Сумма без НДС, ${currency}</th>
        <th>Ставка НДС</th>
        <th>Сумма с НДС, ${currency}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align: left;">${serviceName}</td>
        <td>услуга</td>
        <td>1</td>
        <td>${price.toFixed(2)}</td>
        <td>${price.toFixed(2)}</td>
        <td>—</td>
        <td>${price.toFixed(2)}</td>
      </tr>
      <tr class="total-row">
        <td>Итого:</td>
        <td></td>
        <td>1</td>
        <td></td>
        <td>${price.toFixed(2)}</td>
        <td>—</td>
        <td>${price.toFixed(2)}</td>
      </tr>
    </tbody>
  </table>
  
  <div class="sum-text">
    Сумма НДС: без НДС (согласно ст. 326 Налогового Кодекса Республики Беларусь).<br><br>
    Всего: ${priceInWords} ${currency === 'BYN' ? 'рублей' : currency}, 00 копеек.
  </div>
  
  <div class="terms-payment">
    Срок оплаты: 3 (три) рабочих дня.<br><br>
    Срок оказания услуг: 5 (пять) дней с даты перечисления предоплаты Заказчиком.
  </div>
  
  <div class="details">
    <strong>Заказчик:</strong><br>
    ${clientType === 'individual' ? 'Физическое лицо: ' : ''}${clientName}.<br>
    ${clientPhone ? `Телефон: ${clientPhone}. ` : ''}${clientEmail ? `Электронная почта: ${clientEmail}.` : ''}<br><br>
    
    <strong>ИСПОЛНИТЕЛЬ:</strong><br>
    ${executorName}, УНП ${executor.unp}.<br>
    Адрес: ${executor.legal_address}.<br>
    Банковские реквизиты: расчетный счет ${executor.bank_account} в ${executor.bank_name}, код ${executor.bank_code}.<br>
    ${executor.phone ? `Контактные данные: телефон ${executor.phone}` : ''}${executor.email ? `, электронная почта ${executor.email}` : ''}.
  </div>
  
  <div class="signatures">
    <div class="signature-block">
      <strong>ПОДПИСИ СТОРОН:</strong><br><br>
      Заказчик:<br>
      ${clientType === 'individual' ? 'физическое лицо' : clientName}<br>
      <div class="signature-line"></div>
      <small>/${clientSignature}/</small>
    </div>
    <div class="signature-block">
      <br><br>
      Исполнитель:<br>
      ${executor.director_position || 'Директор'}<br>
      <div class="signature-line"></div>
      <small>/${executor.director_short_name || fullNameToInitials(executor.director_full_name || '')}/</small>
    </div>
  </div>
</body>
</html>`;
}
