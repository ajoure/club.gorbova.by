import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { parseEmailWebhookPayload } from 'npm:@lovable.dev/email-js'
import { WebhookError, verifyWebhookRequest } from 'npm:@lovable.dev/webhooks-js'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import { sendViaYandexSmtp } from '../_shared/yandex-smtp-sender.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-lovable-signature, x-lovable-timestamp, webhook-id, webhook-timestamp, webhook-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const ROOT_DOMAIN = 'gorbova.by'
const SITE_URL = `https://club.${ROOT_DOMAIN}`
const VERIFY_PROXY_PATH = '/auth-verify'

// Темы писем на русском языке.
const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Подтверждение почты',
  invite: 'Приглашение в Gorbova Club',
  magiclink: 'Ссылка для входа',
  recovery: 'Восстановление пароля',
  email_change: 'Подтверждение нового email',
  reauthentication: 'Код подтверждения',
}

// Маппинг типа события на React Email шаблон.
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Конфигурация отправителя.
const SITE_NAME = 'Gorbova Club'
const FROM_EMAIL = 'noreply@gorbova.by'
const SMTP_HOST = 'smtp.yandex.ru'
const SMTP_PORT = 465

// Sample data for preview mode ONLY.
const SAMPLE_PROJECT_URL = 'https://gorbova.by'
const SAMPLE_EMAIL = 'user@example.test'
const SAMPLE_DATA: Record<string, object> = {
  signup: { siteName: SITE_NAME, siteUrl: SAMPLE_PROJECT_URL, recipient: SAMPLE_EMAIL, confirmationUrl: SAMPLE_PROJECT_URL },
  magiclink: { siteName: SITE_NAME, confirmationUrl: SAMPLE_PROJECT_URL },
  recovery: { siteName: SITE_NAME, confirmationUrl: SAMPLE_PROJECT_URL },
  invite: { siteName: SITE_NAME, siteUrl: SAMPLE_PROJECT_URL, confirmationUrl: SAMPLE_PROJECT_URL },
  email_change: { siteName: SITE_NAME, email: SAMPLE_EMAIL, newEmail: SAMPLE_EMAIL, confirmationUrl: SAMPLE_PROJECT_URL },
  reauthentication: { token: '123456' },
}

// Получение SMTP-пароля Яндекса: сначала из integration_instances (alias/category=email,
// noreply@gorbova.by), затем из секрета YANDEX_SMTP_PASSWORD.
async function getYandexPassword(supabase: any): Promise<string> {
  // 1. integration_instances (alias может быть произвольный, но email = noreply@gorbova.by)
  const { data: integrations } = await supabase
    .from('integration_instances')
    .select('config')
    .eq('category', 'email')
    .eq('is_active', true)

  if (Array.isArray(integrations)) {
    for (const row of integrations) {
      const cfg = (row?.config || {}) as Record<string, unknown>
      const email = (cfg.email as string) || (cfg.from_email as string) || ''
      if (email === FROM_EMAIL) {
        const pwd = (cfg.smtp_password as string) || (cfg.password as string) || ''
        if (pwd) return pwd
      }
    }
  }

  // 2. email_accounts по email
  const { data: acc } = await supabase
    .from('email_accounts')
    .select('smtp_password')
    .eq('email', FROM_EMAIL)
    .eq('is_active', true)
    .maybeSingle()
  if (acc?.smtp_password) return acc.smtp_password

  // 3. Секрет окружения
  const envPwd = Deno.env.get('YANDEX_SMTP_PASSWORD') || ''
  if (envPwd) return envPwd

  throw new Error('YANDEX_SMTP_PASSWORD не настроен и не найден в integration_instances/email_accounts')
}

// Preview endpoint — возвращает HTML без отправки. Используется превью писем в админке.
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]
  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Универсальная нормализация входящего payload — принимаем оба формата:
//   1) Supabase Auth "Send Email Hook" (Standard Webhooks: webhook-id/timestamp/signature).
//      Payload: { user: { email, ... }, email_data: { token, token_hash, redirect_to, email_action_type, site_url, new_email } }
//   2) Lovable Emails managed pipeline (x-lovable-signature).
//      Payload: parseEmailWebhookPayload -> { version, run_id, data: { email, action_type, token, url, new_email } }
// Переходный период: пока Lovable Emails pipeline не отключён окончательно,
// поддерживаем оба, чтобы был безопасный rollback.
interface NormalizedEmail {
  emailType: string
  recipient: string
  token: string
  tokenHash?: string
  rawUrl?: string
  redirectTo?: string
  newEmail?: string
  runId: string
  source: 'supabase_auth' | 'lovable_emails'
}

function b64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

async function tryVerifySupabaseAuth(req: Request, rawBody: string): Promise<NormalizedEmail | null> {
  const rawSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || ''
  if (!rawSecret) return null
  const hasHeaders =
    req.headers.get('webhook-id') &&
    req.headers.get('webhook-timestamp') &&
    req.headers.get('webhook-signature')
  if (!hasHeaders) return null
  // standardwebhooks ожидает base64-кодированный секрет.
  const encoded = rawSecret.startsWith('whsec_')
    ? rawSecret.slice('whsec_'.length)
    : b64(rawSecret)
  const wh = new Webhook(encoded)
  const verified = wh.verify(rawBody, {
    'webhook-id': req.headers.get('webhook-id')!,
    'webhook-timestamp': req.headers.get('webhook-timestamp')!,
    'webhook-signature': req.headers.get('webhook-signature')!,
  }) as { user?: { email?: string }; email_data?: Record<string, any> }
  const ed = verified.email_data || {}
  return {
    emailType: String(ed.email_action_type || ''),
    recipient: String(verified.user?.email || ''),
    token: String(ed.token || ''),
    tokenHash: ed.token_hash ? String(ed.token_hash) : undefined,
    redirectTo: ed.redirect_to ? String(ed.redirect_to) : undefined,
    newEmail: ed.new_email ? String(ed.new_email) : undefined,
    runId: req.headers.get('webhook-id') || crypto.randomUUID(),
    source: 'supabase_auth',
  }
}

async function tryVerifyLovable(req: Request): Promise<NormalizedEmail | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) return null
  if (!req.headers.get('x-lovable-signature')) return null
  try {
    const verified = await verifyWebhookRequest({ req, secret: apiKey, parser: parseEmailWebhookPayload })
    const p: any = verified.payload
    if (!p?.run_id || p.version !== '1') return null
    return {
      emailType: String(p.data.action_type || ''),
      recipient: String(p.data.email || ''),
      token: String(p.data.token || ''),
      rawUrl: p.data.url ? String(p.data.url) : undefined,
      newEmail: p.data.new_email ? String(p.data.new_email) : undefined,
      runId: String(p.run_id),
      source: 'lovable_emails',
    }
  } catch (error) {
    if (error instanceof WebhookError) throw error
    return null
  }
}

// Основной webhook — верифицируем подпись, рендерим шаблон, отправляем через Яндекс SMTP.
async function handleWebhook(req: Request): Promise<Response> {
  // Читаем тело один раз — standardwebhooks требует raw string.
  const rawBody = await req.text()
  const clonedReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  })

  let normalized: NormalizedEmail | null = null
  try {
    normalized = await tryVerifySupabaseAuth(clonedReq, rawBody)
    if (!normalized) {
      normalized = await tryVerifyLovable(clonedReq)
    }
  } catch (error) {
    if (error instanceof WebhookError) {
      const status =
        error.code === 'invalid_payload' || error.code === 'invalid_json' ? 400 : 401
      return new Response(
        JSON.stringify({ error: status === 401 ? 'Invalid signature' : 'Invalid webhook payload' }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    console.error('Auth email hook signature verify failed', { error: String(error) })
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!normalized) {
    return new Response(JSON.stringify({ error: 'Missing or invalid webhook signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { emailType, recipient, token, runId } = normalized
  console.log('Auth webhook received', { emailType, recipient, run_id: runId, source: normalized.source })


  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType, run_id })
    return new Response(JSON.stringify({ error: `Unknown email type: ${emailType}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Ссылку ведём на наш SPA-proxy: /auth/v1/verify на корневом домене
  // может перехватываться сервером до React и отдавать 403/404.
  let confirmationUrl: string = payload.data.url
  try {
    const u = new URL(payload.data.url)
    u.protocol = 'https:'
    u.host = new URL(SITE_URL).host
    u.pathname = VERIFY_PROXY_PATH
    confirmationUrl = u.toString()
  } catch {
    console.warn('Failed to rewrite confirmationUrl host', { url: payload.data.url, run_id })
  }

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: SITE_URL,
    recipient,
    confirmationUrl,
    token: payload.data.token,
    email: recipient,
    newEmail: payload.data.new_email,
  }

  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), { plainText: true })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // OTP-first subjects (PATCH-INLINE-AUTH-EMAIL-OTP-FLOW Phase 2):
  // для signup/magiclink показываем код прямо в теме — так пользователь видит
  // его в списке писем и в push-уведомлении, не открывая письмо.
  const token = payload.data.token
  let subject = EMAIL_SUBJECTS[emailType] || 'Уведомление'
  if (token && (emailType === 'signup' || emailType === 'magiclink')) {
    subject = `Ваш код: ${token}`
  }

  const messageId = crypto.randomUUID()

  // Лог pending до отправки, чтобы был след даже при падении SMTP.
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: recipient,
    status: 'pending',
  })

  try {
    const password = await getYandexPassword(supabase)
    const result = await sendViaYandexSmtp({
      to: recipient,
      subject,
      html,
      text,
      fromName: SITE_NAME,
      fromEmail: FROM_EMAIL,
      smtpHost: SMTP_HOST,
      smtpPort: SMTP_PORT,
      username: FROM_EMAIL,
      password,
    })

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: recipient,
      status: 'sent',
    })

    // Дублируем запись в email_logs для единой ленты переписки.
    try {
      await supabase.from('email_logs').insert({
        direction: 'outgoing',
        from_email: FROM_EMAIL,
        to_email: recipient,
        subject,
        body_html: html,
        body_text: text || null,
        provider: 'yandex_smtp',
        provider_message_id: result.queueId || messageId,
        status: 'sent',
        meta: {
          source: 'auth-email-hook',
          action_type: emailType,
          run_id,
        },
      })
    } catch (logErr) {
      console.warn('email_logs insert failed', { logErr })
    }

    console.log('Auth email sent via Yandex SMTP', { emailType, recipient, run_id })
    return new Response(JSON.stringify({ success: true, sent: true, message_id: messageId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('Yandex SMTP send failed', { errMsg, recipient, run_id, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: recipient,
      status: 'failed',
      error_message: errMsg.slice(0, 500),
    })
    return new Response(JSON.stringify({ error: 'Failed to send email', detail: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
