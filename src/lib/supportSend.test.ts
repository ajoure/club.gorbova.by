import {describe,it,expect,vi} from 'vitest';
import {createSupportSendGate,loadSupportUpload} from '../../supabase/functions/telegram-admin-chat/supportSend';
import {deriveSupportNotificationBot,supportNotificationLink,supportNotificationScope} from '../../supabase/functions/contact-center-assignment-notify/supportNotification';
const payload={user_id:'user',support_bot_id:'bot',support_observed_incoming_id:'incoming',support_request_id:'nonce'};
const claim={telegram_user_id:'123',lease_until:new Date(Date.now()+90_000).toISOString()};
describe('support send authorization',()=>{
  it('does not call Telegram after a rejected CAS',async()=>{
    const rpc=vi.fn(async()=>({error:{message:'support_new_incoming_refresh_required'}})),send=vi.fn();
    await expect(createSupportSendGate({rpc},payload,'actor')(send)).rejects.toThrow('support_new_incoming');expect(send).not.toHaveBeenCalled();
  });
  it('uses the pinned recipient and records delivery separately',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:claim}).mockResolvedValueOnce({error:null});
    const send=vi.fn(async(_recipient:string,_signal:AbortSignal)=>({ok:true,result:{message_id:77}}));
    await createSupportSendGate({rpc},payload,'actor')(send);
    expect(send.mock.calls[0][0]).toBe('123');expect(send.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(rpc.mock.calls[1]).toEqual(['support_bot_finish_send_v1',{p_request_id:'nonce',p_status:'sent',p_telegram_message_id:77}]);
  });
  it('records an unknown result and never retries a timed out request',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:claim}).mockResolvedValue({error:null});
    const send=vi.fn(async()=>{throw new Error('timeout');});
    await expect(createSupportSendGate({rpc},payload,'actor')(send)).rejects.toThrow('delivery_unknown');
    expect(send).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[1][1].p_status).toBe('uncertain');
  });
  it('preserves a known voice delivery with one request and a format warning',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:claim}).mockResolvedValue({error:null});
    const send=vi.fn(async()=>({ok:true,result:{message_id:78,audio:{file_id:'synthetic'}}}));
    const result=await createSupportSendGate({rpc},{...payload,file:{type:'voice'}},'actor')(send);
    expect(result.ok).toBe(true);expect(result.support_warning).toContain('Повторно отправлять');
    expect(send).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[1][1].p_status).toBe('sent');
  });
  it('does not download an unowned file, and rejects an object changed during download',async()=>{
    const download=vi.fn(async()=>({data:new Blob(['synthetic'])}));
    const service={storage:{from:()=>({download})}};
    const p={...payload,file:{storage_bucket:'telegram-media',storage_path:'outbound/user/file.txt'}};
    await expect(loadSupportUpload(service,{rpc:async()=>({error:{}})},p)).rejects.toThrow('owner_not_verified');expect(download).not.toHaveBeenCalled();
    const rpc=vi.fn().mockResolvedValueOnce({data:{id:'object',version:'v1'}}).mockResolvedValueOnce({data:{id:'object',version:'v2'}});
    await expect(loadSupportUpload(service,{rpc},p)).rejects.toThrow('upload_changed');expect(download).toHaveBeenCalledTimes(1);
  });
});
describe('service assignment notification',()=>{
 it('links to the exact service bot and excludes private metadata',()=>{
  const message={user_id:'user',bot_id:'bot',transport:'bot',business_account_id:null,business_connection_id:null};
  expect(supportNotificationScope(message,'bot')).toBe(true);
  expect(deriveSupportNotificationBot(message,{id:'bot',status:'active',support_enabled:true})).toBe('bot');
  expect(()=>deriveSupportNotificationBot(message,{id:'bot',status:'active',support_enabled:true},'other')).toThrow('scope_mismatch');
  for(const sourceBot of [null,{id:'bot',status:'inactive',support_enabled:true},{id:'bot',status:'active',support_enabled:false}]) {
    expect(()=>deriveSupportNotificationBot(message,sourceBot)).toThrow('channel_unavailable');
  }
  expect(()=>deriveSupportNotificationBot({...message,business_connection_id:'private'},{id:'bot',status:'active',support_enabled:true})).toThrow('channel_unavailable');
  expect(deriveSupportNotificationBot({...message,transport:'business'},null)).toBeNull();

  expect(supportNotificationScope({...message,business_connection_id:'private'},'bot')).toBe(false);
  expect(supportNotificationScope(message,'other')).toBe(false);
  const link=new URL(supportNotificationLink('user','bot'));
  expect(link.origin).toBe('https://gorbova.by');expect(link.searchParams.get('support_mode')).toBe('1');expect(link.searchParams.get('bot')).toBe('bot');
 });
});
