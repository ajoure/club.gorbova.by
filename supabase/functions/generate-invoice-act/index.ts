import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateRequest {
  order_id: string;
  document_type: "invoice" | "act";
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

serve(async (req) => {
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

    const { order_id, document_type, client_details_id, executor_id, send_email, send_telegram }: GenerateRequest = await req.json();

    if (!order_id || !document_type) {
      return new Response(JSON.stringify({ error: "order_id and document_type required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch order with related data
    const { data: order, error: orderError } = await supabase
      .from("orders_v2")
      .select(`
        id, order_number, final_price, currency, status, created_at, customer_email,
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
    const month = String(new Date().getMonth() + 1).padStart(2, "0");
    const day = String(new Date().getDate()).padStart(2, "0");
    const docPrefix = document_type === "invoice" ? "СЧ" : "АКТ";
    
    // Get next sequence number for this type
    const { count } = await supabase
      .from("generated_documents")
      .select("*", { count: "exact", head: true })
      .eq("document_type", document_type)
      .gte("created_at", `${year}-01-01`);

    const seqNum = (count || 0) + 1;
    const documentNumber = `${docPrefix}-${year}${month}${day}-${String(seqNum).padStart(4, "0")}`;

    // Create snapshots
    const clientSnapshot = clientDetails || {
      type: "individual",
      name: order.customer_email || profile?.full_name || "Физическое лицо",
      email: order.customer_email || profile?.email,
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
            const docTypeName = document_type === "invoice" ? "Счёт" : "Акт выполненных работ";
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
            const docTypeName = document_type === "invoice" ? "📄 Счёт" : "✅ Акт выполненных работ";
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
        html: documentHtml,
        executor: executorSnapshot,
        client: clientSnapshot,
        order: orderSnapshot,
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

function generateDocumentHtml(
  type: "invoice" | "act",
  data: {
    documentNumber: string;
    documentDate: string;
    executor: any;
    client: any;
    order: any;
  }
) {
  const { documentNumber, documentDate, executor, client, order } = data;
  
  const executorName = executor.short_name || executor.full_name;
  const clientName = client.ind_full_name || client.ent_name || client.leg_name || client.name || "Заказчик";
  const serviceName = order.tariff_name 
    ? `${order.product_name} — ${order.tariff_name}`
    : order.product_name;

  if (type === "invoice") {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Счёт ${documentNumber}</title>
  <style>
    body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; margin: 40px; }
    .header { text-align: center; margin-bottom: 30px; }
    .title { font-size: 16pt; font-weight: bold; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #000; padding: 8px; text-align: left; }
    th { background: #f0f0f0; }
    .total { font-weight: bold; }
    .requisites { margin-top: 30px; font-size: 10pt; }
    .signature { margin-top: 50px; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">СЧЁТ № ${documentNumber}</div>
    <div>от ${documentDate}</div>
  </div>
  
  <p><strong>Исполнитель:</strong> ${executor.legal_form || ""} "${executorName}", УНП ${executor.unp}</p>
  <p>${executor.legal_address}</p>
  <p>р/с ${executor.bank_account} в ${executor.bank_name}, БИК ${executor.bank_code}</p>
  
  <p style="margin-top: 20px;"><strong>Заказчик:</strong> ${clientName}</p>
  ${client.ind_personal_number ? `<p>Личный номер: ${client.ind_personal_number}</p>` : ""}
  ${client.ent_unp || client.leg_unp ? `<p>УНП: ${client.ent_unp || client.leg_unp}</p>` : ""}
  
  <table>
    <thead>
      <tr>
        <th>№</th>
        <th>Наименование</th>
        <th>Кол-во</th>
        <th>Ед.</th>
        <th>Цена</th>
        <th>Сумма</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>${serviceName}</td>
        <td>1</td>
        <td>усл.</td>
        <td>${order.final_price.toFixed(2)}</td>
        <td>${order.final_price.toFixed(2)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr class="total">
        <td colspan="5" style="text-align: right;">Итого:</td>
        <td>${order.final_price.toFixed(2)} ${order.currency}</td>
      </tr>
    </tfoot>
  </table>
  
  <p>НДС не облагается.</p>
  
  <div class="signature">
    <p>${executor.director_position || "Руководитель"} _________________ ${executor.director_short_name || ""}</p>
  </div>
</body>
</html>`;
  }

  // Act
  return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Акт ${documentNumber}</title>
  <style>
    body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; margin: 40px; }
    .header { text-align: center; margin-bottom: 30px; }
    .title { font-size: 16pt; font-weight: bold; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #000; padding: 8px; text-align: left; }
    th { background: #f0f0f0; }
    .total { font-weight: bold; }
    .signatures { display: flex; justify-content: space-between; margin-top: 50px; }
    .signature-block { width: 45%; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">АКТ ВЫПОЛНЕННЫХ РАБОТ (ОКАЗАННЫХ УСЛУГ)</div>
    <div>№ ${documentNumber} от ${documentDate}</div>
  </div>
  
  <p><strong>Исполнитель:</strong> ${executor.legal_form || ""} "${executorName}", УНП ${executor.unp}, ${executor.legal_address}</p>
  <p><strong>Заказчик:</strong> ${clientName}</p>
  
  <p style="margin-top: 20px;">Мы, нижеподписавшиеся, составили настоящий акт о том, что Исполнитель оказал, а Заказчик принял следующие услуги:</p>
  
  <table>
    <thead>
      <tr>
        <th>№</th>
        <th>Наименование услуги</th>
        <th>Кол-во</th>
        <th>Ед.</th>
        <th>Цена</th>
        <th>Сумма</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>${serviceName}</td>
        <td>1</td>
        <td>усл.</td>
        <td>${order.final_price.toFixed(2)}</td>
        <td>${order.final_price.toFixed(2)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr class="total">
        <td colspan="5" style="text-align: right;">Итого:</td>
        <td>${order.final_price.toFixed(2)} ${order.currency}</td>
      </tr>
    </tfoot>
  </table>
  
  <p>НДС не облагается.</p>
  <p>Услуги оказаны полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.</p>
  
  <div class="signatures">
    <div class="signature-block">
      <p><strong>Исполнитель:</strong></p>
      <p style="margin-top: 30px;">${executor.director_position || "Руководитель"}</p>
      <p style="margin-top: 20px;">_________________ ${executor.director_short_name || ""}</p>
    </div>
    <div class="signature-block">
      <p><strong>Заказчик:</strong></p>
      <p style="margin-top: 50px;">_________________</p>
    </div>
  </div>
</body>
</html>`;
}