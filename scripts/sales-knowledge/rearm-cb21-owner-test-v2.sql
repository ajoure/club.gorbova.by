-- Managed Lovable execute only, once after exact-SHA deployment.
-- Data correction, NOT a schema migration. No messages, jobs or history are deleted.
DO $$
DECLARE p public.sales_campaigns; c public.sales_conversations;
BEGIN
 SELECT * INTO STRICT p FROM public.sales_campaigns WHERE code='cb21-owner-test' FOR UPDATE;
 SELECT * INTO STRICT c FROM public.sales_conversations WHERE campaign_id=p.id FOR UPDATE;
 IF p.policy_version='cb21-v2' AND p.mode='off' AND c.human_hold AND NOT c.started AND c.stage='qualification' THEN
  RETURN; -- idempotent read-back; never reset a v2 conversation that has started
 END IF;
 IF p.policy_version<>'cb21-v1' OR p.test_user_id<>p.assignee_user_id
  OR c.state<>'HUMAN_HOLD' OR NOT c.human_hold
  OR c.answered_seq<>c.last_inbound_seq
  OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('queued','claimed','sending','unknown'))
  OR (SELECT count(*) FROM public.sales_jobs WHERE conversation_id=c.id AND status='sent')<>1
 THEN RAISE EXCEPTION 'owner_test_rearm_precondition_failed'; END IF;
 UPDATE public.sales_campaigns SET policy_version='cb21-v2',mode='off',enabled_at=NULL WHERE id=p.id;
 UPDATE public.sales_conversations SET started=false,stage='qualification',human_hold=true,state='HUMAN_HOLD',
  revision=revision+1,reason='dialogue_v2_awaiting_owner_review',updated_at=now() WHERE id=c.id;
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details)
 VALUES(c.id,'policy_rearmed',p.assignee_user_id,jsonb_build_object('old_policy',p.policy_version,'new_policy','cb21-v2','old_stage',c.stage,'old_revision',c.revision,'reason','activation_is_codeword_not_program_request'));
END $$;
