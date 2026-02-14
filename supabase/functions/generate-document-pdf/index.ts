import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateRequest {
  order_id: string;
  document_type: "invoice_act"; // счёт-акт
  send_email?: boolean;
  send_telegram?: boolean;
  client_details_id?: string;
  executor_id?: string;
}

// Helper to convert number to Russian words
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

// Convert date to Russian month word format
function dateToRussianFormat(date: Date): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

// Generate short name from full name (e.g., "Иванов Иван Иванович" -> "Иванов И.И.")
function fullNameToInitials(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

// Generate short company name from full name
function extractShortName(fullName: string): string {
  if (!fullName) return '';
  // Match patterns like ЗАО «Name» or ООО "Name"
  const match = fullName.match(/(ЗАО|ООО|ОАО|ИП|УП|ЧТУП|СООО)\s*[«"]([^»"]+)[»"]/i);
  if (match) {
    return `${match[1]} «${match[2]}»`;
  }
  // If no quotes found, try to extract abbreviation
  const abbrevMatch = fullName.match(/^(ЗАО|ООО|ОАО|ИП|УП|ЧТУП|СООО)/i);
  if (abbrevMatch) {
    // Take first few words
    const words = fullName.split(/\s+/).slice(0, 3);
    return words.join(' ');
  }
  return fullName.substring(0, 50);
}

// Generate document HTML for PDF conversion
function generateDocumentHtml(data: {
  documentNumber: string;
  documentDate: Date;
  executor: any;
  client: any;
  clientType: string;
  order: any;
  serviceName: string;
  quantity: number;
  price: number;
  currency: string;
  paymentTerm: number;
  executionTerm: number;
  unit: string;
}): string {
  const dateFormatted = dateToRussianFormat(data.documentDate);
  const priceInWords = numberToWordsRu(Math.floor(data.price));
  const executorShortName = data.executor.short_name || extractShortName(data.executor.full_name);
  
  // Client name based on type
  let clientName = '';
  let clientSignature = '';
  if (data.clientType === 'individual') {
    clientName = `физическое лицо ${data.client.last_name || ''} ${data.client.first_name || ''}`.trim();
    clientSignature = fullNameToInitials(`${data.client.last_name || ''} ${data.client.first_name || ''}`);
  } else if (data.clientType === 'entrepreneur') {
    clientName = data.client.ent_name || '';
    clientSignature = fullNameToInitials(data.client.ent_name || '');
  } else {
    clientName = data.client.leg_name || '';
    clientSignature = fullNameToInitials(data.client.leg_director_name || data.client.leg_name);
  }
  
  // Client contact info
  const clientPhone = data.client.phone || data.client.ind_phone || '';
  const clientEmail = data.client.email || data.client.ind_email || '';

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
  </style>
</head>
<body>
  <div class="header">
    <strong>оказанных услуг</strong>
  </div>
  
  <div class="title">
    СЧËТ-АКТ<br>
    № ${data.documentNumber}<br>
    г. Минск ${dateFormatted} года
  </div>
  
  <div class="parties">
    ${data.executor.full_name}, именуемый в дальнейшем «Исполнитель», действующий на основании ${data.executor.acts_on_basis || 'Устава'}, с одной стороны и ${clientName}, именуемое в дальнейшем «Заказчик» с другой стороны, вместе именуемые «Стороны», составили настоящий счёт-акт (далее Счёт) о том, что:
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
        <th>Цена без НДС, ${data.currency}</th>
        <th>Сумма без НДС, ${data.currency}</th>
        <th>Ставка НДС, ${data.currency}</th>
        <th>Сумма с НДС, ${data.currency}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${data.serviceName}</td>
        <td>${data.unit}</td>
        <td>${data.quantity}</td>
        <td>${data.price.toFixed(2)}</td>
        <td>${(data.price * data.quantity).toFixed(2)}</td>
        <td>—</td>
        <td>${(data.price * data.quantity).toFixed(2)}</td>
      </tr>
      <tr class="total-row">
        <td>Итого:</td>
        <td></td>
        <td>${data.quantity}</td>
        <td></td>
        <td>${(data.price * data.quantity).toFixed(2)}</td>
        <td>—</td>
        <td>${(data.price * data.quantity).toFixed(2)}</td>
      </tr>
    </tbody>
  </table>
  
  <div class="sum-text">
    Сумма НДС: без НДС (согласно ст. 326 Налогового Кодекса Республики Беларусь).<br><br>
    Всего: ${priceInWords} рублей, 00 копеек.
  </div>
  
  <div class="terms-payment">
    Срок оплаты: ${data.paymentTerm} (${numberToWordsRu(data.paymentTerm)}) рабочих дня.<br><br>
    Срок оказания услуг: ${data.executionTerm} (${numberToWordsRu(data.executionTerm)}) рабочих дней с даты перечисления предоплаты Заказчиком.
  </div>
  
  <div class="details">
    <strong>Заказчик:</strong><br>
    ${clientName}.<br>
    Телефон ${clientPhone}. Электронная почта: ${clientEmail}.<br><br>
    
    <strong>ИСПОЛНИТЕЛЬ:</strong><br>
    ${executorShortName}, УНП ${data.executor.unp}.<br>
    Адрес: ${data.executor.legal_address}.<br>
    Банковские реквизиты: расчетный счет ${data.executor.bank_account} в ${data.executor.bank_name}, код ${data.executor.bank_code}.<br>
    Контактные данные: телефон ${data.executor.phone || ''}, электронная почта ${data.executor.email || ''}.
  </div>
  
  <div class="signatures">
    <div class="signature-block">
      <strong>ПОДПИСИ СТОРОН:</strong><br><br>
      Заказчик:<br>
      ${data.clientType === 'individual' ? 'физическое лицо' : clientName}<br>
      <div class="signature-line"></div>
      <small>/${clientSignature}/</small>
    </div>
    <div class="signature-block">
      <br><br>
      Исполнитель:<br>
      ${data.executor.director_position || 'Директор'}<br>
      <div class="signature-line"></div>
      <small>/${data.executor.director_short_name || fullNameToInitials(data.executor.director_full_name || '')}/</small>
    </div>
  </div>
</body>
</html>`;
}

// Generate email template
function generateEmailTemplate(data: {
  documentNumber: string;
  documentDate: Date;
  executorName: string;
  clientName: string;
  amount: number;
  currency: string;
  downloadUrl: string;
}): string {
  const dateFormatted = dateToRussianFormat(data.documentDate);
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2c5282;">Счёт-акт № ${data.documentNumber}</h2>
    
    <p>Уважаемый(-ая) ${data.clientName}!</p>
    
    <p>Направляем вам закрывающий документ по оказанным услугам:</p>
    
    <div style="background-color: #f7fafc; border-left: 4px solid #4299e1; padding: 15px; margin: 20px 0;">
      <p style="margin: 5px 0;"><strong>Документ:</strong> Счёт-акт № ${data.documentNumber}</p>
      <p style="margin: 5px 0;"><strong>Дата:</strong> ${dateFormatted}</p>
      <p style="margin: 5px 0;"><strong>Сумма:</strong> ${data.amount.toFixed(2)} ${data.currency}</p>
      <p style="margin: 5px 0;"><strong>Исполнитель:</strong> ${data.executorName}</p>
    </div>
    
    <p>
      <a href="${data.downloadUrl}" style="display: inline-block; background-color: #4299e1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
        📄 Скачать документ (PDF)
      </a>
    </p>
    
    <p style="color: #718096; font-size: 14px; margin-top: 30px;">
      Документ действителен без подписи и печати согласно законодательству Республики Беларусь.<br>
      Ссылка для скачивания действительна в течение 7 дней.
    </p>
    
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
    
    <p style="color: #a0aec0; font-size: 12px;">
      ${data.executorName}<br>
      Это автоматическое сообщение, пожалуйста, не отвечайте на него.
    </p>
  </div>
</body>
</html>`;
}

// Generate Telegram message
function generateTelegramCaption(data: {
  documentNumber: string;
  documentDate: Date;
  executorName: string;
  amount: number;
  currency: string;
}): string {
  const dateFormatted = dateToRussianFormat(data.documentDate);
  
  return `📄 *Счёт-акт № ${data.documentNumber}*

📅 Дата: ${dateFormatted}
💰 Сумма: ${data.amount.toFixed(2)} ${data.currency}
🏢 Исполнитель: ${data.executorName}

_Документ действителен без подписи и печати_`;
}

async function getTelegramBotToken(supabaseClient: any): Promise<string | null> {
  const { data: botData } = await supabaseClient
    .from('telegram_bots')
    .select('token')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .single();
  
  return botData?.token || null;
}

async function getEmailAccount(supabaseClient: any): Promise<any> {
  const { data: emailAccount } = await supabaseClient
    .from('email_accounts')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .limit(1)
    .single();
  
  return emailAccount;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const requestData: GenerateRequest = await req.json();
    const { order_id, document_type, send_email, send_telegram, client_details_id, executor_id } = requestData;

    console.log('Generating document for order:', order_id, 'type:', document_type);

    // Fetch order with related data
    const { data: order, error: orderError } = await supabaseClient
      .from('orders_v2')
      .select(`
        *,
        product:products_v2(*),
        tariff:tariffs(*),
        payments:payments_v2(*)
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      throw new Error('Order not found');
    }

    // Check access
    const isOwner = order.user_id === user.id;
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabaseClient.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabaseClient.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);
    
    if (!isOwner && !isAdmin && !isSuperAdmin) {
      throw new Error('Access denied');
    }

    // Get profile for the order owner
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('user_id', order.user_id)
      .single();

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Get executor (default if not specified)
    let executor;
    if (executor_id) {
      const { data: exec } = await supabaseClient
        .from('executors')
        .select('*')
        .eq('id', executor_id)
        .single();
      executor = exec;
    } else {
      const { data: exec } = await supabaseClient
        .from('executors')
        .select('*')
        .eq('is_default', true)
        .eq('is_active', true)
        .single();
      executor = exec;
    }

    if (!executor) {
      throw new Error('Executor not found. Please configure an executor first.');
    }

    // Get client legal details if available
    let clientDetails = null;
    let clientType = 'individual';
    
    if (client_details_id) {
      const { data: details } = await supabaseClient
        .from('client_legal_details')
        .select('*')
        .eq('id', client_details_id)
        .single();
      clientDetails = details;
      clientType = details?.client_type || 'individual';
    } else {
      // Try to get default legal details for the user
      const { data: details } = await supabaseClient
        .from('client_legal_details')
        .select('*')
        .eq('profile_id', profile.id)
        .eq('is_default', true)
        .single();
      
      if (details) {
        clientDetails = details;
        clientType = details.client_type;
      }
    }

    // Merge client data
    const clientData = clientDetails ? {
      ...clientDetails,
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: clientDetails.email || profile.email,
      phone: clientDetails.phone || profile.phone,
    } : {
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
      phone: profile.phone,
    };

    // Generate document number
    const year = new Date().getFullYear().toString().slice(-2);
    const { count } = await supabaseClient
      .from('generated_documents')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${new Date().getFullYear()}-01-01`);
    
    const docNumber = `СА-${year}-${String((count || 0) + 1).padStart(5, '0')}`;
    const docDate = new Date();

    // Get service name from order
    const serviceName = order.tariff?.name || order.product?.name || 'Консультационные услуги';
    const price = order.final_price;
    const currency = order.currency || 'BYN';

    // Generate HTML document
    const documentHtml = generateDocumentHtml({
      documentNumber: docNumber,
      documentDate: docDate,
      executor,
      client: clientData,
      clientType,
      order,
      serviceName,
      quantity: 1,
      price,
      currency,
      paymentTerm: 3,
      executionTerm: 5,
      unit: 'услуга',
    });

    // Convert HTML to PDF using external service (Gotenberg or similar)
    // For now, we'll store the HTML and use browser rendering
    // In production, you'd use a PDF conversion service
    
    const pdfFileName = `${profile.id}/${new Date().getFullYear()}/${docNumber.replace(/\//g, '-')}.html`;
    
    // Store document in storage
    const { error: uploadError } = await supabaseClient.storage
      .from('documents')
      .upload(pdfFileName, documentHtml, {
        contentType: 'text/html',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error('Failed to upload document');
    }

    // Get signed URL for download (7 days)
    const { data: signedUrlData } = await supabaseClient.storage
      .from('documents')
      .createSignedUrl(pdfFileName, 7 * 24 * 60 * 60);

    const downloadUrl = signedUrlData?.signedUrl || '';

    // Create snapshots
    const clientSnapshot = {
      type: clientType,
      name: clientType === 'individual' 
        ? `${clientData.last_name || ''} ${clientData.first_name || ''}`.trim()
        : (clientData.ent_name || clientData.leg_name || ''),
      email: clientData.email,
      phone: clientData.phone,
      ...clientDetails,
    };

    const executorSnapshot = {
      full_name: executor.full_name,
      short_name: executor.short_name || extractShortName(executor.full_name),
      unp: executor.unp,
      legal_address: executor.legal_address,
      bank_account: executor.bank_account,
      bank_name: executor.bank_name,
      bank_code: executor.bank_code,
      director_position: executor.director_position,
      director_full_name: executor.director_full_name,
      director_short_name: executor.director_short_name,
    };

    const orderSnapshot = {
      order_number: order.order_number,
      product_name: serviceName,
      final_price: price,
      currency,
    };

    // Save document record
    const { data: generatedDoc, error: docError } = await supabaseClient
      .from('generated_documents')
      .insert({
        order_id,
        profile_id: profile.id,
        document_type: 'invoice_act',
        document_number: docNumber,
        document_date: docDate.toISOString().split('T')[0],
        client_details_id: clientDetails?.id,
        executor_id: executor.id,
        client_snapshot: clientSnapshot,
        executor_snapshot: executorSnapshot,
        order_snapshot: orderSnapshot,
        file_path: pdfFileName,
        file_url: downloadUrl,
        status: 'generated',
      })
      .select()
      .single();

    if (docError) {
      console.error('Doc save error:', docError);
      throw new Error('Failed to save document record');
    }

    const results: any = {
      document: generatedDoc,
      download_url: downloadUrl,
      email_sent: false,
      telegram_sent: false,
    };

    // Send email if requested
    if (send_email && clientData.email) {
      try {
        const resendApiKey = Deno.env.get('RESEND_API_KEY');
        if (resendApiKey) {
          const resend = new Resend(resendApiKey);
          const emailAccount = await getEmailAccount(supabaseClient);
          const fromEmail = emailAccount?.from_email || 'documents@gorbova.by';
          const fromName = emailAccount?.from_name || executor.short_name || 'Документы';
          
          const emailHtml = generateEmailTemplate({
            documentNumber: docNumber,
            documentDate: docDate,
            executorName: executor.short_name || extractShortName(executor.full_name),
            clientName: clientSnapshot.name,
            amount: price,
            currency,
            downloadUrl,
          });

          const { data: emailResult, error: emailError } = await resend.emails.send({
            from: `${fromName} <${fromEmail}>`,
            to: [clientData.email],
            subject: `Счёт-акт № ${docNumber} от ${dateToRussianFormat(docDate)}`,
            html: emailHtml,
          });

          if (emailError) {
            console.error('Email error:', emailError);
          } else {
            results.email_sent = true;
            
            // Update document record
            await supabaseClient
              .from('generated_documents')
              .update({ sent_to_email: clientData.email, sent_at: new Date().toISOString() })
              .eq('id', generatedDoc.id);

            // Log email
            await supabaseClient.from('email_logs').insert({
              profile_id: profile.id,
              user_id: order.user_id,
              from_email: fromEmail,
              to_email: clientData.email,
              subject: `Счёт-акт № ${docNumber}`,
              body_html: emailHtml,
              direction: 'outbound',
              status: 'sent',
              provider: 'resend',
              provider_message_id: emailResult?.id,
              template_code: 'invoice_act',
            });
          }
        }
      } catch (emailErr) {
        console.error('Email sending failed:', emailErr);
      }
    }

    // Send Telegram if requested
    if (send_telegram && profile.telegram_user_id) {
      try {
        const botToken = await getTelegramBotToken(supabaseClient);
        if (botToken) {
          const caption = generateTelegramCaption({
            documentNumber: docNumber,
            documentDate: docDate,
            executorName: executor.short_name || extractShortName(executor.full_name),
            amount: price,
            currency,
          });

          // Send document with caption
          const telegramUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
          
          // For now, send as message with link since we have HTML not PDF
          const messageUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
          const messageResponse = await fetch(messageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: profile.telegram_user_id,
              text: `${caption}\n\n📥 [Скачать документ](${downloadUrl})`,
              parse_mode: 'Markdown',
            }),
          });

          const messageResult = await messageResponse.json();
          if (messageResult.ok) {
            results.telegram_sent = true;
          } else {
            console.error('Telegram error:', messageResult);
          }
        }
      } catch (tgErr) {
        console.error('Telegram sending failed:', tgErr);
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
