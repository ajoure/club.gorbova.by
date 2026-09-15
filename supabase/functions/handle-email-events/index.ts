import { createEmailWebhookHandler } from 'npm:@lovable.dev/email-js@0.1.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Notification-only mirror of terminal email outcomes into the project's own
// tables. Lovable enforces suppression at send time; these rows exist for the
// app's reporting surfaces and must never gate a send.

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe'
type SendLogStatus = 'bounced' | 'complained' | 'suppressed'

function messageForReason(reason: SuppressionReason): string {
  switch (reason) {
    case 'bounce':
      return 'Permanent bounce — email address is invalid or rejected'
    case 'complaint':
      return 'Spam complaint — recipient marked email as spam'
    case 'unsubscribe':
      return 'Recipient unsubscribed'
  }
}

async function recordOutcome(
  eventId: string,
  recipient: string,
  messageId: string | null,
  reason: SuppressionReason,
  status: SendLogStatus,
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const normalizedEmail = String(recipient ?? '').toLowerCase()
  if (!normalizedEmail) return

  // Unsubscribes historically also stamped the one-click token as used.
  if (reason === 'unsubscribe') {
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('email', normalizedEmail)
      .is('used_at', null)
    if (tokenError) {
      console.error('Failed to stamp unsubscribe token', {
        event_id: eventId,
        code: (tokenError as { code?: string }).code,
        message: (tokenError as { message?: string }).message,
      })
      throw new Error('unsubscribe_token_update_failed')
    }
  }

  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert({ email: normalizedEmail, reason, metadata: null }, { onConflict: 'email' })
  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      event_id: eventId,
      code: (suppressError as { code?: string }).code,
      message: (suppressError as { message?: string }).message,
    })
    throw new Error('suppression_write_failed')
  }

  const { error: logError } = await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: 'system',
    recipient_email: normalizedEmail,
    status,
    error_message: messageForReason(reason),
    metadata: null,
  })
  if (logError) {
    console.error('Failed to insert email_send_log', {
      event_id: eventId,
      code: (logError as { code?: string }).code,
      message: (logError as { message?: string }).message,
    })
    throw new Error('send_log_write_failed')
  }
}

const handler = createEmailWebhookHandler({
  apiKey: Deno.env.get('LOVABLE_API_KEY')!,
  on: {
    'email.bounced': async (event) => {
      await recordOutcome(
        event.event_id,
        event.data.recipient,
        event.data.message_id ?? null,
        'bounce',
        'bounced',
      )
    },
    'email.complaint': async (event) => {
      await recordOutcome(
        event.event_id,
        event.data.recipient,
        event.data.message_id ?? null,
        'complaint',
        'complained',
      )
    },
    'email.unsubscribed': async (event) => {
      await recordOutcome(
        event.event_id,
        event.data.recipient,
        event.data.message_id ?? null,
        'unsubscribe',
        'suppressed',
      )
    },
  },
})

Deno.serve((req) => handler(req))
