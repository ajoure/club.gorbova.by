import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {load} from './zg27-ingress-harness';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const bot=id(3),profile=id(4),funnel=id(5),launch=id(6),a=id(7),b=id(8),c=id(9),ab=id(10),ac=id(11);
async function fixture(options:{image?:boolean;imageStart?:boolean;legacy?:boolean}={}){
 const {PGlite}=await import(/* @vite-ignore */ process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');
 const pg=new PGlite();await pg.exec(readFileSync('tests/sql/fixtures/telegram-funnel-base.sql','utf8'));await pg.exec(readFileSync('supabase/migrations/20261120100609_telegram_funnel_buttons.sql','utf8'));
 if(options.legacy)await pg.exec('UPDATE profiles SET user_id=NULL');
 const rpc=async(name:string,args:any)=>{if(!/^telegram_funnel_[a-z_]+$/.test(name))throw Error('unexpected RPC');const entries=Object.entries(args);const result=await pg.query(`SELECT to_jsonb(public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')})) AS value`,entries.map(([,v])=>v));return{data:result.rows[0]?.value,error:null}};
 const db:any={rpc,from:(name:string)=>{expect(name).toBe('telegram_bots');const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:bot,status:'active',bot_token_encrypted:'SYNTHETIC_NOT_A_TOKEN'}})};return q},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://synthetic.invalid/image'}})})}};
 const graph=[{id:a,text:'*Start*',...(options.imageStart?{image_path:'synthetic/start.jpg'}:{}),buttons:[{id:ab,text:'B',kind:'next',target_block_id:b},{id:ac,text:'C',kind:'next',target_block_id:c},{id:id(12),text:'External',kind:'url',url:'https://example.invalid/'}]},
 {id:b,text:'B',...(options.image?{image_path:'synthetic/image.jpg'}:{}),buttons:[]},{id:c,text:'C',buttons:[]}];
 await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 await rpc('telegram_funnel_save',{p_id:funnel,p_expected_revision:0,p_name:'Synthetic',p_start:a,p_blocks:graph,p_status:'active'});
 await rpc('telegram_funnel_begin_launch',{p_id:launch,p_funnel:funnel,p_revision:1,p_bot:bot,p_filters:{version:1,root:{id:'s',kind:'field',field:'status',operator:'eq',value:'active'}},p_restart:false});
 const en=(await rpc('telegram_funnel_enroll',{p_launch:launch,p_profiles:[profile]})).data[0];
 const journal=vi.fn(async()=>({ok:true}));const h=load('supabase/functions/_shared/telegram-funnel.ts',{'./log-automated-telegram.ts':{logAutomatedTelegramMessage:journal}},{TextEncoder,AbortSignal});
 return{pg,db,rpc,en,h:h.exports,journal,close:()=>pg.close()};
}
const callback=(data:string,message:number,update=1)=>({update_id:update,callback_query:{id:`cb-${update}`,data,from:{id:100},message:{message_id:message,chat:{id:100,type:'private'}}}});
describe('actual reusable sender + compiled durable SQL (fake Telegram only)',()=>{
 it('sends three blocks/branches with typed URL and photo, dedupes callback and persists only token hashes',async()=>{
  const f=await fixture({image:true});try{
   const calls:any[]=[];const transport=vi.fn(async(url:string,init:any)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json({ok:true,result:{message_id:100+calls.length,chat:{id:100}}})});
   const opts={supabaseUrl:'https://synthetic.invalid',fetch:transport};
   expect((await f.h.deliverFunnelStep(f.db,f.en.delivery_id,opts)).state).toBe('sent');const keyboard=calls[0].body.reply_markup.inline_keyboard;
   expect(calls[0].body.parse_mode).toBe('Markdown');expect(keyboard[0][0].callback_data.length).toBeLessThanOrEqual(64);expect(keyboard[2][0].url).toContain('?funnel=1');
   expect((await f.h.handleFunnelCallback(f.db,bot,callback(keyboard[0][0].callback_data,101),opts)).state).toBe('claimed');
   expect(calls[1].url).toContain('/sendPhoto');expect(calls[1].body.caption).toBe('B');
   await f.h.handleFunnelCallback(f.db,bot,callback(keyboard[0][0].callback_data,101),opts);expect(calls).toHaveLength(2);
   await f.h.handleFunnelCallback(f.db,bot,callback(keyboard[1][0].callback_data,101,2),opts);expect(calls).toHaveLength(3);expect(calls[2].body.text).toBe('C');
   expect((await f.pg.query('SELECT status FROM telegram_funnel_enrollments')).rows[0].status).toBe('completed');
   const stored=JSON.stringify((await f.pg.query('SELECT * FROM telegram_funnel_callback_tokens')).rows);expect(stored).not.toContain(keyboard[0][0].callback_data);
   expect(JSON.stringify(f.journal.mock.calls)).not.toContain(keyboard[0][0].callback_data);
   expect((await f.h.handleFunnelCallback(f.db,bot,callback('https://example.invalid/',101,3),opts)).handled).toBe(false);expect(calls).toHaveLength(3);
  }finally{await f.close()}
 });
 it('defers a real early click inside provider response and dispatches it after finish, no click loss or second start',async()=>{
  const f=await fixture();try{
   let count=0;const transport=vi.fn(async(_url:string,init:any)=>{count++;const body=JSON.parse(init.body);if(count===1){const result=await f.h.handleFunnelCallback(f.db,bot,callback(body.reply_markup.inline_keyboard[0][0].callback_data,201),{supabaseUrl:'https://synthetic.invalid',fetch:transport});expect(result.state).toBe('deferred')};return Response.json({ok:true,result:{message_id:count===1?201:202,chat:{id:100}}})});
   await f.h.deliverFunnelStep(f.db,f.en.delivery_id,{supabaseUrl:'https://synthetic.invalid',fetch:transport});expect(count).toBe(2);
   const receipts=(await f.pg.query('SELECT state FROM telegram_funnel_callback_receipts')).rows;expect(receipts).toEqual([{state:'resolved'}]);
   expect((await f.pg.query('SELECT count(*)::int AS n FROM telegram_funnel_deliveries WHERE status=\'sent\'')).rows[0].n).toBe(2);
  }finally{await f.close()}
 });
 it('transport timeout is durable unknown and cannot be retried or silently restarted',async()=>{
  const f=await fixture();try{
   const transport=vi.fn(async()=>{throw Error('synthetic network failure')});const opts={supabaseUrl:'https://synthetic.invalid',fetch:transport};
   expect((await f.h.deliverFunnelStep(f.db,f.en.delivery_id,opts)).state).toBe('unknown');expect((await f.h.deliverFunnelStep(f.db,f.en.delivery_id,opts)).state).toBe('unknown');expect(transport).toHaveBeenCalledOnce();
   expect((await f.pg.query('SELECT status,error_code FROM telegram_funnel_deliveries')).rows).toEqual([{status:'unknown',error_code:'transport_unknown'}]);
  }finally{await f.close()}
 });
 it('stop during request preserves late receipt without reopening or allowing old buttons',async()=>{
  const f=await fixture();try{
   let token='';const transport=vi.fn(async(_url:string,init:any)=>{token=JSON.parse(init.body).reply_markup.inline_keyboard[0][0].callback_data;await f.rpc('telegram_funnel_stop_launch',{p_launch:launch});return Response.json({ok:true,result:{message_id:301,chat:{id:100}}})});
   await f.h.deliverFunnelStep(f.db,f.en.delivery_id,{supabaseUrl:'https://synthetic.invalid',fetch:transport});
   expect((await f.pg.query('SELECT status FROM telegram_funnel_enrollments')).rows[0].status).toBe('stopped');
   expect((await f.h.handleFunnelCallback(f.db,bot,callback(token,301),{supabaseUrl:'https://synthetic.invalid',fetch:transport})).state).toBe('stopped');expect(transport).toHaveBeenCalledOnce();
  }finally{await f.close()}
 });
 it('provider rejection is failed without automatic retry, not successful acceptance',async()=>{
  const f=await fixture();try{const transport=vi.fn(async()=>Response.json({ok:false,description:'SYNTHETIC_PRIVATE_PROVIDER_TEXT'},{status:403}));expect((await f.h.deliverFunnelStep(f.db,f.en.delivery_id,{supabaseUrl:'https://synthetic.invalid',fetch:transport})).state).toBe('failed');
   expect(JSON.stringify((await f.pg.query('SELECT * FROM telegram_funnel_events')).rows)).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_TEXT');expect(f.journal).not.toHaveBeenCalled();
  }finally{await f.close()}
 });
 it('foreign or missing receipt chat is unknown even with ok and message ID, and never retried',async()=>{
  const f=await fixture();try{const transport=vi.fn(async()=>Response.json({ok:true,result:{message_id:900,chat:{id:999}}}));const opts={supabaseUrl:'https://synthetic.invalid',fetch:transport};
   expect((await f.h.deliverFunnelStep(f.db,f.en.delivery_id,opts)).state).toBe('unknown');await f.h.deliverFunnelStep(f.db,f.en.delivery_id,opts);expect(transport).toHaveBeenCalledOnce();expect(f.journal).not.toHaveBeenCalled();
  }finally{await f.close()}
 });

 for(const [status,description,code]of [[403,'Forbidden: bot was blocked by the user','bot_blocked'],[400,"Bad Request: can't parse entities",'invalid_message'],[429,'Too Many Requests','rate_limited']]as const)it(`stores safe ${code} without raw provider text`,async()=>{
  const f=await fixture();try{const transport=vi.fn(async()=>Response.json({ok:false,error_code:status,description:description+' SYNTHETIC_SECRET_SUFFIX'},{status}));
   expect((await f.h.deliverFunnelStep(f.db,f.en.delivery_id,{supabaseUrl:'https://synthetic.invalid',fetch:transport})).state).toBe('failed');
   expect((await f.pg.query('SELECT error_code FROM telegram_funnel_deliveries')).rows[0].error_code).toBe(code);expect(JSON.stringify((await f.pg.query('SELECT * FROM telegram_funnel_events')).rows)).not.toContain('SYNTHETIC_SECRET_SUFFIX');
  }finally{await f.close()}
 });
 it('distinguishes missing bot from media preflight and makes no provider call',async()=>{
  const f=await fixture();try{f.db.from=()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:()=>({then:(resolve:any)=>resolve({data:null,error:null})})};return q};const transport=vi.fn();
   await f.h.deliverFunnelStep(f.db,f.en.delivery_id,{supabaseUrl:'https://synthetic.invalid',fetch:transport});expect(transport).not.toHaveBeenCalled();expect((await f.pg.query('SELECT error_code FROM telegram_funnel_deliveries')).rows[0].error_code).toBe('bot_unavailable');
  }finally{await f.close()}
 });
 it('retains media_unavailable before transport instead of a generic error',async()=>{
  const f=await fixture({imageStart:true});try{f.db.storage.from=()=>({createSignedUrl:async()=>({error:{message:'SYNTHETIC_PRIVATE'}})});const transport=vi.fn();
   await f.h.deliverFunnelStep(f.db,f.en.delivery_id,{supabaseUrl:'https://synthetic.invalid',fetch:transport});expect(transport).not.toHaveBeenCalled();expect((await f.pg.query('SELECT error_code FROM telegram_funnel_deliveries')).rows[0].error_code).toBe('media_unavailable');
  }finally{await f.close()}
 });
 it('delivers to an existing legacy profile without creating an Auth account or a fake journal identity',async()=>{
  const f=await fixture({legacy:true});try{const transport=vi.fn(async()=>Response.json({ok:true,result:{message_id:901,chat:{id:100}}}));
   expect((await f.h.deliverFunnelStep(f.db,f.en.delivery_id,{supabaseUrl:'https://synthetic.invalid',fetch:transport})).state).toBe('sent');expect((await f.pg.query('SELECT user_id FROM telegram_funnel_enrollments')).rows[0].user_id).toBeNull();expect((await f.pg.query('SELECT count(*)::int n FROM auth.users')).rows[0].n).toBe(2);expect(f.journal).not.toHaveBeenCalled();
  }finally{await f.close()}
 });

});

it('scoped drain passes its launch to reconciliation and never broadens stale-send processing',async()=>{
 const f=await fixture();try{
  await f.pg.query("UPDATE telegram_funnel_launches SET scheduled_for='2100-01-01' WHERE id=$1",[launch]);
  const transport=vi.fn();await f.h.drainFunnelQueue(f.db,{supabaseUrl:'https://synthetic.invalid',fetch:transport},launch);expect(transport).not.toHaveBeenCalled();
  await f.pg.query("UPDATE telegram_funnel_launches SET scheduled_for=now()-interval '1 second' WHERE id=$1",[launch]);
  transport.mockResolvedValue(Response.json({ok:true,result:{message_id:444,chat:{id:100}}}));
  await f.h.drainFunnelQueue(f.db,{supabaseUrl:'https://synthetic.invalid',fetch:transport},launch);expect(transport).toHaveBeenCalledOnce();
  await f.h.drainFunnelQueue(f.db,{supabaseUrl:'https://synthetic.invalid',fetch:transport},launch);expect(transport).toHaveBeenCalledOnce();
 }finally{await f.close()}
});
