import * as React from 'npm:react@18.3.1'
// PATCH-EMAIL-FOOTER-UTF8-V1 (preserved): synchronous `render` from
// @react-email/render@0.0.17. The async renderer used a ReadableStream +
// TextDecoder pipeline that corrupted multi-byte UTF-8 characters landing on
// chunk boundaries (observed: `С` → `\uFFFD\uFFFD`). This project's emails are
// Cyrillic, so the synchronous renderer must stay.
import { render as renderEmail } from 'npm:@react-email/render@0.0.17'
import { EmailAPIError, sendLovableEmail } from 'npm:@lovable.dev/email-js@0.1.0'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'

// Mirrors the scaffolded send helper's configuration.
const SITE_NAME = 'Буква закона'
// Verified sender subdomain FQDN — never the root domain.
const SENDER_DOMAIN = 'sent.gorbova.by'
// Domain shown in the From: header (cosmetic only).
const FROM_DOMAIN = 'gorbova.by'

export interface SendProductPurchasedEmailResult {
  sent: boolean
  reason?: 'recipient_suppressed'
  subject: string
  html: string
  text: string
}

interface SupabaseLike {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => Promise<{ error: unknown }>
  }
}

async function logSend(
  supabase: SupabaseLike,
  row: {
    message_id: string
    template_name: string
    recipient_email: string
    status: 'sent' | 'suppressed' | 'failed'
    error_message?: string
  },
): Promise<void> {
  const { error } = await supabase.from('email_send_log').insert(row)
  if (error) {
    // A log row never decides the send result.
    console.error('Failed to write email_send_log', { status: row.status, error })
  }
}

/**
 * Renders the registered template and sends it through Lovable's managed email
 * API. A direct send (instead of the shared helper) because this sender needs
 * the rendered HTML/text back for its own delivery audit record and must keep
 * the synchronous Cyrillic-safe renderer.
 */
export async function sendProductPurchasedEmail(
  supabase: SupabaseLike,
  params: {
    templateName: string
    recipientEmail: string
    idempotencyKey: string
    templateData: Record<string, unknown>
  },
): Promise<SendProductPurchasedEmailResult> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) {
    throw new Error('LOVABLE_API_KEY is not configured')
  }

  const template = TEMPLATES[params.templateName]
  if (!template) {
    throw new Error(
      `Template '${params.templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
    )
  }

  const recipient = template.to || params.recipientEmail
  if (!recipient) {
    throw new Error('Recipient is required (the template defines no fixed recipient)')
  }

  const messageId = crypto.randomUUID()
  const element = React.createElement(template.component, params.templateData)
  const html = await renderEmail(element)
  const text = await renderEmail(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(params.templateData)
      : template.subject

  // PATCH-EMAIL-FOOTER-UTF8-V1: non-blocking diagnostic for residual U+FFFD.
  const REPLACEMENT_CHAR = '\uFFFD'
  if (html.includes(REPLACEMENT_CHAR) || text.includes(REPLACEMENT_CHAR)) {
    console.error('email_utf8_replacement_detected', {
      templateName: params.templateName,
      messageId,
      html_replacement_count: (html.match(/\uFFFD/g) || []).length,
      text_replacement_count: (text.match(/\uFFFD/g) || []).length,
    })
  }

  try {
    await sendLovableEmail(
      {
        to: recipient,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        label: params.templateName,
        idempotency_key: params.idempotencyKey,
      },
      { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') },
    )
  } catch (error) {
    if (error instanceof EmailAPIError && error.code === 'recipient_suppressed') {
      await logSend(supabase, {
        message_id: messageId,
        template_name: params.templateName,
        recipient_email: recipient,
        status: 'suppressed',
      })
      return { sent: false, reason: 'recipient_suppressed', subject, html, text }
    }
    const errorMsg = error instanceof Error ? error.message : String(error)
    await logSend(supabase, {
      message_id: messageId,
      template_name: params.templateName,
      recipient_email: recipient,
      status: 'failed',
      error_message: errorMsg.slice(0, 1000),
    })
    throw error
  }

  await logSend(supabase, {
    message_id: messageId,
    template_name: params.templateName,
    recipient_email: recipient,
    status: 'sent',
  })

  return { sent: true, subject, html, text }
}
