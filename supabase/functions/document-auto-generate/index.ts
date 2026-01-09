import { createClient } from 'npm:@supabase/supabase-js@2';
import Docxtemplater from "npm:docxtemplater@3.47.1";
import PizZip from "npm:pizzip@3.1.6";
import { Resend } from 'npm:resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TriggerType = 'payment_success' | 'trial_started' | 'installment_payment' | 'installment_first' | 'installment_last' | 'manual';

interface AutoGenerateRequest {
  trigger: TriggerType;
  order_id: string;
  payment_id?: string;
  installment_payment_id?: string;
  // For manual override
  template_id?: string;
  executor_id?: string;
  client_details_id?: string;
  field_overrides?: Record<string, unknown>;
}

// Helper functions
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body: AutoGenerateRequest = await req.json();
    const { trigger, order_id, payment_id, installment_payment_id, template_id, executor_id, client_details_id, field_overrides } = body;

    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[document-auto-generate] trigger=${trigger}, order_id=${order_id}`);

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

    // Find matching rules or use template_id if manual
    let rulesToApply: any[] = [];
    
    if (template_id) {
      // Manual generation with specific template
      rulesToApply = [{ template_id, field_overrides: field_overrides || {}, auto_send_email: false, auto_send_telegram: false }];
    } else {
      // Find matching rules by trigger, product, tariff
      const { data: rules } = await supabase
        .from('document_generation_rules')
        .select('*, template:document_templates(*)')
        .eq('trigger_type', trigger)
        .eq('is_active', true)
        .order('priority', { ascending: false });

      if (rules && rules.length > 0) {
        // Filter rules by product/tariff match
        rulesToApply = rules.filter(rule => {
          // If rule has product_id, must match
          if (rule.product_id && rule.product_id !== order.product_id) return false;
          // If rule has tariff_id, must match
          if (rule.tariff_id && rule.tariff_id !== order.tariff_id) return false;
          // If rule has offer_id, check if order came from that offer
          if (rule.offer_id && order.meta?.offer_id !== rule.offer_id) return false;
          // Check amount range
          if (rule.min_amount && order.final_price < rule.min_amount) return false;
          if (rule.max_amount && order.final_price > rule.max_amount) return false;
          return true;
        });
      }
    }

    if (rulesToApply.length === 0) {
      console.log(`No matching rules for trigger=${trigger}, order_id=${order_id}`);
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No matching rules', 
        documents_generated: 0 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Fetch installment payment info if applicable
    let installmentPayment: any = null;
    if (installment_payment_id) {
      const { data } = await supabase
        .from('installment_payments')
        .select('*')
        .eq('id', installment_payment_id)
        .single();
      installmentPayment = data;
    }

    // Determine payer type and validate
    // Rule: If online card payment → use individual data even if client has legal details
    let clientDetails: any = null;
    let payerType = 'individual';
    let payerTypeMismatch = false;
    let mismatchWarning: string | null = null;

    // Check if this was an online card payment
    const isOnlineCardPayment = order.meta?.payment_method === 'card' || 
      (payment_id && await checkIfCardPayment(supabase, payment_id));

    if (client_details_id) {
      const { data } = await supabase.from('client_legal_details').select('*').eq('id', client_details_id).single();
      clientDetails = data;
    } else if (profile?.id) {
      const { data } = await supabase
        .from('client_legal_details')
        .select('*')
        .eq('profile_id', profile.id)
        .eq('is_default', true)
        .maybeSingle();
      clientDetails = data;
    }

    if (isOnlineCardPayment && clientDetails && clientDetails.client_type !== 'individual') {
      // Payment was made by card (physical person) but client has legal entity details
      payerTypeMismatch = true;
      mismatchWarning = 'Оплата произведена физическим лицом. Документ оформлен на данные владельца аккаунта.';
      // Force individual type
      payerType = 'individual';
      // Create snapshot from profile instead
      clientDetails = null;
    } else if (clientDetails) {
      payerType = clientDetails.client_type || 'individual';
    }

    // Check payer type filter in rules
    rulesToApply = rulesToApply.filter(rule => {
      if (rule.payer_type_filter && rule.payer_type_filter.length > 0) {
        return rule.payer_type_filter.includes(payerType);
      }
      return true;
    });

    const generatedDocuments: any[] = [];
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const resend = resendApiKey ? new Resend(resendApiKey) : null;

    for (const rule of rulesToApply) {
      try {
        const result = await generateDocument({
          supabase,
          resend,
          order,
          profile,
          executor,
          clientDetails,
          payerType,
          payerTypeMismatch,
          mismatchWarning,
          rule,
          trigger,
          installmentPayment,
        });
        generatedDocuments.push(result);
      } catch (genError) {
        console.error(`Error generating document for rule ${rule.id}:`, genError);
        generatedDocuments.push({ 
          rule_id: rule.id, 
          error: genError instanceof Error ? genError.message : 'Unknown error' 
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      documents_generated: generatedDocuments.filter(d => !d.error).length,
      documents: generatedDocuments,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Auto-generate error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function checkIfCardPayment(supabase: any, paymentId: string): Promise<boolean> {
  const { data } = await supabase
    .from('payments_v2')
    .select('provider, meta')
    .eq('id', paymentId)
    .single();
  
  return data?.provider === 'bepaid' || data?.meta?.payment_type === 'card';
}

interface GenerateDocumentParams {
  supabase: any;
  resend: any;
  order: any;
  profile: any;
  executor: any;
  clientDetails: any;
  payerType: string;
  payerTypeMismatch: boolean;
  mismatchWarning: string | null;
  rule: any;
  trigger: TriggerType;
  installmentPayment?: any;
}

async function generateDocument(params: GenerateDocumentParams): Promise<any> {
  const { 
    supabase, resend, order, profile, executor, clientDetails, 
    payerType, payerTypeMismatch, mismatchWarning, rule, trigger, installmentPayment 
  } = params;

  // Fetch template if not already loaded
  let template = rule.template;
  if (!template) {
    const { data } = await supabase
      .from('document_templates')
      .select('*')
      .eq('id', rule.template_id)
      .single();
    template = data;
  }

  if (!template) {
    throw new Error('Template not found');
  }

  // Download template file
  const { data: templateFile, error: downloadError } = await supabase.storage
    .from('documents-templates')
    .download(template.template_path);

  if (downloadError || !templateFile) {
    throw new Error('Failed to download template');
  }

  const templateBuffer = new Uint8Array(await templateFile.arrayBuffer());
  const documentDate = new Date();

  // Get next document number
  const { data: docNumber } = await supabase.rpc('get_next_document_number', {
    p_document_type: template.document_type,
    p_prefix: template.document_type === 'invoice_act' ? 'СА' : 
              template.document_type === 'act' ? 'АКТ' : 'ДОК'
  });
  const documentNumber = docNumber || `DOC-${Date.now()}`;

  // Calculate amounts
  const paidAmount = installmentPayment?.amount || order.paid_amount || order.final_price;
  const contractTotalAmount = order.final_price;
  
  // Calculate service period
  const servicePeriodDays = order.tariff?.document_params?.service_period_days || 
                            order.tariff?.access_period_days || 30;
  const servicePeriodFrom = documentDate;
  const servicePeriodTo = new Date(documentDate);
  servicePeriodTo.setDate(servicePeriodTo.getDate() + servicePeriodDays);

  // Build client info
  const getClientName = () => {
    if (clientDetails) {
      if (payerType === 'individual') {
        return clientDetails.ind_full_name || profile?.full_name || '';
      } else if (payerType === 'entrepreneur') {
        return clientDetails.ent_name || '';
      } else {
        return clientDetails.leg_name || '';
      }
    }
    return profile?.full_name || '';
  };

  const getClientAddress = () => {
    if (clientDetails) {
      if (payerType === 'individual') {
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
      } else if (payerType === 'entrepreneur') {
        return clientDetails.ent_address || '';
      } else {
        return clientDetails.leg_address || '';
      }
    }
    return '';
  };

  // Prepare placeholder data
  const tariffParams = order.tariff?.document_params || {};
  const fieldOverrides = rule.field_overrides || {};

  const placeholderData: Record<string, any> = {
    // Document info
    document_number: documentNumber,
    document_date: dateToRussianFormat(documentDate),
    document_date_short: documentDate.toLocaleDateString('ru-RU'),
    
    // Contract info
    contract_number: order.meta?.contract_number || order.order_number,
    contract_date: order.meta?.contract_date || dateToRussianFormat(new Date(order.created_at)),
    
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
    
    // Service info from tariff params
    service_title: tariffParams.service_title || order.tariff?.name || order.product?.name || '',
    unit: tariffParams.unit || 'услуга',
    unit_price: paidAmount.toFixed(2),
    quantity: tariffParams.quantity || 1,
    
    // Amounts
    amount: paidAmount.toFixed(2),
    paid_amount: paidAmount.toFixed(2),
    contract_total_amount: contractTotalAmount.toFixed(2),
    amount_words: `${numberToWordsRu(Math.floor(paidAmount))} рублей ${String(Math.round((paidAmount % 1) * 100)).padStart(2, '0')} копеек`,
    total_amount_words: `${numberToWordsRu(Math.floor(contractTotalAmount))} рублей ${String(Math.round((contractTotalAmount % 1) * 100)).padStart(2, '0')} копеек`,
    currency: order.currency === 'BYN' ? 'белорусских рублей' : order.currency,
    currency_short: order.currency,
    
    // Service period
    service_period_from: dateToRussianFormat(servicePeriodFrom),
    service_period_to: dateToRussianFormat(servicePeriodTo),
    service_period_days: servicePeriodDays,
    
    // Installment info
    payment_number: installmentPayment?.payment_number || 1,
    total_payments: installmentPayment?.total_payments || 1,
    
    // Service description
    service_description: order.purchase_snapshot?.service_description || order.product?.description || '',
    
    // Apply field overrides
    ...fieldOverrides,
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
    throw new Error(`Failed to generate document: ${docError instanceof Error ? docError.message : 'Unknown error'}`);
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
    throw new Error('Failed to save document');
  }

  // Create signed URL for download
  const { data: signedUrl } = await supabase.storage
    .from('documents')
    .createSignedUrl(generatedFileName, 86400 * 7); // 7 days

  // Save record to generated_documents
  const { data: savedDocument, error: saveError } = await supabase
    .from('generated_documents')
    .insert({
      order_id: order.id,
      profile_id: profile?.id || order.user_id,
      template_id: template.id,
      rule_id: rule.id || null,
      trigger_type: trigger,
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
      payer_type: payerType,
      payer_type_mismatch: payerTypeMismatch,
      mismatch_warning: mismatchWarning,
      installment_payment_id: installmentPayment?.id,
      contract_number: placeholderData.contract_number,
      contract_date: order.created_at.split('T')[0],
      contract_total_amount: contractTotalAmount,
      paid_amount: paidAmount,
      currency: order.currency,
      service_period_from: servicePeriodFrom.toISOString().split('T')[0],
      service_period_to: servicePeriodTo.toISOString().split('T')[0],
      generation_log: {
        trigger,
        rule_id: rule.id,
        placeholders_used: Object.keys(placeholderData),
        generated_at: new Date().toISOString(),
      },
      status: 'generated',
    })
    .select()
    .single();

  if (saveError) {
    console.error('Save document record error:', saveError);
  }

  // Send email if requested
  let emailSent = false;
  if (rule.auto_send_email && resend) {
    const recipientEmail = clientDetails?.email || profile?.email || order.customer_email;
    
    if (recipientEmail && signedUrl?.signedUrl) {
      try {
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
            <p>Ссылка действительна 7 дней.</p>
            ${mismatchWarning ? `<p style="color: orange;">⚠️ ${mismatchWarning}</p>` : ''}
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
              status: 'sent',
            })
            .eq('id', savedDocument.id);
        }
      } catch (emailError) {
        console.error('Email send error:', emailError);
      }
    }
  }

  // Send to Telegram if requested
  let telegramSent = false;
  if (rule.auto_send_telegram && profile?.telegram_user_id) {
    try {
      await supabase.functions.invoke('telegram-send-notification', {
        body: {
          user_id: order.user_id,
          notification_type: 'document_generated',
          payload: {
            document_number: documentNumber,
            document_name: template.name,
            download_url: signedUrl?.signedUrl,
          },
        },
      });
      telegramSent = true;

      if (savedDocument) {
        await supabase
          .from('generated_documents')
          .update({ 
            sent_to_telegram: profile.telegram_user_id.toString(),
          })
          .eq('id', savedDocument.id);
      }
    } catch (tgError) {
      console.error('Telegram send error:', tgError);
    }
  }

  return {
    document_id: savedDocument?.id,
    document_number: documentNumber,
    download_url: signedUrl?.signedUrl,
    email_sent: emailSent,
    telegram_sent: telegramSent,
    payer_type: payerType,
    payer_type_mismatch: payerTypeMismatch,
    warning: mismatchWarning,
  };
}
