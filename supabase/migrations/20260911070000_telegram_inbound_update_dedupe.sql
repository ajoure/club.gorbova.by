-- Provider update_id is unique within a bot, including across private chats.
-- Only newly instrumented messages participate; historical rows are untouched.
-- Deploy this index before the webhook that writes meta.telegram_update_id.
CREATE UNIQUE INDEX IF NOT EXISTS telegram_messages_bot_update_dedupe_idx
ON public.telegram_messages (bot_id, (meta ->> 'telegram_update_id'))
WHERE direction = 'incoming'
  AND transport = 'bot'
  AND meta ->> 'telegram_update_id' IS NOT NULL;
