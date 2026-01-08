import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateRequest {
  order_id: string;
  document_type: "invoice" | "act";
  client_details_id?: string;
  executor_id?: string;
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

    const { order_id, document_type, client_details_id, executor_id }: GenerateRequest = await req.json();

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
        payer_type, purchase_snapshot,
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
      .select("id")
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
      return new Response(JSON.stringify({ error: "No executor found" }), {
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
      name: order.customer_email || "Физическое лицо",
      email: order.customer_email,
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

    // Generate document content (HTML for now, can be converted to PDF)
    const documentHtml = generateDocumentHtml(document_type, {
      documentNumber,
      documentDate: new Date().toLocaleDateString("ru-RU"),
      executor: executorSnapshot,
      client: clientSnapshot,
      order: orderSnapshot,
    });

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
  </style>
</head>
<body>
  <div class="header">
    <div class="title">СЧЁТ № ${documentNumber}</div>
    <div>от ${documentDate}</div>
  </div>
  
  <p><strong>Исполнитель:</strong> ${executor.legal_form} "${executorName}", УНП ${executor.unp}</p>
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
    <p>${executor.director_position || "Директор"} _________________ ${executor.director_short_name || ""}</p>
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
  </style>
</head>
<body>
  <div class="header">
    <div class="title">АКТ ВЫПОЛНЕННЫХ РАБОТ (ОКАЗАННЫХ УСЛУГ)</div>
    <div>№ ${documentNumber} от ${documentDate}</div>
  </div>
  
  <p><strong>Исполнитель:</strong> ${executor.legal_form} "${executorName}", УНП ${executor.unp}, ${executor.legal_address}</p>
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
      <p style="margin-top: 30px;">${executor.director_position || "Директор"}</p>
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
