/**
 * Shared helper: log automated Telegram message into telegram_messages
 * so admin sees it in Contact Center with the same inline buttons that the client received.
 *
 * STOP-guard: if telegram_message_id is missing — DO NOT insert; only emit a warning.
 *
 * Stored row markers (so UI can render correctly):
 *   direction       = 'outgoing'
 *   sent_by_admin   = NULL                (means: automated, not a human admin)
 *   message_id      = telegram_message_id (from sendMessage result)
 *   meta.source     = source              (e.g. 'subscription-renewal-reminders')
 *   meta.automated  = true
 *   meta.reply_markup = { inline_keyboard: [...] }   (only url buttons are useful in UI)
 */

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export interface InlineKeyboardButtonUrl {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface ReplyMarkup {
  inline_keyboard?: InlineKeyboardButtonUrl[][];
}

export interface LogAutomatedTelegramArgs {
  /** existing service-role supabase client (preferred). If not provided — will be built from env. */
  supabase?: SupabaseClient;
  /** internal contact user_id (uuid) — required */
  user_id: string;
  /** numeric Telegram chat/user id — required */
  telegram_user_id: number | string;
  /** uuid of telegram_bots row, if known */
  bot_id?: string | null;
  /** message text that was sent to client */
  text: string;
  /** raw sendMessage result (we read message_id from it) */
  send_result?: { message_id?: number | null } | null;
  /** explicit message_id, if you already have it */
  telegram_message_id?: number | null;
  /** the inline keyboard that was attached to the message */
  reply_markup?: ReplyMarkup | null;
  /** logical source — function name, e.g. 'subscription-renewal-reminders' */
  source: string;
  /** any extra metadata (will be merged into meta) */
  extra_meta?: Record<string, any>;
}

export interface LogAutomatedTelegramResult {
  ok: boolean;
  inserted: boolean;
  reason?: string;
  row_id?: string;
}

function buildClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('logAutomatedTelegramMessage: SUPABASE_URL / SERVICE_ROLE_KEY missing');
  }
  return createClient(url, key);
}

/**
 * Persist an automated outgoing telegram message into telegram_messages so admin UI mirrors it.
 * Safe-by-default: never throws — returns {ok:false} on bad input or DB error and just logs a warning.
 */
export async function logAutomatedTelegramMessage(
  args: LogAutomatedTelegramArgs,
): Promise<LogAutomatedTelegramResult> {
  try {
    const messageId = args.telegram_message_id ?? args.send_result?.message_id ?? null;

    // STOP-guard #1: no Telegram message_id => do not log
    if (!messageId || typeof messageId !== 'number') {
      console.warn('[logAutomatedTelegramMessage] skip: missing telegram message_id', {
        source: args.source,
        user_id: args.user_id,
      });
      return { ok: false, inserted: false, reason: 'missing_message_id' };
    }

    // STOP-guard #2: no chat_id / user_id
    if (!args.user_id || !args.telegram_user_id) {
      console.warn('[logAutomatedTelegramMessage] skip: missing user_id/telegram_user_id', {
        source: args.source,
      });
      return { ok: false, inserted: false, reason: 'missing_recipient' };
    }

    const supabase = args.supabase ?? buildClient();

    const meta: Record<string, any> = {
      ...(args.extra_meta ?? {}),
      automated: true,
      source: args.source,
    };
    if (args.reply_markup && Array.isArray(args.reply_markup.inline_keyboard)) {
      meta.reply_markup = args.reply_markup;
    }

    // Idempotency guard (best-effort, no DB constraint per plan):
    // If meta.idempotency_key is set and a previous mirror row already exists
    // for the same key + user_id, skip insert so admin Contact Center does not
    // show duplicate bubbles when an automated DM is replayed.
    const idempotencyKey: string | null =
      typeof meta.idempotency_key === 'string' && meta.idempotency_key.length > 0
        ? meta.idempotency_key
        : null;

    if (idempotencyKey) {
      try {
        const { data: existing } = await supabase
          .from('telegram_messages')
          .select('id')
          .eq('user_id', args.user_id)
          .eq('direction', 'outgoing')
          .filter('meta->>idempotency_key', 'eq', idempotencyKey)
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          console.warn('[logAutomatedTelegramMessage] skip duplicate by idempotency_key', {
            source: args.source,
            user_id: args.user_id,
            idempotency_key: idempotencyKey,
            existing_row_id: existing.id,
          });
          return { ok: true, inserted: false, reason: 'duplicate_idempotency_key', row_id: existing.id };
        }
      } catch (idemErr) {
        console.warn('[logAutomatedTelegramMessage] idempotency lookup failed (continuing)', {
          source: args.source,
          error: idemErr instanceof Error ? idemErr.message : String(idemErr),
        });
      }
    }

    const row = {
      user_id: args.user_id,
      telegram_user_id: Number(args.telegram_user_id),
      bot_id: args.bot_id ?? null,
      direction: 'outgoing' as const,
      message_text: args.text ?? null,
      message_id: messageId,
      sent_by_admin: null, // marker of automated
      status: 'sent' as const,
      meta,
    };

    const { data, error } = await supabase
      .from('telegram_messages')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      console.warn('[logAutomatedTelegramMessage] insert failed', {
        source: args.source,
        error: error.message,
      });
      return { ok: false, inserted: false, reason: error.message };
    }

    return { ok: true, inserted: true, row_id: data?.id };
  } catch (e) {
    console.warn('[logAutomatedTelegramMessage] exception', {
      source: args.source,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, inserted: false, reason: 'exception' };
  }
}
