import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DiscrepancyItem {
  id: string;
  bepaid_uid?: string;
  amount?: number;
  currency?: string;
  customer_email?: string;
  description?: string;
  discrepancy_type: string;
  our_amount?: number;
  our_status?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { 
      discrepancies, 
      threshold = 100,
      source = "reconciliation",
    } = body as {
      discrepancies: DiscrepancyItem[];
      threshold?: number;
      source?: string;
    };

    if (!discrepancies || discrepancies.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No discrepancies to report" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate total discrepancy amount
    const totalAmount = discrepancies.reduce((sum, item) => {
      const diff = Math.abs((item.amount || 0) - (item.our_amount || 0));
      return sum + diff;
    }, 0);

    // Only send alert if above threshold
    if (totalAmount < threshold) {
      console.log(`[bepaid-discrepancy-alert] Total ${totalAmount} BYN below threshold ${threshold} BYN, skipping`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Below threshold",
          totalAmount,
          threshold,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bepaid-discrepancy-alert] Sending alert for ${discrepancies.length} discrepancies, total: ${totalAmount} BYN`);

    // Get admin role ID
    const { data: adminRole } = await supabase
      .from("roles")
      .select("id")
      .eq("code", "admin")
      .single();

    if (!adminRole) {
      throw new Error("Admin role not found");
    }

    // Get admins with their profiles
    const { data: admins } = await supabase
      .from("user_roles_v2")
      .select(`
        user_id,
        profiles!inner(
          id,
          email,
          full_name,
          telegram_user_id
        )
      `)
      .eq("role_id", adminRole.id);

    if (!admins || admins.length === 0) {
      console.log("[bepaid-discrepancy-alert] No admins found to notify");
      return new Response(
        JSON.stringify({ success: true, message: "No admins to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format discrepancy details
    const discrepancyDetails = discrepancies.slice(0, 10).map(d => {
      let detail = `• ${d.bepaid_uid || d.id}: ${d.amount || 0} ${d.currency || "BYN"}`;
      if (d.discrepancy_type === "amount_mismatch") {
        detail += ` (наша сумма: ${d.our_amount})`;
      } else if (d.discrepancy_type === "status_mismatch") {
        detail += ` (наш статус: ${d.our_status})`;
      } else if (d.discrepancy_type === "not_found") {
        detail += " (не найден в системе)";
      }
      return detail;
    }).join("\n");

    const siteUrl = Deno.env.get("SITE_URL") || "https://lovable.dev";
    
    // Email content
    const emailSubject = `🔴 bePaid: расхождения на ${totalAmount.toFixed(2)} BYN`;
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .alert { background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .stats { display: flex; gap: 20px; margin: 16px 0; }
    .stat { background: #f3f4f6; padding: 12px 16px; border-radius: 6px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1f2937; }
    .stat-label { font-size: 12px; color: #6b7280; }
    .details { background: #f9fafb; border-radius: 6px; padding: 16px; font-family: monospace; font-size: 13px; }
    .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 16px; }
  </style>
</head>
<body>
  <h2>⚠️ Обнаружены расхождения в платежах bePaid</h2>
  
  <div class="alert">
    <strong>Требуется проверка!</strong><br>
    Обнаружены расхождения между данными bePaid и нашей системой.
  </div>
  
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${discrepancies.length}</div>
      <div class="stat-label">Расхождений</div>
    </div>
    <div class="stat">
      <div class="stat-value">${totalAmount.toFixed(2)} BYN</div>
      <div class="stat-label">Общая сумма</div>
    </div>
  </div>
  
  <h3>Детали (первые 10):</h3>
  <div class="details">
    <pre>${discrepancyDetails}</pre>
  </div>
  
  <a href="${siteUrl}/admin/payments" class="button">Открыть платежи</a>
  
  <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">
    Источник: ${source}<br>
    Время: ${new Date().toLocaleString("ru-RU")}
  </p>
</body>
</html>
    `;

    // Telegram message
    const telegramMessage = `
🔴 *bePaid: расхождения на ${totalAmount.toFixed(2)} BYN*

Обнаружено ${discrepancies.length} расхождений между bePaid и нашей системой.

📋 *Детали:*
${discrepancyDetails}

${discrepancies.length > 10 ? `\n...и ещё ${discrepancies.length - 10} записей\n` : ""}
🔗 [Открыть платежи](${siteUrl}/admin/payments)
    `.trim();

    let emailsSent = 0;
    let telegramsSent = 0;

    // Send notifications to each admin
    for (const admin of admins) {
      const profile = admin.profiles as { 
        email?: string; 
        full_name?: string; 
        telegram_user_id?: string;
      };

      // Send email
      if (profile?.email) {
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              to: profile.email,
              subject: emailSubject,
              html: emailHtml,
            },
          });
          emailsSent++;
          console.log(`[bepaid-discrepancy-alert] Email sent to ${profile.email}`);
        } catch (err) {
          console.error(`[bepaid-discrepancy-alert] Failed to send email to ${profile.email}:`, err);
        }
      }

      // Send Telegram
      if (profile?.telegram_user_id) {
        try {
          await supabase.functions.invoke("telegram-send-notification", {
            body: {
              telegramUserId: profile.telegram_user_id,
              message: telegramMessage,
              parseMode: "Markdown",
            },
          });
          telegramsSent++;
          console.log(`[bepaid-discrepancy-alert] Telegram sent to ${profile.telegram_user_id}`);
        } catch (err) {
          console.error(`[bepaid-discrepancy-alert] Failed to send Telegram to ${profile.telegram_user_id}:`, err);
        }
      }
    }

    // Log the alert
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: 'system',
      actor_label: 'bepaid-discrepancy-alert',
      action: "bepaid_discrepancy_alert",
      meta: {
        discrepancy_count: discrepancies.length,
        total_amount: totalAmount,
        threshold,
        source,
        emails_sent: emailsSent,
        telegrams_sent: telegramsSent,
      },
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        discrepancyCount: discrepancies.length,
        totalAmount,
        emailsSent,
        telegramsSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[bepaid-discrepancy-alert] Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
