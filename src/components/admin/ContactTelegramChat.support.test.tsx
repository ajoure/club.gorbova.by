import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactTelegramChat } from './ContactTelegramChat';
const mocks = vi.hoisted(() => ({ rpc:vi.fn(), channel:vi.fn(), operational:vi.fn(), invoke:vi.fn() }));
vi.mock('@/components/admin/TokenizedRichInput',()=>({TokenizedRichInput:({value,onChange}:{value:string;onChange:(s:string)=>void})=><textarea aria-label="Message" value={value} onChange={e=>onChange(e.target.value)} />}));
vi.mock('@/components/admin/chat/PdfViewer',()=>({ PdfViewer:()=>null }));
vi.mock('@/contexts/AuthContext',()=>({ useAuth:()=>({ user:{id:'operator'} }) }));
vi.mock('@/integrations/supabase/client',()=>({ supabase:{
  rpc:mocks.rpc, channel:mocks.channel,
  from:()=>({select:()=>({in:async()=>({data:[],error:null})})}),
  functions:{invoke:mocks.invoke},
} }));
vi.mock('@/integrations/supabase/operational-client',()=>({operationalSupabase:{rpc:mocks.operational}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('service-bot chat mount',()=>{
  it('loads only scoped history, never subscribes to combined messages or clears unread on view',async()=>{
    mocks.rpc.mockImplementation(async(name:string)=>{
      if(['get_user_permissions','get_admin_access'].includes(name)) return {data:[],error:null};
      if(name!=='support_bot_messages_v1') throw new Error(`Unexpected RPC: ${name}`);
      return {data:[{id:'00000000-0000-0000-0000-000000000010',direction:'incoming',message_text:'Synthetic support question',message_id:10,status:'received',created_at:'2026-10-22T10:20:41.029785Z',bot_id:'service-bot',transport:'bot',business_account_id:null,business_connection_id:null,bot_name:'Service',bot_username:'service',requires_reply:true,meta:{}}],error:null};
    });
    const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const view=render(<QueryClientProvider client={cache}><ContactTelegramChat userId="00000000-0000-0000-0000-000000000002" telegramUserId={123} telegramUsername={null} hidePhotoButton supportChannel={{transport:'bot',channel_ref:'service-bot',channel_key:'bot:service-bot',bot_id:'service-bot',label:'Service',username:'service',first_name:null,last_name:null,business_connection_id:null,is_primary:true,can_reply:true,message_count:1,incoming_count:1,unanswered_count:1}} /></QueryClientProvider>);
    await waitFor(()=>expect(screen.getAllByText('Synthetic support question').length).toBeGreaterThan(0));
    expect(mocks.rpc.mock.calls.every(([name])=>['get_user_permissions','get_admin_access','support_bot_messages_v1'].includes(name))).toBe(true);
    expect(mocks.rpc.mock.calls.filter(([name])=>name==='support_bot_messages_v1').every(([,args])=>args.p_bot_id==='service-bot')).toBe(true);
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(mocks.operational).not.toHaveBeenCalled();
    expect(cache.getQueryData(['telegram-messages','00000000-0000-0000-0000-000000000002','combined-senders-v1'])).toBeUndefined();
    mocks.invoke.mockResolvedValue({data:{success:true,message_id:100},error:null});
    fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Synthetic intermediate answer'}});
    fireEvent.click(screen.getByRole('button',{name:'Отправить сообщение'}));
    await waitFor(()=>expect(mocks.invoke).toHaveBeenCalled());
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({action:'send_message',bot_id:'service-bot',support_bot_id:'service-bot',sender_type:'bot'});
    await waitFor(()=>expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue(''));
    expect(mocks.rpc.mock.calls.some(([name])=>/resolve|mark.*read|set_state/.test(name))).toBe(false);
    view.unmount();cache.clear();
  });
});
