import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvoiceRequest {
  orderId: string;
  email: string;
  tariffName: string;
  price: number;
  payerType: "entrepreneur" | "legal_entity";
  companyName?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, email, tariffName, price, payerType, companyName }: InvoiceRequest = await req.json();

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate invoice number
    const invoiceNumber = `INV-${new Date().getFullYear()}-${orderId.slice(0, 8).toUpperCase()}`;
    const invoiceDate = new Date().toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const payerTypeLabel = payerType === "entrepreneur" ? "ИП" : "Юридическое лицо";

    // Generate HTML invoice email
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #8B5CF6; padding-bottom: 20px; margin-bottom: 20px; }
    .header h1 { color: #8B5CF6; margin: 0; }
    .invoice-info { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .invoice-info p { margin: 5px 0; }
    .details { margin-bottom: 20px; }
    .details h3 { color: #8B5CF6; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .total { font-size: 1.2em; font-weight: bold; color: #8B5CF6; }
    .bank-details { background: #f0f0ff; padding: 15px; border-radius: 8px; margin-top: 20px; }
    .bank-details h4 { color: #8B5CF6; margin-top: 0; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Счёт на оплату</h1>
      <p>№ ${invoiceNumber} от ${invoiceDate}</p>
    </div>

    <div class="invoice-info">
      <p><strong>Плательщик:</strong> ${payerTypeLabel}${companyName ? ` — ${companyName}` : ""}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Срок оплаты:</strong> до ${dueDate}</p>
    </div>

    <div class="details">
      <h3>Детали заказа</h3>
      <table>
        <thead>
          <tr>
            <th>Услуга</th>
            <th>Количество</th>
            <th>Стоимость</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${tariffName}</td>
            <td>1</td>
            <td>${price} BYN</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" class="total">Итого к оплате:</td>
            <td class="total">${price} BYN</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="bank-details">
      <h4>Реквизиты для оплаты</h4>
      <p><strong>Получатель:</strong> ЗАО «АЖУР инкам»</p>
      <p><strong>УНП:</strong> 192589210</p>
      <p><strong>Банк:</strong> ЗАО «Альфа-Банк»</p>
      <p><strong>БИК:</strong> ALFABY2X</p>
      <p><strong>Р/с:</strong> BY47ALFA30122C35190010270000</p>
      <p><strong>Назначение платежа:</strong> Оплата по счёту № ${invoiceNumber} от ${invoiceDate}. Консультационные услуги. НДС не облагается.</p>
    </div>

    <div class="footer">
      <p>После оплаты с вами свяжется менеджер для назначения времени консультации.</p>
      <p>По вопросам оплаты: info@gorbova.by</p>
    </div>
  </div>
</body>
</html>
    `;

    // Send email
    const emailResponse = await resend.emails.send({
      from: "БУКВА ЗАКОНА <noreply@gorbova.by>",
      to: [email],
      subject: `Счёт на оплату № ${invoiceNumber} — ${tariffName}`,
      html: emailHtml,
    });

    console.log("Invoice email sent:", emailResponse);

    // Log to audit
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: 'system',
      actor_label: 'send-invoice',
      action: "invoice_sent",
      meta: {
        order_id: orderId,
        invoice_number: invoiceNumber,
        email,
        price,
        tariff_name: tariffName,
        payer_type: payerType,
      },
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        invoiceNumber,
        emailId: (emailResponse as any).id || null 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-invoice function:", error);
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
