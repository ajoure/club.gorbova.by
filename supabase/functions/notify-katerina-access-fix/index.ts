// One-shot notification for Katerina (katx@tut.by) about access date fix.
// Safe to call once; idempotent — checks audit_logs for prior send.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TARGET_USER_ID = 'b48a7646-7388-40f2-9113-36654e5a7fdc';
const TARGET_TELEGRAM_ID = 1041906935;
const TARGET_EMAIL = 'katx@tut.by';
const SUBSCRIPTION_ID = '64067f5d-ca00-4fed-b063-7b0100e203bb';

const TG_MESSAGE = `Здравствуйте, Екатерина! 👋

Мы исправили техническую ошибку в системе автопродления, из-за которой дата окончания вашего доступа к Gorbova Club отображалась неверно.

✅ <b>Правильная дата окончания доступа:</b> 2 июня 2026, 15:00 (Минск)
✅ <b>Следующее автосписание:</b> 2 июня 2026

Сумма списания (250 BYN) и тариф <b>BUSINESS</b> остаются без изменений.

Приносим извинения за возможное недоразумение. Если у вас есть вопросы — напишите нам.`;

const EMAIL_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h2 style="color: #2563eb;">Уточнение даты доступа в Gorbova Club</h2>
  <p>Здравствуйте, Екатерина!</p>
  <p>Мы исправили техническую ошибку в системе автопродления, из-за которой дата окончания вашего доступа к Gorbova Club отображалась неверно.</p>
  <div style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 16px; margin: 16px 0;">
    <p style="margin: 0;"><strong>✅ Правильная дата окончания доступа:</strong><br>2 июня 2026, 15:00 (Минск)</p>
    <p style="margin: 8px 0 0;"><strong>✅ Следующее автосписание:</strong><br>2 июня 2026</p>
  </div>
  <p>Сумма списания <strong>250 BYN</strong> и тариф <strong>BUSINESS</strong> остаются без изменений.</p>
  <p>Приносим извинения за возможное недоразумение. Если у вас есть вопросы — напишите нам.</p>
  <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">С уважением,<br>Команда Gorbova Club</p>
</body></html>`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const result: Record<string, unknown> = { telegram: null, email: null };

  // Idempotency: check if already sent
  const { data: prior } = await supabase
    .from('audit_logs')
    .select('id')
    .eq('action', 'admin_notification.access_fix_katerina_2026_05')
    .limit(1);

  if (prior && prior.length > 0) {
    return new Response(JSON.stringify({ skipped: 'already_sent', prior_id: prior[0].id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 1. Telegram DM
  try {
    const botToken = Deno.env.get('PRIMARY_TELEGRAM_BOT_TOKEN');
    if (!botToken) throw new Error('PRIMARY_TELEGRAM_BOT_TOKEN missing');
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TARGET_TELEGRAM_ID,
        text: TG_MESSAGE,
        parse_mode: 'HTML',
      }),
    });
    const tgResp = await r.json();
    result.telegram = { ok: tgResp.ok, status: r.status, message_id: tgResp?.result?.message_id, error: tgResp?.description };
  } catch (e) {
    result.telegram = { ok: false, error: String(e) };
  }

  // 2. Email via send-email edge function (internal call)
  try {
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        to: TARGET_EMAIL,
        subject: 'Уточнение даты доступа в Gorbova Club',
        html: EMAIL_HTML,
      }),
    });
    const emailResp = await r.json().catch(() => ({}));
    result.email = { ok: r.ok, status: r.status, response: emailResp };
  } catch (e) {
    result.email = { ok: false, error: String(e) };
  }

  // Audit
  await supabase.from('audit_logs').insert({
    action: 'admin_notification.access_fix_katerina_2026_05',
    actor_type: 'system',
    actor_label: 'notify-katerina-access-fix',
    target_user_id: TARGET_USER_ID,
    meta: {
      subscription_id: SUBSCRIPTION_ID,
      result,
      sent_at: new Date().toISOString(),
    },
  });

  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
