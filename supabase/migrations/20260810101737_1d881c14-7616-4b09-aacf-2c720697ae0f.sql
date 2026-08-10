WITH human_out AS (
  SELECT user_id, transport, bot_id, business_account_id, created_at
  FROM public.telegram_messages
  WHERE direction='outgoing' AND user_id IS NOT NULL
    AND ( message_origin IN ('crm_operator','owner_manual')
       OR ( sent_by_admin IS NOT NULL AND transport='bot' AND message_origin IS NULL
            AND meta->>'source'='contact_center'
            AND COALESCE(meta->>'broadcast','false') <> 'true' ) )
), cand AS (
  SELECT i.id
  FROM public.telegram_messages i
  WHERE i.direction='incoming' AND i.is_read=false AND i.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM human_out h
      WHERE h.user_id=i.user_id AND h.transport=i.transport
        AND h.created_at > i.created_at
        AND h.bot_id IS NOT DISTINCT FROM i.bot_id
        AND h.business_account_id IS NOT DISTINCT FROM i.business_account_id
    )
)
UPDATE public.telegram_messages t
SET is_read = true, requires_reply = false
FROM cand
WHERE t.id = cand.id;