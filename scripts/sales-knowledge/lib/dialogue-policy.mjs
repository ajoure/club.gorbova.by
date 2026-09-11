const id = (v) => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const seq = (v) => Number.isSafeInteger(v) && v >= 0;
const time = (v) => typeof v === 'string' ? Date.parse(v) : NaN;

/** Pure policy. The future sender must call this inside a DB lock/transaction, then recheck. */
export function evaluateReply({ policy, conversation, candidate, now }) {
  const deny = (reason) => ({ allowed: false, reason });
  if (policy?.approved !== true || !['shadow', 'draft', 'auto'].includes(policy.mode)) return deny('disabled');
  if (!conversation || !candidate || !id(policy.version) || candidate.policy_version !== policy.version) return deny('policy_revision_changed');
  for (const [list, value] of [['bot_ids', conversation.bot_id], ['conversation_ids', conversation.id],
    ['campaign_ids', conversation.campaign_id], ['product_ids', candidate.product_id]]) {
    if (!id(value) || !Array.isArray(policy[list]) || !policy[list].includes(value)) return deny('outside_scope');
  }
  if (!['bot', 'business'].includes(conversation.transport)) return deny('unknown_transport');
  const nowMs = time(now), inboundTime = time(conversation.last_inbound_at);
  if (!Number.isFinite(nowMs) || !Number.isFinite(inboundTime) || inboundTime > nowMs) return deny('invalid_clock');
  if (conversation.transport === 'business') {
    if (!id(conversation.business_connection_id) || !Array.isArray(policy.business_connection_ids)
        || !policy.business_connection_ids.includes(conversation.business_connection_id)
        || conversation.business_enabled !== true || conversation.can_reply !== true) return deny('business_unavailable');
    if (nowMs - inboundTime >= 86400000) return deny('business_window_expired');
  }
  if (!['READY', 'WAIT_CUSTOMER'].includes(conversation.state)) return deny('conversation_held');
  if (conversation.human_hold !== false || conversation.human_requested !== false) return deny('human_hold');
  if (conversation.opted_out !== false) return deny('opted_out');
  if (conversation.delivery_uncertain !== false || conversation.inflight_reply !== false) return deny('delivery_in_progress_or_unknown');
  if (!seq(conversation.last_inbound_seq) || !seq(conversation.last_answered_inbound_seq)
      || conversation.last_inbound_seq <= conversation.last_answered_inbound_seq
      || conversation.last_inbound_actor !== 'customer') return deny('wait_customer');
  if (candidate.inbound_seq !== conversation.last_inbound_seq
      || !id(conversation.history_revision) || candidate.history_revision !== conversation.history_revision) return deny('stale_history');
  if (!id(policy.knowledge_version) || candidate.knowledge_version !== policy.knowledge_version) return deny('stale_knowledge');
  if (!['product_information', 'product_selection', 'checkout_link'].includes(candidate.intent)) return deny('handoff_intent');
  if (!seq(candidate.new_question_count) || candidate.new_question_count > 1) return deny('too_many_questions');
  if (candidate.facts_verified !== true || candidate.contains_paid_instruction !== false) return deny('unverified_content');
  if (candidate.intent === 'checkout_link' && candidate.offer_verified !== true) return deny('unverified_offer');
  if (policy.mode !== 'auto') return { allowed: false, reason: policy.mode === 'draft' ? 'draft_review' : 'shadow_only' };
  return { allowed: true, reason: 'new_customer_inbound', after_delivery: 'WAIT_CUSTOMER',
    responding_to_seq: conversation.last_inbound_seq };
}

/** Passive events cannot unlock WAIT_CUSTOMER or cancel a human hold. */
export function applyConversationEvent(state, event) {
  if (!state || !event) throw new Error('invalid_conversation_event');
  const next = { ...state };
  if (event.type === 'opt_out') return { ...next, state: 'STOPPED', opted_out: true };
  if (['human_message', 'human_request'].includes(event.type)) return { ...next, state: 'HUMAN_HOLD', human_hold: true };
  if (event.type === 'delivery_unknown') {
    if (!id(event.delivery_id) || event.delivery_id !== next.pending_delivery_id) throw new Error('delivery_identity_mismatch');
    return { ...next, state: 'DELIVERY_UNKNOWN', delivery_uncertain: true };
  }
  if (event.type === 'delivery_confirmed') {
    if (!id(event.delivery_id) || event.delivery_id !== next.pending_delivery_id
        || !seq(event.inbound_seq) || event.inbound_seq > next.last_inbound_seq
        || !seq(next.last_answered_inbound_seq)) throw new Error('invalid_delivery_sequence');
    return { ...next, state: next.human_hold || next.opted_out ? next.state : 'WAIT_CUSTOMER',
      last_answered_inbound_seq: Math.max(next.last_answered_inbound_seq, event.inbound_seq),
      delivery_uncertain: false, inflight_reply: false, pending_delivery_id: null };
  }
  if (event.type === 'customer_message') {
    if (!seq(event.seq) || !seq(next.last_inbound_seq) || event.seq <= next.last_inbound_seq) return next;
    if (!id(event.history_revision) || !Number.isFinite(time(event.at))) throw new Error('invalid_inbound_event');
    return { ...next, last_inbound_seq: event.seq, last_inbound_at: event.at,
      last_inbound_actor: 'customer', history_revision: event.history_revision,
      state: ['READY', 'WAIT_CUSTOMER'].includes(next.state) ? 'READY' : next.state };
  }
  return next;
}
