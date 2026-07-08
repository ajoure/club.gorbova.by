// notify-order-purchased
// Canonical post-payment notification for paid orders_v2 rows.
// Invoked (non-blocking) from grant-access-for-order at the end of the write path.
// Idempotent by (order_id, channel, notification_type) via public.order_notification_deliveries.
//
// Contract:
//   POST { order_id: uuid, force?: boolean, force_purchase_dm?: boolean }
// Behaviour:
//   - Reads orders_v2, refuses when status != 'paid' (returns { skipped: 'not_paid' }).
//   - Resolves recipient email + telegram_user_id (priority documented in POST_PAYMENT_NOTIFICATIONS.md).
//   - For each channel: inserts pending delivery row (unique guard = idempotency), sends, marks sent/failed/skipped.
//   - Never throws to caller — caller (grant-access-for-order) treats this as best-effort.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const NOTIFICATION_TYPE = 'product_purchased'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function tgSendMessage(botToken: string, chatId: number | string, text: string, html = false) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: html ? 'HTML' : undefined,
      disable_web_page_preview: true,
    }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data?.ok !== false, data }
}

function fmtRuDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, svcKey)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const orderId: string | undefined = body?.order_id
  const force: boolean = !!body?.force
  const forcePurchaseDm: boolean = !!body?.force_purchase_dm
  if (!orderId) return json({ error: 'order_id_required' }, 400)

  // 1. Load order
  const { data: order, error: orderErr } = await supabase
    .from('orders_v2')
    .select('id, order_number, user_id, product_id, tariff_id, customer_email, status, meta, currency, final_price')
    .eq('id', orderId)
    .maybeSingle()

  if (orderErr) return json({ error: 'order_lookup_failed', details: orderErr.message }, 500)
  if (!order) return json({ error: 'order_not_found' }, 404)

  if (order.status !== 'paid') {
    return json({ skipped: 'not_paid', status: order.status })
  }

  // 2. Load product + tariff + access window
  const [{ data: product }, { data: tariff }] = await Promise.all([
    order.product_id
      ? supabase.from('products_v2').select('id, name').eq('id', order.product_id).maybeSingle()
      : Promise.resolve({ data: null }),
    order.tariff_id
      ? supabase.from('tariffs').select('id, name').eq('id', order.tariff_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const productName = (product as any)?.name || 'Продукт'
  const tariffName = (tariff as any)?.name || null

  // Best-effort: resolve access_end_at from the most recent active subscription for this user+product
  let accessEndAt: string | null = null
  if (order.user_id && order.product_id) {
    const { data: sub } = await supabase
      .from('subscriptions_v2')
      .select('access_end_at')
      .eq('user_id', order.user_id)
      .eq('product_id', order.product_id)
      .in('status', ['active', 'past_due'])
      .order('access_end_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    accessEndAt = (sub as any)?.access_end_at || null
  }

  // 3. Recipient resolution
  let recipientEmail: string | null = order.customer_email || null
  let telegramUserId: number | null = null
  let recipientName: string | null = null
  if (order.user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name, first_name, telegram_user_id')
      .eq('id', order.user_id)
      .maybeSingle()
    if (profile) {
      recipientEmail = recipientEmail || (profile as any).email || null
      recipientName = (profile as any).first_name || (profile as any).full_name || null
      const tuid = (profile as any).telegram_user_id
      if (tuid) telegramUserId = typeof tuid === 'string' ? Number(tuid) : tuid
    }
  }

  // 4. Load per-product overrides (email + telegram)
  const overrides: Record<string, any> = {}
  if (order.product_id) {
    const { data: rows } = await supabase
      .from('product_notification_templates')
      .select('channel, subject_override, intro_html, intro_text, is_enabled')
      .eq('product_id', order.product_id)
      .eq('notification_type', NOTIFICATION_TYPE)
    for (const row of rows || []) {
      overrides[(row as any).channel] = row
    }
  }

  // Detect whether a club-DM was already sent for this order (dedupe purchase-DM by default)
  let clubDmSent = false
  if (order.user_id && !forcePurchaseDm) {
    const { data: existingDm } = await supabase
      .from('telegram_messages')
      .select('id')
      .eq('meta->>event', 'access_granted_dm')
      .eq('meta->>source_order_id', orderId)
      .limit(1)
      .maybeSingle()
    if (existingDm) clubDmSent = true
  }

  const results: Record<string, any> = { order_id: orderId }

  // 5. Ensure delivery rows (idempotent). Use unique guard on (order_id, channel, notification_type).
  async function upsertDelivery(channel: 'email' | 'telegram', recipient: string | null) {
    // Try insert first (pending); if conflict, read existing.
    const { data: inserted, error: insErr } = await supabase
      .from('order_notification_deliveries')
      .insert({
        order_id: orderId,
        channel,
        notification_type: NOTIFICATION_TYPE,
        status: 'pending',
        recipient,
      })
      .select()
      .maybeSingle()

    if (inserted) return { row: inserted as any, existed: false }

    // Conflict — fetch existing
    const { data: existing } = await supabase
      .from('order_notification_deliveries')
      .select('*')
      .eq('order_id', orderId)
      .eq('channel', channel)
      .eq('notification_type', NOTIFICATION_TYPE)
      .maybeSingle()

    if (insErr && !existing) {
      console.error('[notify-order-purchased] delivery insert failed', insErr)
    }
    return { row: existing as any, existed: true }
  }

  async function markDelivery(rowId: string, patch: Record<string, unknown>) {
    await supabase
      .from('order_notification_deliveries')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', rowId)
  }

  // ---- EMAIL ----
  const emailEnabled = (overrides.email?.is_enabled ?? true) === true
  if (!emailEnabled) {
    results.email = { skipped: 'disabled_by_product_template' }
  } else if (!recipientEmail) {
    results.email = { skipped: 'no_recipient_email' }
  } else {
    const { row } = await upsertDelivery('email', recipientEmail)
    if (!row) {
      results.email = { error: 'delivery_row_missing' }
    } else if (row.status === 'sent' && !force) {
      results.email = { skipped: 'already_sent', delivery_id: row.id }
    } else {
      try {
        const templateData: Record<string, unknown> = {
          recipientName,
          productName,
          tariffName,
          accessEndAt,
          orderNumber: order.order_number,
          introHtml: overrides.email?.intro_html || null,
        }
        const { data: sendRes, error: sendErr } = await supabase.functions.invoke(
          'send-transactional-email',
          {
            body: {
              templateName: 'product-purchased',
              recipientEmail,
              idempotencyKey: `product-purchased:${orderId}`,
              templateData,
            },
          },
        )
        if (sendErr) throw sendErr
        if ((sendRes as any)?.reason === 'email_suppressed') {
          await markDelivery(row.id, { status: 'skipped', error: 'email_suppressed' })
          results.email = { skipped: 'email_suppressed', delivery_id: row.id }
        } else {
          await markDelivery(row.id, { status: 'sent', sent_at: new Date().toISOString() })
          results.email = { sent: true, delivery_id: row.id }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await markDelivery(row.id, { status: 'failed', error: msg })
        results.email = { error: msg, delivery_id: row.id }
      }
    }
  }

  // ---- TELEGRAM ----
  const tgEnabled = (overrides.telegram?.is_enabled ?? true) === true
  if (!tgEnabled) {
    results.telegram = { skipped: 'disabled_by_product_template' }
  } else if (!telegramUserId) {
    results.telegram = { skipped: 'no_telegram_user_id' }
  } else if (clubDmSent) {
    // Access DM (from telegram-grant-access) already delivered — skip duplicate purchase-DM.
    // Still record a 'skipped' row for auditability.
    const { row } = await upsertDelivery('telegram', String(telegramUserId))
    if (row && row.status !== 'sent') {
      await markDelivery(row.id, { status: 'skipped', error: 'club_dm_already_sent' })
    }
    results.telegram = { skipped: 'club_dm_already_sent' }
  } else {
    const { row } = await upsertDelivery('telegram', String(telegramUserId))
    if (!row) {
      results.telegram = { error: 'delivery_row_missing' }
    } else if (row.status === 'sent' && !force) {
      results.telegram = { skipped: 'already_sent', delivery_id: row.id }
    } else {
      try {
        // Load primary bot
        const { data: bot } = await supabase
          .from('telegram_bots')
          .select('bot_token_encrypted')
          .eq('status', 'active')
          .eq('is_primary', true)
          .maybeSingle()
        const botToken = (bot as any)?.bot_token_encrypted
        if (!botToken) throw new Error('primary_bot_not_configured')

        const endLine = accessEndAt
          ? `\n🗓 Доступ действует до: <b>${fmtRuDate(accessEndAt)}</b>`
          : ''
        const tariffPart = tariffName ? ` (тариф «${tariffName}»)` : ''
        const namePrefix = recipientName ? `${recipientName}, ` : ''
        const extra = overrides.telegram?.intro_text
          ? `\n\n${overrides.telegram.intro_text}`
          : ''
        const text = `✅ <b>Оплата получена!</b>\n\n${namePrefix}вы приобрели <b>${productName}</b>${tariffPart}.${endLine}\n\nЛичный кабинет: https://gorbova.by/purchases${extra}`

        const { ok, data } = await tgSendMessage(botToken, telegramUserId, text, true)
        if (!ok) throw new Error(`telegram_send_failed: ${JSON.stringify(data).slice(0, 300)}`)
        await markDelivery(row.id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: data?.result?.message_id ? String(data.result.message_id) : null,
        })
        results.telegram = { sent: true, delivery_id: row.id }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await markDelivery(row.id, { status: 'failed', error: msg })
        results.telegram = { error: msg, delivery_id: row.id }
      }
    }
  }

  return json({ success: true, ...results })
})
