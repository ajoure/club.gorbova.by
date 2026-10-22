// No network retry: an unknown Telegram result must be reconciled by the operator.
export async function loadSupportUpload(service: any, actorClient: any, payload: any): Promise<Uint8Array | undefined> {
  const file = payload.file;
  if (!file) return;
  if (file.storage_bucket !== 'telegram-media' || !file.storage_path || file.base64) throw new Error('support_upload_scope_mismatch');
  const params = { p_user_id: payload.user_id, p_bot_id: payload.support_bot_id, p_path: file.storage_path };
  const first = await actorClient.rpc('support_bot_upload_v1', params);
  if (first.error || !first.data?.id) throw new Error('support_upload_owner_not_verified');
  const { data, error } = await service.storage.from('telegram-media').download(file.storage_path);
  if (error || !data) throw new Error('support_upload_download_failed');
  const bytes = new Uint8Array(await data.arrayBuffer());
  const second = await actorClient.rpc('support_bot_upload_v1', params);
  if (second.error || JSON.stringify(first.data) !== JSON.stringify(second.data)) throw new Error('support_upload_changed_reselect_file');
  return bytes;
}

export function createSupportSendGate(service: any, payload: any, actorId: string) {
  return async (send: (recipient: string, signal: AbortSignal) => Promise<any>) => {
    const { data: claim, error } = await service.rpc('support_bot_begin_send_v1', {
      p_actor: actorId, p_user_id: payload.user_id, p_bot_id: payload.support_bot_id,
      p_observed_incoming_id: payload.support_observed_incoming_id,
      p_request_id: payload.support_request_id, p_reply_to: payload.reply_to_message_id ?? null,
    });
    if (error || !claim?.telegram_user_id) throw new Error(error?.message || 'support_send_not_authorized');
    // All file preparation and bot lookup precede this call. Only this bounded
    // Telegram request runs while profile/assignment changes are excluded.
    if (!Number.isFinite(Date.parse(claim.lease_until)) || Date.parse(claim.lease_until) - Date.now() < 30_000) {
      await service.rpc('support_bot_finish_send_v1', {p_request_id:payload.support_request_id,p_status:'rejected',p_telegram_message_id:null});
      throw new Error('support_send_authorization_expired_refresh');
    }
    let result: any;
    try {
      result = await send(String(claim.telegram_user_id), AbortSignal.timeout(25_000));
    } catch {
      await service.rpc('support_bot_finish_send_v1', { p_request_id: payload.support_request_id, p_status: 'uncertain', p_telegram_message_id: null });
      throw new Error('support_send_delivery_unknown_do_not_retry');
    }
    const sent = result?.ok === true && !!result?.result?.message_id;
    const rejected = result?.ok === false;
    const finish = await service.rpc('support_bot_finish_send_v1', {
      p_request_id: payload.support_request_id,
      p_status: sent ? 'sent' : rejected ? 'rejected' : 'uncertain',
      p_telegram_message_id: sent ? result.result.message_id : null,
    });
    if (finish.error || (!sent && !rejected)) throw new Error('support_send_delivery_unknown_do_not_retry');
    if (sent && payload.file?.type === 'voice' && !result.result.voice) {
      // Delivery is known. Preserve it and warn; no support delete/second call.
      return {...result,support_warning:'Сообщение доставлено вложением: Telegram изменил формат голосового. Повторно отправлять его не нужно.'};
    }
    return result;
  };
}
