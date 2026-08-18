// notify-order-purchased
// Canonical post-payment notification for paid orders_v2 rows.
// Invoked (non-blocking) from grant-access-for-order at the end of the write path.
//
// Channels:
//   - email        (buyer)                — idempotent by (order_id, channel, notification_type, recipient)
//   - telegram     (buyer DM)             — idempotent
//   - telegram_admin (per admin/super_admin recipient) — one delivery row per admin telegram_user_id
//
// Security (PATCH-ADMIN-PURCHASE-NOTIFY-V1):
//   - verify_jwt = true в config.toml (Supabase проверяет подпись JWT на границе).
//   - Внутри дополнительно требуется role='service_role' в claims — обычный authenticated JWT получает 403.
//   - Параметры `force` и `force_purchase_dm` могут указывать только service-role вызовы (внешний пользователь не имеет доступа к функции вовсе).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { resolveAdminProfileName } from '../_shared/admin-profile-name.ts'

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

function escapeHtml(input: unknown): string {
  const s = input == null ? '' : String(input)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // ── Service-role-only guard ─────────────────────────────────────────────
  // verify_jwt=true уже отсёк неподписанные запросы. Здесь запрещаем всё,
  // кроме role='service_role'.
  //
  // ВНИМАНИЕ: getClaims() валидирует токен через JWKS (asymmetric signing keys)
  // и НЕ принимает статические HS256 legacy-ключи (service_role/anon).
  // Поэтому service_role JWT (который используется для внутренних вызовов)
  // сначала проверяем прямым сравнением с SUPABASE_SERVICE_ROLE_KEY,
  // и только если это не он — валидируем как обычный signing-keys JWT.
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'unauthorized' }, 401)
  }
  const token = authHeader.slice(7).trim()

  let isServiceRole = false
  if (token && svcKey && token === svcKey) {
    isServiceRole = true
  } else {
    try {
      const verifier = createClient(supabaseUrl, anonKey)
      const { data: claimsRes, error: claimsErr } = await verifier.auth.getClaims(token)
      const role = (claimsRes as any)?.claims?.role
      if (!claimsErr && role === 'service_role') isServiceRole = true
    } catch (_e) {
      // fall through to forbidden
    }
  }
  if (!isServiceRole) {
    return json({ error: 'forbidden', reason: 'service_role_required' }, 403)
  }

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
    .select('id, order_number, user_id, profile_id, product_id, tariff_id, customer_email, customer_phone, provider, status, meta, currency, final_price, paid_amount, updated_at')
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

  let accessEndAt: string | null = null
  if (order.product_id) {
    const subUserIds = [order.user_id, (order as any).profile_id].filter(Boolean) as string[]
    for (const uid of subUserIds) {
      const { data: sub } = await supabase
        .from('subscriptions_v2')
        .select('access_end_at')
        .eq('user_id', uid)
        .eq('product_id', order.product_id)
        .in('status', ['active', 'past_due'])
        .order('access_end_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if ((sub as any)?.access_end_at) {
        accessEndAt = (sub as any).access_end_at
        break
      }
    }
  }

  // 3. Buyer recipient resolution
  let recipientEmail: string | null = order.customer_email || null
  let telegramUserId: number | null = null
  let recipientName: string | null = null
  let recipientFullName: string | null = null
  let mirrorUserId: string | null = (order as any).user_id || null
  let mirrorProfileId: string | null = (order as any).profile_id || null

  const applyProfile = (profile: any | null | undefined) => {
    if (!profile) return
    mirrorProfileId = mirrorProfileId || profile.id || null
    mirrorUserId = mirrorUserId || profile.user_id || null
    recipientEmail = recipientEmail || profile.email || null
    recipientName = recipientName || profile.first_name || profile.full_name || null
    recipientFullName = recipientFullName || resolveAdminProfileName(profile)
    if (!telegramUserId) {
      const tuid = profile.telegram_user_id
      if (tuid) telegramUserId = typeof tuid === 'string' ? Number(tuid) : Number(tuid)
    }
  }

  if (order.user_id) {
    const { data: profileByUserId } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, first_name, last_name, telegram_user_id')
      .eq('user_id', order.user_id)
      .limit(1)
      .maybeSingle()
    applyProfile(profileByUserId)
  }

  if ((order as any).profile_id && (!telegramUserId || !recipientEmail || !recipientName || !recipientFullName || !mirrorUserId)) {
    const { data: profileById } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, first_name, last_name, telegram_user_id')
      .eq('id', (order as any).profile_id)
      .maybeSingle()
    applyProfile(profileById)
  }

  if ((!telegramUserId || !recipientName || !recipientFullName || !mirrorUserId) && recipientEmail) {
    const { data: profileByEmail } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, first_name, last_name, telegram_user_id')
      .ilike('email', recipientEmail)
      .limit(1)
      .maybeSingle()
    applyProfile(profileByEmail)
  }

  // 4. Load per-product overrides
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

  // Detect club-DM
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

  // 5. Delivery helpers
  async function upsertDelivery(channel: 'email' | 'telegram' | 'telegram_admin', recipient: string | null) {
    // Split idempotency semantics (aligned with partial unique indexes):
    //   buyer channels (email/telegram): unique by (order_id, channel, notification_type)
    //   telegram_admin:                  unique by (order_id, channel, notification_type, recipient)
    const isAdmin = channel === 'telegram_admin'

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

    let query = supabase
      .from('order_notification_deliveries')
      .select('*')
      .eq('order_id', orderId)
      .eq('channel', channel)
      .eq('notification_type', NOTIFICATION_TYPE)

    if (isAdmin) {
      query = query.eq('recipient', recipient ?? '')
    }

    const { data: existing } = await query.maybeSingle()

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

  // ---- EMAIL (buyer) ----
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
        const paidAmount = Number(order.paid_amount ?? order.final_price ?? 0) || null
        const templateData: Record<string, unknown> = {
          subjectOverride: overrides.email?.subject_override || null,
          recipientName,
          productName,
          tariffName,
          accessEndAt,
          orderNumber: order.order_number,
          paidAmount,
          currency: order.currency || 'BYN',
          paidAt: order.updated_at || new Date().toISOString(),
          introHtml: overrides.email?.intro_html || null,
        }

        const subject = overrides.email?.subject_override || `Оплата получена: ${productName}`
        const previewText = `Спасибо! Мы получили оплату по заказу ${order.order_number || ''}`.trim()

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

        const auditMeta = {
          subject,
          preview_text: previewText,
          message_text: (sendRes as any)?.rendered_text || null,
          rendered_html: (sendRes as any)?.rendered_html || null,
          template_code: 'product-purchased',
          product_name: productName,
          tariff_name: tariffName,
        }

        if ((sendRes as any)?.reason === 'email_suppressed') {
          await markDelivery(row.id, { status: 'skipped', error: 'email_suppressed', metadata: { ...auditMeta, skip_reason: 'email_suppressed' } })
          results.email = { skipped: 'email_suppressed', delivery_id: row.id }
        } else {
          await markDelivery(row.id, { status: 'sent', sent_at: new Date().toISOString(), metadata: auditMeta })
          results.email = { sent: true, delivery_id: row.id }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await markDelivery(row.id, { status: 'failed', error: msg })
        results.email = { error: msg, delivery_id: row.id }
      }
    }
  }

  // ---- Primary bot (used by buyer DM and admin DMs) ----
  const { data: botRow } = await supabase
    .from('telegram_bots')
    .select('id, bot_token_encrypted')
    .eq('status', 'active')
    .eq('is_primary', true)
    .maybeSingle()
  const botToken = (botRow as any)?.bot_token_encrypted || null
  const botId = (botRow as any)?.id || null

  // ---- TELEGRAM (buyer) ----
  const tgEnabled = (overrides.telegram?.is_enabled ?? true) === true
  if (!tgEnabled) {
    results.telegram = { skipped: 'disabled_by_product_template' }
  } else if (!telegramUserId) {
    results.telegram = { skipped: 'no_telegram_user_id' }
  } else if (clubDmSent) {
    const { row } = await upsertDelivery('telegram', String(telegramUserId))
    if (row && row.status !== 'sent') {
      await markDelivery(row.id, {
        status: 'skipped',
        error: 'club_dm_already_sent',
        metadata: {
          template_code: 'product-purchased-dm',
          product_name: productName,
          tariff_name: tariffName,
          skip_reason: 'club_dm_already_sent',
        },
      })
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
        if (!botToken) throw new Error('primary_bot_not_configured')

        const endLine = accessEndAt
          ? `\n🗓 <b>Доступ до:</b> ${escapeHtml(fmtRuDate(accessEndAt))}`
          : ''
        const priceRaw = Number(order.paid_amount ?? order.final_price ?? 0)
        const priceLine = priceRaw > 0
          ? `\n💳 <b>Оплачено:</b> ${escapeHtml(priceRaw.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} ${escapeHtml(order.currency || 'BYN')}`
          : ''
        const orderLine = order.order_number ? `\n🧾 <b>Заказ:</b> ${escapeHtml(order.order_number)}` : ''
        const tariffPart = tariffName ? `\n📦 <b>Тариф:</b> ${escapeHtml(tariffName)}` : ''
        const namePrefix = recipientName ? `${escapeHtml(recipientName)}, ` : ''
        const extra = overrides.telegram?.intro_text ? `\n\n${escapeHtml(overrides.telegram.intro_text)}` : ''
        const text = `✅ <b>Оплата получена!</b>\n\n${namePrefix}вы приобрели <b>${escapeHtml(productName)}</b>.${tariffPart}${priceLine}${endLine}${orderLine}\n\n👉 <a href="https://gorbova.by/purchases">Открыть личный кабинет</a>${extra}`

        const { ok, data } = await tgSendMessage(botToken, telegramUserId, text, true)
        if (!ok) throw new Error(`telegram_send_failed: ${JSON.stringify(data).slice(0, 300)}`)
        const providerMessageId = data?.result?.message_id ? Number(data.result.message_id) : null

        const tgAuditMeta = {
          message_text: text,
          template_code: 'product-purchased-dm',
          parse_mode: 'HTML',
          product_name: productName,
          tariff_name: tariffName,
        }
        await markDelivery(row.id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId ? String(providerMessageId) : null,
          metadata: tgAuditMeta,
        })

        const chatDialogUserId = mirrorUserId || mirrorProfileId
        if (providerMessageId && chatDialogUserId) {
          const { error: mirrorErr } = await supabase
            .from('telegram_messages')
            .insert({
              user_id: chatDialogUserId,
              telegram_user_id: telegramUserId,
              bot_id: botId,
              direction: 'outgoing',
              message_text: text,
              message_id: providerMessageId,
              status: 'sent',
              meta: {
                source: 'notify-order-purchased',
                event: 'product_purchased_dm',
                source_order_id: orderId,
                template_code: 'product-purchased-dm',
                parse_mode: 'HTML',
                order_number: order.order_number || null,
                profile_id: mirrorProfileId,
                product_name: productName,
                tariff_name: tariffName,
              },
            })
          if (mirrorErr && !/duplicate key|unique/i.test(mirrorErr.message || '')) {
            console.error('[notify-order-purchased] telegram_messages mirror failed', mirrorErr)
          }
        }

        results.telegram = { sent: true, delivery_id: row.id }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await markDelivery(row.id, { status: 'failed', error: msg })
        results.telegram = { error: msg, delivery_id: row.id }
      }
    }
  }

  // ---- TELEGRAM_ADMIN (admin/super_admin recipients) ----
  const adminResults: any[] = []
  try {
    if (!botToken) {
      results.telegram_admin = { skipped: 'primary_bot_not_configured' }
    } else {
      // DISTINCT telegram_user_id across admin/super_admin roles
      const { data: roleRows, error: roleErr } = await supabase
        .from('roles')
        .select('id, code')
        .in('code', ['admin', 'super_admin'])
      if (roleErr) throw roleErr
      const roleIds = (roleRows as any[] || []).map((r) => r.id)

      const { data: urRows, error: urErr } = roleIds.length
        ? await supabase.from('user_roles_v2').select('user_id').in('role_id', roleIds)
        : { data: [], error: null } as any
      if (urErr) throw urErr
      const adminUserIds = Array.from(new Set(((urRows as any[]) || []).map((r) => r.user_id).filter(Boolean)))

      const { data: profRows, error: profErr } = adminUserIds.length
        ? await supabase
            .from('profiles')
            .select('id, user_id, telegram_user_id')
            .in('user_id', adminUserIds)
            .not('telegram_user_id', 'is', null)
        : { data: [], error: null } as any
      if (profErr) throw profErr

      const seen = new Set<string>()
      const admins: Array<{ telegramUserId: number; profileId: string | null; profileUserId: string | null }> = []
      for (const prof of (profRows as any[]) || []) {
        const tuidRaw = prof?.telegram_user_id
        if (!tuidRaw) continue
        const tuid = Number(tuidRaw)
        if (!tuid || seen.has(String(tuid))) continue
        seen.add(String(tuid))
        admins.push({ telegramUserId: tuid, profileId: prof?.id || null, profileUserId: prof?.user_id || null })
      }

      // Build admin DM text
      const priceRaw = Number(order.paid_amount ?? order.final_price ?? 0)
      const priceStr = priceRaw > 0
        ? `${priceRaw.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${order.currency || 'BYN'}`
        : '—'
      const adminRecipientName = recipientFullName || recipientName
      const buyerLine = adminRecipientName ? escapeHtml(adminRecipientName) : '—'
      const emailLine = recipientEmail ? `📧 <b>Email:</b> ${escapeHtml(recipientEmail)}\n` : ''
      const phoneRaw = (order as any).customer_phone || null
      const phoneLine = phoneRaw ? `📱 <b>Телефон:</b> ${escapeHtml(phoneRaw)}\n` : ''
      const providerRaw = (order as any).provider || null
      const providerLine = providerRaw ? `💳 <b>Провайдер:</b> ${escapeHtml(providerRaw)}\n` : ''
      const adminText =
        `💰 <b>Новая оплата</b>\n\n` +
        `👤 <b>Клиент:</b> ${buyerLine}\n` +
        emailLine +
        phoneLine +
        `📦 <b>Продукт:</b> ${escapeHtml(productName)}\n` +
        (tariffName ? `🏷 <b>Тариф:</b> ${escapeHtml(tariffName)}\n` : '') +
        `💵 <b>Сумма:</b> ${escapeHtml(priceStr)}\n` +
        providerLine +
        (order.order_number ? `🧾 <b>Заказ:</b> ${escapeHtml(order.order_number)}\n` : '') +
        (accessEndAt ? `🗓 <b>Доступ до:</b> ${escapeHtml(fmtRuDate(accessEndAt))}\n` : '') +
        `\n👉 <a href="https://gorbova.by/admin/orders/${escapeHtml(orderId)}">Открыть заказ</a>`

      const sendOne = async (adm: { telegramUserId: number; profileId: string | null; profileUserId: string | null }) => {
        const { row } = await upsertDelivery('telegram_admin', String(adm.telegramUserId))
        if (!row) return { admin: adm.telegramUserId, error: 'delivery_row_missing' }
        if (row.status === 'sent' && !force) {
          return { admin: adm.telegramUserId, skipped: 'already_sent', delivery_id: row.id }
        }
        try {
          const { ok, data } = await tgSendMessage(botToken, adm.telegramUserId, adminText, true)
          if (!ok) throw new Error(`telegram_send_failed: ${JSON.stringify(data).slice(0, 200)}`)
          const providerMessageId = data?.result?.message_id ? Number(data.result.message_id) : null
          await markDelivery(row.id, {
            status: 'sent',
            sent_at: new Date().toISOString(),
            provider_message_id: providerMessageId ? String(providerMessageId) : null,
            metadata: {
              template_code: 'product-purchased-admin-dm',
              parse_mode: 'HTML',
              product_name: productName,
              tariff_name: tariffName,
              message_text: adminText,
            },
          })

          // Mirror to telegram_messages (idempotent via uniq_tg_msg_admin_purchase_dm)
          const chatDialogUserId = adm.profileUserId || adm.profileId
          if (providerMessageId && chatDialogUserId) {
            const { error: mirrorErr } = await supabase.from('telegram_messages').insert({
              user_id: chatDialogUserId,
              telegram_user_id: adm.telegramUserId,
              bot_id: botId,
              direction: 'outgoing',
              message_text: adminText,
              message_id: providerMessageId,
              status: 'sent',
              meta: {
                source: 'notify-order-purchased',
                event: 'product_purchased_admin_dm',
                source_order_id: orderId,
                admin_telegram_user_id: String(adm.telegramUserId),
                template_code: 'product-purchased-admin-dm',
                parse_mode: 'HTML',
                order_number: order.order_number || null,
                product_name: productName,
                tariff_name: tariffName,
              },
            })
            if (mirrorErr && !/duplicate key|unique/i.test(mirrorErr.message || '')) {
              console.error('[notify-order-purchased] admin telegram_messages mirror failed', mirrorErr)
            }
          }
          return { admin: adm.telegramUserId, sent: true, delivery_id: row.id }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          await markDelivery(row.id, { status: 'failed', error: msg })
          return { admin: adm.telegramUserId, error: msg, delivery_id: row.id }
        }
      }

      const settled = await Promise.allSettled(admins.map(sendOne))
      for (const s of settled) {
        if (s.status === 'fulfilled') adminResults.push(s.value)
        else adminResults.push({ error: String((s as any).reason) })
      }
      results.telegram_admin = { recipients: admins.length, results: adminResults }
    }
  } catch (e) {
    console.error('[notify-order-purchased] telegram_admin block error', e)
    results.telegram_admin = { error: e instanceof Error ? e.message : String(e) }
  }

  // Referral sale notifications are deliberately fail-soft: a Telegram
  // outage must never turn a successful payment into an error.
  try {
    const referralNotify = await supabase.functions.invoke('referral-notify', {
      body: { event_type: 'sale', order_id: orderId },
      headers: { Authorization: `Bearer ${svcKey}` },
    })
    results.telegram_referral = referralNotify.error
      ? { error: referralNotify.error.message }
      : referralNotify.data
  } catch (e) {
    results.telegram_referral = { error: e instanceof Error ? e.message : String(e) }
  }

  return json({ success: true, ...results })
})
