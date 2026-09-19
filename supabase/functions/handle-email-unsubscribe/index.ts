import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  EmailAPIError,
  getEmailUnsubscribe,
  setEmailUnsubscribe,
} from 'npm:@lovable.dev/email-js@0.1.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { requestToken } from './request-token.ts'

const SENDER_DOMAIN = 'sent.gorbova.by'

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function emailOptions(apiKey: string) {
  return { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const token = await requestToken(req)
  if (!token || token.length > 512) {
    return jsonResponse({ error: 'Invalid unsubscribe token' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !lovableApiKey) {
    console.error('unsubscribe_configuration_missing')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: tokenRecord, error: tokenError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('email, used_at')
    .eq('token', token)
    .maybeSingle()

  if (tokenError || !tokenRecord) {
    console.warn('unsubscribe_token_not_found', { code: tokenError?.code ?? null })
    return jsonResponse({ error: 'Invalid or expired token' }, 404)
  }

  if (tokenRecord.used_at) {
    return jsonResponse({ valid: false, reason: 'already_unsubscribed' })
  }

  const recipient = tokenRecord.email.trim().toLowerCase()
  const options = emailOptions(lovableApiKey)

  try {
    const providerState = await getEmailUnsubscribe(
      { recipient, domain: SENDER_DOMAIN },
      options,
    )

    if (providerState.subscribed === false) {
      return jsonResponse({ valid: false, reason: 'already_unsubscribed' })
    }

    if (req.method === 'GET') {
      return jsonResponse({ valid: true })
    }

    const outcome = await setEmailUnsubscribe(
      { recipient, domain: SENDER_DOMAIN, subscribed: false },
      options,
    )
    if (outcome.subscribed !== false) {
      console.error('unsubscribe_provider_unexpected_state')
      return jsonResponse({ error: 'Failed to process unsubscribe' }, 502)
    }
  } catch (error) {
    const status = error instanceof EmailAPIError ? error.status : null
    const code = error instanceof EmailAPIError ? error.code : null
    console.error('unsubscribe_provider_error', { status, code })
    return jsonResponse({ error: 'Failed to process unsubscribe' }, 502)
  }

  // The provider is authoritative. This local timestamp preserves legacy-link
  // semantics; the signed email webhook mirrors the resulting suppression too.
  const { data: updated, error: updateError } = await supabase
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)
    .select('token')
    .maybeSingle()

  if (updateError) {
    console.error('unsubscribe_token_stamp_failed', { code: updateError.code ?? null })
    return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
  }

  if (!updated) {
    return jsonResponse({ success: false, reason: 'already_unsubscribed' })
  }

  return jsonResponse({ success: true })
})
