import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  const isService = token === serviceKey
  const admin = createClient(supabaseUrl, serviceKey)
  let callerId: string | null = null
  if (!isService && token) {
    const verifier = createClient(supabaseUrl, anonKey)
    const { data } = await verifier.auth.getUser(token)
    callerId = data.user?.id ?? null
  }
  if (!isService && !callerId) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const eventType = body.event_type === 'sale' ? 'sale' : 'registration'
  let relationship: any = null
  let sale: any = null
  if (eventType === 'sale') {
    if (!isService) return json({ error: 'service_role_required' }, 403)
    const orderId = String(body.order_id || '')
    const result = await admin.from('referral_sale_attributions').select('id,commission_minor,status,relationship_id,order_id,product:product_id(name),relationship:relationship_id(partner_id,referred_profile_id)').eq('order_id', orderId).maybeSingle()
    if (result.error) return json({ error: result.error.message }, 500)
    sale = result.data
    relationship = sale?.relationship
    if (!sale || !relationship) return json({ success: true, skipped: 'no_referral_sale' })
  } else {
    const relationshipId = String(body.relationship_id || '')
    const result = await admin.from('referral_relationships').select('id,partner_id,referred_profile_id').eq('id', relationshipId).maybeSingle()
    if (result.error) return json({ error: result.error.message }, 500)
    relationship = result.data
    if (!relationship) return json({ success: true, skipped: 'relationship_not_found' })
    if (!isService) {
      const referred = await admin.from('profiles').select('user_id').eq('id', relationship.referred_profile_id).maybeSingle()
      if (referred.data?.user_id !== callerId) return json({ error: 'forbidden' }, 403)
    }
  }

  const settings = await admin.from('referral_program_settings').select('is_enabled,telegram_notifications_enabled').eq('singleton', true).maybeSingle()
  if (!settings.data?.is_enabled || settings.data.telegram_notifications_enabled === false) return json({ success: true, skipped: 'notifications_disabled' })

  const [partnerProfile, referredProfile] = await Promise.all([
    admin.from('referral_partners').select('profile:profile_id(user_id,full_name,email,telegram_user_id,telegram_link_status)').eq('id', relationship.partner_id).maybeSingle(),
    admin.from('profiles').select('user_id,full_name,email').eq('id', relationship.referred_profile_id).maybeSingle(),
  ])
  const partner = (partnerProfile.data as any)?.profile
  if (!partner?.user_id) return json({ success: true, skipped: 'partner_profile_not_found' })
  const idempotencyKey = `referral:${eventType}:${eventType === 'sale' ? sale.id : relationship.id}`
  const payload = eventType === 'sale'
    ? { idempotency_key: idempotencyKey, referred_name: referredProfile.data?.full_name || referredProfile.data?.email || 'участник', product_name: sale.product?.name || 'продукт', commission_minor: sale.commission_minor }
    : { idempotency_key: idempotencyKey, referred_name: referredProfile.data?.full_name || referredProfile.data?.email || 'участник' }
  const queued = await admin.from('pending_telegram_notifications').insert({ user_id: partner.user_id, notification_type: eventType === 'sale' ? 'referral_sale' : 'referral_registration', payload, priority: 4 }).select('id').maybeSingle()
  if (queued.error && !/duplicate key|unique/i.test(queued.error.message)) return json({ error: queued.error.message }, 500)

  // If Telegram is already linked, deliver immediately; otherwise the queue is
  // picked up by telegram-process-pending when the partner links Telegram.
  if (partner.telegram_user_id && partner.telegram_link_status === 'active') {
    const bot = await admin.from('telegram_bots').select('bot_token_encrypted').eq('status', 'active').limit(1).maybeSingle()
    if (bot.data?.bot_token_encrypted) {
      const text = eventType === 'sale'
        ? `🎉 Ваш реферал <b>${escapeHtml(payload.referred_name)}</b> совершил покупку <b>${escapeHtml(payload.product_name)}</b>. Начислено: <b>${(Number(payload.commission_minor || 0) / 100).toFixed(2)} BYN</b> бонусов.`
        : `👤 По вашей реферальной ссылке зарегистрировался новый участник: <b>${escapeHtml(payload.referred_name)}</b>.`
      const response = await fetch(`https://api.telegram.org/bot${bot.data.bot_token_encrypted}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: partner.telegram_user_id, text, parse_mode: 'HTML', disable_web_page_preview: true }) })
      const result = await response.json().catch(() => ({}))
      if (result.ok && queued.data?.id) await admin.from('pending_telegram_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', queued.data.id)
    }
  }
  return json({ success: true, queued: !!queued.data?.id, event_type: eventType })
})
