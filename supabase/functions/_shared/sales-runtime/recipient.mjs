/** Resolve a recipient from stored campaign/conversation rows, never request or model data.
 * This only binds identity; campaign activation and questionnaire eligibility remain
 * the responsibility of the database dispatch fence.
 */
export function conversationRecipient(campaign, conversation, inbound) {
  const uuid = (value) => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (!uuid(campaign?.id) || conversation?.campaign_id !== campaign.id) {
    throw Error('sales_recipient_campaign_mismatch');
  }
  if (!uuid(campaign.bot_id) || !uuid(campaign.business_account_id) ||
      inbound?.bot_id !== campaign.bot_id ||
      inbound.business_account_id !== campaign.business_account_id ||
      inbound.transport !== 'business') {
    throw Error('sales_recipient_transport_mismatch');
  }
  let recipient;
  if (campaign.mode === 'owner_test') {
    recipient = campaign.test_user_id;
    // Existing owner conversations predate the explicit recipient column.
    if (conversation.user_id != null && conversation.user_id !== recipient) {
      throw Error('sales_recipient_owner_mismatch');
    }
  } else if (campaign.mode === 'questionnaire_customer') {
    if (campaign.test_user_id != null) throw Error('sales_recipient_customer_test_scope');
    recipient = conversation.user_id;
  } else {
    throw Error('sales_recipient_campaign_disabled');
  }
  if (!uuid(recipient) || inbound?.user_id !== recipient) {
    throw Error('sales_recipient_message_mismatch');
  }
  const telegramId = Number(inbound.telegram_user_id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    throw Error('sales_recipient_telegram_invalid');
  }
  return recipient;
}

/** Adapter for existing context/checkout/media readers. Their legacy field name
 * is internal only: this object must never update the stored campaign test scope.
 */
export function campaignForConversation(campaign, conversation, inbound) {
  return { ...campaign, test_user_id: conversationRecipient(campaign, conversation, inbound) };
}
