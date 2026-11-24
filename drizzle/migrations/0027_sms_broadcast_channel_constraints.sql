
-- Expand only the existing communication channel checks.
ALTER TABLE public.broadcast_templates DROP CONSTRAINT IF EXISTS broadcast_templates_channel_check;
ALTER TABLE public.broadcast_templates ADD CONSTRAINT broadcast_templates_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.broadcast_templates DROP CONSTRAINT IF EXISTS broadcast_templates_channels_check;
ALTER TABLE public.broadcast_templates ADD CONSTRAINT broadcast_templates_channels_check CHECK(cardinality(channels)>0 AND channels<@ARRAY['telegram','email','sms']::text[]);
ALTER TABLE public.broadcast_runs DROP CONSTRAINT IF EXISTS broadcast_runs_channel_check;
ALTER TABLE public.broadcast_runs ADD CONSTRAINT broadcast_runs_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.broadcast_campaigns DROP CONSTRAINT IF EXISTS broadcast_campaigns_channels_check;
ALTER TABLE public.broadcast_campaigns ADD CONSTRAINT broadcast_campaigns_channels_check CHECK(cardinality(channels)>0 AND channels<@ARRAY['telegram','email','sms']::text[]);
ALTER TABLE public.broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_channel_check;
ALTER TABLE public.broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.telegram_funnel_launches ALTER COLUMN bot_id DROP NOT NULL;
ALTER TABLE public.telegram_funnel_enrollments ALTER COLUMN bot_id DROP NOT NULL;
ALTER TABLE public.telegram_funnel_enrollments ADD COLUMN phone_e164 text;
ALTER TABLE public.sms_messages ADD COLUMN funnel_delivery_id uuid REFERENCES public.telegram_funnel_deliveries(id);
CREATE UNIQUE INDEX sms_messages_one_funnel_delivery ON public.sms_messages(funnel_delivery_id) WHERE funnel_delivery_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sms_funnel_needs_telegram(p_start uuid,p_blocks jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce((SELECT coalesce(b->>'channel','telegram')='telegram' FROM jsonb_array_elements(p_blocks)b WHERE b->>'id'=p_start::text),true);
$$;
REVOKE ALL ON FUNCTION public.sms_funnel_needs_telegram(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_funnel_needs_telegram(uuid,jsonb) TO service_role;
ALTER TABLE public.telegram_funnel_launches ADD CONSTRAINT telegram_funnel_bot_channel CHECK(bot_id IS NOT NULL OR NOT public.sms_funnel_needs_telegram((graph_snapshot->>'start_block_id')::uuid,graph_snapshot->'blocks'));
