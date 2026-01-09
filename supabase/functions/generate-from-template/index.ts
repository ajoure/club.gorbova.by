import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Docxtemplater from "npm:docxtemplater@3.47.1";
import PizZip from "npm:pizzip@3.1.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateFromTemplateRequest {
  order_id: string;
  template_id: string;
  send_email?: boolean;
  send_telegram?: boolean;
  executor_id?: string;
  client_details_id?: string;
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

function fullNameToInitials(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

function extractShortName(fullName: string): string {
  if (!fullName) return '';
  const match = fullName.match(/(ЗАО|ООО|ОАО|ИП|УП|ЧТУП|СООО)\s*[«"]([^»"]+)[»"]/i);
  if (match) return `${match[1]} «${match[2]}»`;
  const abbrevMatch = fullName.match(/^(ЗАО|ООО|ОАО|ИП|УП|ЧТУП|СООО)/i);
  if (abbrevMatch) {
    const words = fullName.split(/\s+/).slice(0, 3);
    return words.join(' ');
  }
  return fullName.substring(0, 50);
}

function generateDocumentNumber(prefix: string = 'ДОК'): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${year}${month}${day}-${random}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: GenerateFromTemplateRequest = await req.json();
    const { order_id, template_id, send_email, send_telegram, executor_id, client_details_id } = body;

    if (!order_id || !template_id) {
      return new Response(JSON.stringify({ error: 'order_id and template_id are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch template
    const { data: template, error: templateError } = await supabase
      .from('document_templates')
      .select('*')
      .eq('id', template_id)
      .single();

    if (templateError || !template) {
      console.error('Template fetch error:', templateError);
      return new Response(JSON.stringify({ error: 'Template not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch order with relations
    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .select(`
        *,
        product:products_v2(*),
        tariff:tariffs(*)
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      console.error('Order fetch error:', orderError);
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', order.user_id)
      .single();

    // Fetch executor
    let executor;
    if (executor_id) {
      const { data } = await supabase.from('executors').select('*').eq('id', executor_id).single();
      executor = data;
    }
    if (!executor) {
      const { data } = await supabase.from('executors').select('*').eq('is_default', true).single();
      executor = data;
    }
    if (!executor) {
      return new Response(JSON.stringify({ error: 'No executor found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch client legal details
    let clientDetails = null;
    let clientType = 'individual';
    
    if (client_details_id) {
      const { data } = await supabase.from('client_legal_details').select('*').eq('id', client_details_id).single();
      clientDetails = data;
      clientType = clientDetails?.client_type || 'individual';
    } else if (order.user_id) {
      const { data } = await supabase
        .from('client_legal_details')
        .select('*')
        .eq('profile_id', profile?.id)
        .eq('is_default', true)
        .maybeSingle();
      clientDetails = data;
      clientType = clientDetails?.client_type || 'individual';
    }

    // Download template file
    const { data: templateFile, error: downloadError } = await supabase.storage
      .from('documents-templates')
      .download(template.template_path);

    if (downloadError || !templateFile) {
      console.error('Template download error:', downloadError);
      return new Response(JSON.stringify({ error: 'Failed to download template' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const templateBuffer = new Uint8Array(await templateFile.arrayBuffer());
    const documentDate = new Date();
    const documentNumber = generateDocumentNumber('СА');
    const priceAmount = order.final_price / 100; // Convert from kopecks

    // Build client info from profile if no legal details
    const getClientName = () => {
      if (clientDetails) {
        if (clientType === 'individual') {
          return clientDetails.ind_full_name || profile?.full_name || '';
        } else if (clientType === 'entrepreneur') {
          return clientDetails.ent_name || '';
        } else {
          return clientDetails.leg_name || '';
        }
      }
      return profile?.full_name || '';
    };

    const getClientAddress = () => {
      if (clientDetails) {
        if (clientType === 'individual') {
          const parts = [
            clientDetails.ind_address_index,
            clientDetails.ind_address_region,
            clientDetails.ind_address_district,
            clientDetails.ind_address_city,
            clientDetails.ind_address_street,
            clientDetails.ind_address_house,
            clientDetails.ind_address_apartment && `кв. ${clientDetails.ind_address_apartment}`,
          ].filter(Boolean);
          return parts.join(', ');
        } else if (clientType === 'entrepreneur') {
          return clientDetails.ent_address || '';
        } else {
          return clientDetails.leg_address || '';
        }
      }
      return '';
    };

    // Prepare data for placeholder replacement
    const placeholderData = {
      // Document info
      document_number: documentNumber,
      document_date: dateToRussianFormat(documentDate),
      document_date_short: documentDate.toLocaleDateString('ru-RU'),
      
      // Executor info
      executor_name: executor.full_name,
      executor_short_name: executor.short_name || extractShortName(executor.full_name),
      executor_unp: executor.unp,
      executor_address: executor.legal_address,
      executor_bank: executor.bank_name,
      executor_bank_code: executor.bank_code,
      executor_account: executor.bank_account,
      executor_phone: executor.phone || '',
      executor_email: executor.email || '',
      executor_director: executor.director_full_name || '',
      executor_director_short: executor.director_short_name || fullNameToInitials(executor.director_full_name || ''),
      executor_position: executor.director_position || 'Директор',
      executor_basis: executor.acts_on_basis || 'Устава',
      
      // Client info
      client_name: getClientName(),
      client_address: getClientAddress(),
      client_unp: clientDetails?.ent_unp || clientDetails?.leg_unp || '',
      client_phone: clientDetails?.phone || profile?.phone || '',
      client_email: clientDetails?.email || profile?.email || order.customer_email || '',
      client_passport: clientDetails?.ind_passport_series 
        ? `${clientDetails.ind_passport_series} ${clientDetails.ind_passport_number}, выдан ${clientDetails.ind_passport_issued_by} ${clientDetails.ind_passport_issued_date}`
        : '',
      client_bank: clientDetails?.bank_name || '',
      client_account: clientDetails?.bank_account || '',
      
      // Product info
      product_name: order.product?.name || '',
      tariff_name: order.tariff?.name || '',
      order_number: order.order_number,
      
      // Amounts
      amount: priceAmount.toFixed(2),
      amount_words: `${numberToWordsRu(Math.floor(priceAmount))} рублей ${String(Math.round((priceAmount % 1) * 100)).padStart(2, '0')} копеек`,
      currency: order.currency === 'BYN' ? 'белорусских рублей' : order.currency,
      
      // Service description
      service_description: order.purchase_snapshot?.service_description || order.product?.description || '',
    };

    // Generate document using docxtemplater
    let generatedDoc: Uint8Array;
    try {
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        delimiters: { start: '{{', end: '}}' },
        paragraphLoop: true,
        linebreaks: true,
      });
      doc.render(placeholderData);
      const buf = doc.getZip().generate({ type: 'uint8array' });
      generatedDoc = buf;
    } catch (docError: unknown) {
      console.error('Document generation error:', docError);
      const errMsg = docError instanceof Error ? docError.message : 'Unknown error';
      return new Response(JSON.stringify({ error: `Failed to generate document: ${errMsg}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Save generated document to storage
    const generatedFileName = `generated/${order.user_id}/${documentNumber}.docx`;
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(generatedFileName, generatedDoc, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(JSON.stringify({ error: 'Failed to save document' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create signed URL for download
    const { data: signedUrl } = await supabase.storage
      .from('documents')
      .createSignedUrl(generatedFileName, 86400); // 24 hours

    // Save record to generated_documents
    const { data: savedDocument, error: saveError } = await supabase
      .from('generated_documents')
      .insert({
        order_id: order.id,
        profile_id: profile?.id || order.user_id,
        document_type: template.document_type,
        document_number: documentNumber,
        document_date: documentDate.toISOString().split('T')[0],
        file_path: generatedFileName,
        file_url: signedUrl?.signedUrl,
        executor_id: executor.id,
        executor_snapshot: executor,
        client_details_id: clientDetails?.id,
        client_snapshot: clientDetails || { profile },
        order_snapshot: order,
        status: 'generated',
      })
      .select()
      .single();

    if (saveError) {
      console.error('Save document record error:', saveError);
    }

    // Send email if requested
    let emailSent = false;
    if (send_email) {
      const resendApiKey = Deno.env.get('RESEND_API_KEY');
      const recipientEmail = clientDetails?.email || profile?.email || order.customer_email;
      
      if (resendApiKey && recipientEmail && signedUrl?.signedUrl) {
        try {
          const { Resend } = await import("npm:resend@2.0.0");
          const resend = new Resend(resendApiKey);
          
          const { data: emailAccount } = await supabase
            .from('email_accounts')
            .select('*')
            .eq('is_default', true)
            .eq('is_active', true)
            .maybeSingle();

          await resend.emails.send({
            from: emailAccount?.from_email || 'noreply@ajoure.by',
            to: [recipientEmail],
            subject: `Документ ${documentNumber} по заказу ${order.order_number}`,
            html: `
              <h2>Документ по вашему заказу</h2>
              <p>Документ "${template.name}" по заказу №${order.order_number} готов.</p>
              <p><a href="${signedUrl.signedUrl}">Скачать документ</a></p>
              <p>Ссылка действительна 24 часа.</p>
            `,
          });
          
          emailSent = true;

          // Update document status
          if (savedDocument) {
            await supabase
              .from('generated_documents')
              .update({ 
                sent_at: new Date().toISOString(),
                sent_to_email: recipientEmail,
              })
              .eq('id', savedDocument.id);
          }
        } catch (emailError) {
          console.error('Email send error:', emailError);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      document_id: savedDocument?.id,
      document_number: documentNumber,
      download_url: signedUrl?.signedUrl,
      email_sent: emailSent,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Generate from template error:', error);
    const errMsg = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
