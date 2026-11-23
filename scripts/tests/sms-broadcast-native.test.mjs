import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
assert.equal(process.env.SMS_BROADCAST_NATIVE_TEST,'1');
assert.equal(process.env.TELEGRAM_FUNNEL_NATIVE_TEST,'1');
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'sms_broadcast_native_test');
assert.ok(Number(process.env.PGPORT)>0);
// Run the unchanged real two-session Telegram regression against the NEW schema.
let code=await readFile(new URL('./telegram-funnel-concurrency.test.mjs',import.meta.url),'utf8');
code=code.replace("process.env.PGDATABASE,'telegram_funnel_native_test'", "process.env.PGDATABASE,'sms_broadcast_native_test'");
const base=new URL('../../supabase/',import.meta.url).href;
code=code.replaceAll("new URL('../../supabase/",`new URL('${base}`);
const bootstrap=`
 ALTER TABLE public.profiles ADD COLUMN phone text;ALTER TABLE public.profiles ADD COLUMN email text;ALTER TABLE public.profiles ADD COLUMN telegram_username text;
 ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz;ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz;ALTER TABLE auth.users ADD COLUMN banned_until timestamptz;
 CREATE TABLE public.telegram_club_members(profile_id uuid,club_id uuid,in_chat boolean);
 CREATE TABLE public.sms_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,company_id uuid,deal_id uuid,phone_e164 text NOT NULL,text text NOT NULL,provider text NOT NULL,status text NOT NULL,external_id text,sender text,error text,cost numeric,segments integer,initiator_user_id uuid REFERENCES auth.users(id),metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 GRANT ALL ON public.sms_messages TO service_role;GRANT SELECT,INSERT,UPDATE ON public.sms_messages TO authenticated;ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;CREATE POLICY fixture_sms_staff ON public.sms_messages TO authenticated USING(true)WITH CHECK(true);
 CREATE TABLE public.broadcast_templates(id uuid PRIMARY KEY,channel text NOT NULL,channels text[],metadata jsonb,status text,approval_status text,trigger_kind text);
 CREATE TABLE public.broadcast_runs(id uuid PRIMARY KEY,channel text);
 CREATE TABLE public.broadcast_campaigns(id uuid PRIMARY KEY,channels text[] NOT NULL DEFAULT ARRAY['telegram']::text[]);
 CREATE TABLE public.broadcast_deliveries(id uuid PRIMARY KEY,channel text);
 CREATE TABLE public.broadcast_automation_deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_id uuid,user_id uuid,event_key text,channel text,available_at timestamptz,created_at timestamptz DEFAULT now(),UNIQUE(template_id,user_id,event_key));
 CREATE TABLE public.site_form_submissions(id uuid PRIMARY KEY,page_id uuid,profile_id uuid,status text,metadata jsonb,created_at timestamptz);
`;
const cutoffSource=await readFile(new URL('../../supabase/migrations/20261010150000_questionnaire_notification_cutoff.sql',import.meta.url),'utf8');
const cutoffGuard=cutoffSource.slice(0,cutoffSource.indexOf('-- Queue new entrants'));
const migration=await readFile(new URL('../../supabase/migrations/20261123061600_sms_broadcast_channel.sql',import.meta.url),'utf8');
code=code.replace('await run(imageTextMigration);',()=>`await run(imageTextMigration);\nawait run(${JSON.stringify(bootstrap+cutoffGuard)});\nawait run(${JSON.stringify(migration)});`);
code+=`
// SMS-only admission: a phone-only contact never needs email/Auth/Telegram.
{
 const phoneOnly=randomUUID();
 await run(\`UPDATE profiles SET phone='+99900123456' WHERE id=\${quote(profile)};INSERT INTO profiles(id,full_name,phone)VALUES(\${quote(phoneOnly)},'Phone only fixture','99900123457');\`);
 const audience=result(await run(service(rpc('resolve_sms_broadcast_contacts',[json({})]))));
 // Public helper ACL is fail-closed; only the staff preview wrapper is exposed.
 assert.equal((await run("SELECT has_function_privilege('authenticated','public.sms_broadcast_enqueue(uuid,text,uuid,text,jsonb,jsonb,boolean,uuid[])','execute')")).trim(),'f');
 assert.equal((await run("SELECT has_table_privilege('authenticated','public.sms_broadcast_dispatches','insert')")).trim(),'f');
 assert.equal((await run("SELECT has_table_privilege('authenticated','public.sms_messages','update')")).trim(),'f');
 const claimSms=async id=>JSON.parse((await run(service("SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM public.sms_broadcast_claim("+quote(id)+",10)s"))).trim());
 let smsPasses=0;
 const request=randomUUID(),meta={self_test:false};
 const filters={direct_profile_ids:[phoneOnly]};
 const enqueue=()=>call('sms_broadcast_enqueue',[quote(request),quote(request),quote(admin),quote('Synthetic SMS test'),json(filters),json(meta),'false','NULL']);
 const first=await enqueue();assert.equal(first.existing,false);
 await run(\`INSERT INTO profiles(id,phone)VALUES(\${quote(randomUUID())},'+99900123458')\`);
 assert.equal((await enqueue()).existing,true);
 assert.equal((await run(\`SELECT count(*) FROM sms_messages WHERE dispatch_id=\${quote(request)}\`)).trim(),'1');smsPasses++;
 const claimed=await claimSms(request);assert.equal(claimed.length,1);assert.equal(claimed[0].status,'sending');
 assert.deepEqual(await claimSms(request),[]);smsPasses++;
 await run(\`UPDATE sms_messages SET updated_at=now()-interval '3 minutes' WHERE dispatch_id=\${quote(request)}\`);
 assert.deepEqual(await claimSms(request),[]);
 assert.equal((await run(\`SELECT status FROM sms_messages WHERE dispatch_id=\${quote(request)}\`)).trim(),'unknown');smsPasses++;
 // Payload collision must not enqueue an altered second message.
 await assert.rejects(()=>call('sms_broadcast_enqueue',[quote(request),quote(request),quote(admin),quote('Altered payload'),json(filters),json(meta),'false','NULL']),/sms_request_conflict/);smsPasses++;
 // Phone deduplication is independent of email and account presence.
 await run(\`INSERT INTO profiles(id,phone)VALUES(\${quote(randomUUID())},'99900123457')\`);
 const dedup=await run(\`SELECT count(*) FROM resolve_sms_broadcast_contacts('{}')WHERE phone_e164='+99900123457'\`);assert.equal(dedup.trim(),'1');smsPasses++;
 const funnel=randomUUID(),block=randomUUID(),launch=randomUUID();
 await call('telegram_funnel_save',[quote(funnel),'0',quote('SMS fixture'),quote(block),json([{id:block,channel:'sms',text:'Synthetic SMS step',buttons:[]},{id:randomUUID(),text:'Unreachable Telegram draft',buttons:[]}]),quote('active')],true);
 await call('telegram_funnel_begin_launch',[quote(launch),quote(funnel),'1','NULL',json(everyone),'false','NULL'],true);
 const enrolledCount=(await run(\`SELECT count(*) FROM telegram_funnel_enrollments WHERE launch_id=\${quote(launch)} AND status='active' AND phone_e164='+99900123457'\`)).trim();assert.equal(enrolledCount,'1');
 const delivery=(await run(\`SELECT d.id FROM telegram_funnel_deliveries d JOIN telegram_funnel_enrollments en ON en.id=d.enrollment_id WHERE en.launch_id=\${quote(launch)} AND en.status='active' AND en.phone_e164='+99900123457'\`)).trim();assert.ok(delivery);
 let [winner,duplicate]=await race(rpc('sms_funnel_claim_send',[quote(delivery)]),rpc('sms_funnel_claim_send',[quote(delivery)]),'sms-send-claim');
 assert.equal(winner.state,'claimed');assert.equal(duplicate.state,'sending');smsPasses++;
 await call('sms_funnel_finish_send',[quote(delivery),quote(winner.lease_id),quote('unknown'),'NULL',quote('transport_unknown')]);
 assert.equal((await call('sms_funnel_claim_send',[quote(delivery)])).state,'unknown');smsPasses++;
 await assert.rejects(()=>call('sms_funnel_finish_send',[quote(delivery),quote(winner.lease_id),quote('sent'),'NULL','NULL']),/funnel_finish_invalid/);smsPasses++;
 // A receipt completes an SMS step, without inventing a Telegram message ID.
 const tgFunnel=randomUUID(),tgStart=randomUUID(),smsEnd=randomUUID(),next=randomUUID(),tgLaunch=randomUUID();
 await call('telegram_funnel_save',[quote(tgFunnel),'0',quote('TG to SMS fixture'),quote(tgStart),json([{id:tgStart,text:'Choose next',buttons:[{id:next,text:'SMS',kind:'next',target_block_id:smsEnd}]},{id:smsEnd,channel:'sms',text:'Synthetic SMS child',buttons:[]}]),quote('active')],true);
 await call('telegram_funnel_begin_launch',[quote(tgLaunch),quote(tgFunnel),'1',quote(bot),json(everyone),'false','NULL'],true);
 const tgDelivery=(await run(\`SELECT d.id FROM telegram_funnel_deliveries d JOIN telegram_funnel_enrollments en ON en.id=d.enrollment_id WHERE en.launch_id=\${quote(tgLaunch)} AND en.profile_id=\${quote(profile)}\`)).trim();
 const hash=createHash('sha256').update(randomUUID()).digest('hex');
 const tgClaim=await call('telegram_funnel_claim_send',[quote(tgDelivery),json([{button_id:next,token_hash:hash}])]);
 await call('telegram_funnel_finish_send',[quote(tgDelivery),quote(tgClaim.lease_id),quote('sent'),'789','NULL']);
 const child=await call('telegram_funnel_claim_callback',[quote(hash),quote(bot),'100','100','789',quote('sms-transition'),'501']);
 assert.equal(child.state,'claimed');
 const smsClaim=await call('sms_funnel_claim_send',[quote(child.delivery_id)]);assert.equal(smsClaim.state,'claimed');
 await call('sms_funnel_finish_send',[quote(child.delivery_id),quote(smsClaim.lease_id),quote('sent'),quote('12345678901234567890'),'NULL']);
 assert.equal((await run(\`SELECT status FROM telegram_funnel_enrollments WHERE id=(SELECT enrollment_id FROM telegram_funnel_deliveries WHERE id=\${quote(child.delivery_id)})\`)).trim(),'completed');smsPasses++;
 // Summary aggregates every row, beyond PostgREST's default 1000-row response cap.
 const large=randomUUID();await call('sms_broadcast_enqueue',[quote(large),quote(large),quote(admin),quote('Summary fixture'),json({direct_profile_ids:[]}),json(meta),'false','NULL']);
 await run(\`INSERT INTO sms_messages(phone_e164,text,provider,status,dispatch_id,dispatch_key)SELECT '+9991000'||lpad(n::text,4,'0'),'Summary fixture','smsby','queued',\${quote(large)},'summary:'||\${quote(large)}||':'||n FROM generate_series(1,1201)n\`);
 const summary=await call('sms_broadcast_summary',[quote(large)]);assert.equal(summary.queued,1201);assert.equal(summary.total,1201);assert.equal(summary.sms_ids.length,20);smsPasses++;
 // The questionnaire activation boundary still protects all existing channels.
 const page=randomUUID(),form=randomUUID(),submission=randomUUID(),template=randomUUID();
 await run(\`UPDATE auth.users SET email_confirmed_at=now() WHERE id=\${quote(user)};INSERT INTO site_form_submissions(id,page_id,profile_id,status,metadata,created_at)VALUES(\${quote(submission)},\${quote(page)},\${quote(profile)},'processed',\${json({questionnaire_first:'true',user_id:user,block_id:form})},'2026-01-02T00:00:00Z');INSERT INTO broadcast_templates(id,channel,channels,status,approval_status,trigger_kind,metadata)VALUES(\${quote(template)},'sms',ARRAY['sms'],'recurring','approved','site_form_event',\${json({site_form_condition:{event:'submitted',page_id:page,block_id:form,submissions_from:'2026-02-01T00:00:00Z'}})});\`);
 await run(service(\`SELECT public.queue_site_questionnaire_broadcasts(\${quote(submission)},NULL)\`));
 assert.equal((await run(\`SELECT count(*) FROM broadcast_automation_deliveries WHERE template_id=\${quote(template)}\`)).trim(),'0');
 await run(\`UPDATE broadcast_templates SET metadata=jsonb_set(metadata,'{site_form_condition,submissions_from}','"2026-01-01T00:00:00Z"')WHERE id=\${quote(template)}\`);
 await run(service(\`SELECT public.queue_site_questionnaire_broadcasts(\${quote(submission)},NULL);SELECT public.queue_site_questionnaire_broadcasts(\${quote(submission)},NULL)\`));
 assert.equal((await run(\`SELECT count(*) FROM broadcast_automation_deliveries WHERE template_id=\${quote(template)} AND channel='sms'\`)).trim(),'1');smsPasses++;
 // Existing guards are not forgeable by a staff Data API update.
 await assert.rejects(()=>run(asAdmin(\`UPDATE public.sms_messages SET status='queued',dispatch_key=NULL WHERE dispatch_id=\${quote(request)}\`)),/permission denied/);smsPasses++;
 // Production-size phone audience uses one bounded-count RPC and a set-based freeze.
 await run(\`INSERT INTO profiles(id,phone,full_name)SELECT md5('sms-scale-'||n)::uuid,'+9998'||lpad(n::text,8,'0'),'Synthetic scale contact' FROM generate_series(1,greatest(0,12100-(SELECT count(*)::int FROM profiles)))n\`);
 const scaledFunnel=randomUUID(),scaledBlock=randomUUID(),scaledLaunch=randomUUID();
 await call('telegram_funnel_save',[quote(scaledFunnel),'0',quote('SMS native scale'),quote(scaledBlock),json([{id:scaledBlock,channel:'sms',text:'Synthetic scale message',buttons:[]}]),quote('active')],true);
 const scaledAudience=result(await run(asAdmin(\`SET statement_timeout='8s';\${rpc('sms_funnel_audience',[json(everyone),'0','1'])}\`)));
 assert.ok(scaledAudience.available_count>=12000);
 const frozen=result(await run(asAdmin(\`SET statement_timeout='8s';\${rpc('telegram_funnel_begin_launch',[quote(scaledLaunch),quote(scaledFunnel),'1','NULL',json(everyone),'false','NULL'])}\`)));
 assert.equal(frozen.id,scaledLaunch);smsPasses++;
 console.log('SMS native freeze/collision/claim/unknown/phone-only/ACL: '+smsPasses+' PASS; Telegram forced races ran above with the new SMS migration');
}
`;
const child=spawn(process.execPath,['--input-type=module'],{env:process.env,stdio:['pipe','inherit','inherit']});
child.stdin.end(code);
await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',status=>status===0?resolve():reject(Error(`native fixture exit ${status}`)));});
