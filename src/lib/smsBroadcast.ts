/** Channel-specific data must never fall back to an email or Telegram count. */
export function smsAudienceCount(value: unknown): number {
  const count = value && typeof value === 'object' && 'sms_count' in value ? value.sms_count : undefined;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Не удалось проверить получателей SMS. Отправка не запускалась.');
  }
  return count;
}
export function smsTextFromMetadata(value: unknown): string {
  return value && typeof value === 'object' && 'sms_text' in value && typeof value.sms_text === 'string' ? value.sms_text : '';
}
/** Persist the same request identity before dispatch, including across a reload.
 * A missing response must not create a new paid SMS operation.
 */
export async function smsBroadcastRequestId(actorId: string, payload: unknown, storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
  const key = `sms-broadcast-request:${actorId}:${fingerprint}`;
  const previous = storage.getItem(key);
  if (previous && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(previous)) return previous;
  const id = crypto.randomUUID(); storage.setItem(key, id); return id;
}
/** Campaign metadata is immutable for a request, just like its paid recipient set. */
export function smsBroadcastCampaignId(requestId: string, proposedId: string, storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage): string {
  const key = `sms-broadcast-campaign:${requestId}`;
  const previous = storage.getItem(key);
  if (previous) return previous;
  storage.setItem(key, proposedId); return proposedId;
}
