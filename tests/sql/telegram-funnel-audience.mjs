import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync,spawn} from 'node:child_process';
const native=process.env.TELEGRAM_FUNNEL_AUDIENCE_NATIVE==='1';
if(native){assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));assert.equal(process.env.PGDATABASE,'telegram_funnel_audience_native_test');assert.ok(Number(process.env.PGPORT)>0)}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const j=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
let fixture=await readFile('tests/sql/fixtures/telegram-funnel-base.sql','utf8');
fixture=fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;',()=>"DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon')THEN CREATE ROLE anon;END IF;IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated')THEN CREATE ROLE authenticated;END IF;IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role')THEN CREATE ROLE service_role BYPASSRLS;END IF;END$$;");
const original=await readFile('supabase/migrations/20261120100609_telegram_funnel_buttons.sql','utf8');
const migration=await readFile('supabase/migrations/20261120135114_telegram_funnel_bulk_audience.sql','utf8');
const tag=(value,negate=false)=>({id:'tag',kind:'tag',tag:value,negate});
const product=(relation='purchased',negate=false,p=id(101),tariff)=>({id:'product',kind:'product',relation,product_id:p,negate,...(tariff?{tariff_ids:[tariff]}:{})});
const field=(name,operator,value)=>({id:'field',kind:'field',field:name,operator,...(value===undefined?{}:{value})});
const segment=root=>({version:1,root});
const group=(op,leaves)=>({id:'group',op,args:leaves.map((x,i)=>({...x,id:'leaf'+i}))});
const cases=[tag('reviewed'),tag('none'),tag('none',true),tag('reviewed',true),field('status','is_not_set'),field('city','is_not_set'),field('city','eq',''),field('city','neq','Minsk'),field('country','eq','BY'),field('marketing_consent','eq',true),field('was_club_member','is_set')];
for(const relation of ['purchased','attended','active_access'])for(const negate of [false,true])for(const p of [id(101),id(102),id(103)])cases.push(product(relation,negate,p));
cases.push(product('purchased',false,id(101),id(104)),product('attended',false,id(101),id(104)));
for(const kind of ['year','cohort'])for(const negate of [false,true])for(const val of [2024,2025])cases.push({id:'history',kind,product_id:id(101),negate,...(kind==='year'?{year:val}:{flow_id:id(val===2024?105:106)})});
cases.push(group('and',[tag('reviewed'),product('attended')]),group('or',[tag('reviewed'),product('purchased',true),field('city','is_not_set')]),{id:'nested',op:'and',args:[{...group('or',[product('purchased'),tag('reviewed')]),id:'inner'}, {...field('country','eq','BY'),id:'country'}]});
const segments=cases.map(segment);
let seed=`INSERT INTO flows VALUES('${id(105)}','2024-09-01'),('${id(106)}','2025-09-01');\n`;
for(let n=10;n<34;n++){
 const pid=id(1000+n),uid=n%4===0?null:id(2000+n),oid=id(3000+n),mode=n%8;
 if(uid)seed+=`INSERT INTO auth.users VALUES('${uid}');\n`;
 seed+=`INSERT INTO profiles(id,user_id,telegram_user_id,telegram_link_bot_id,status,country,city,marketing_consent,was_club_member)VALUES('${pid}',${uid?`'${uid}'`:'NULL'},${1000+n},${n%2===0?`'${id(3)}'`:'NULL'},${n%7===0?'NULL':"'active'"},'BY',${n%3===0?'NULL':n%3===1?"''":"'Minsk'"},${n%2===0},${n%3===0});\n`;
 if(n%3===0)seed+=`INSERT INTO telegram_messages(bot_id,telegram_user_id,transport,direction,status)VALUES('${id(3)}',${1000+n},'bot','incoming','received');\n`;
 const meta=mode===4?{historical_purchase_type:'module_only_standalone'}:mode===5?{import_source:'patch4',gc_deal_id:'SYNTHETIC-'+n}:mode===6?{history_only:true,owner_confirmed_paid:true,historical_batch_id:'synthetic',historical_idempotency_key:'row-'+n,source_refs:['synthetic']}:mode===7?{prior_purchase_verification:'rejected'}:{};
 seed+=`INSERT INTO orders_v2(id,profile_id,user_id,product_id,tariff_id,flow_id,status,final_price,currency,is_trial,meta,purchase_snapshot,reconcile_source,deal_date)VALUES('${oid}',${uid&&n%3===0?'NULL':`'${pid}'`},${uid?`'${uid}'`:'NULL'},'${id(101)}','${id(104)}',${n%3===0?'NULL':`'${id(105)}'`},'${mode===1?'partial':'paid'}',${mode>=5?0:250},'BYN',${mode===3},${j(meta)},${j(mode===6?{historical_purchase_type:'base_tariff_purchase'}:{})},${mode===6?"'owner_confirmed_historical'":'NULL'},${mode===5?"'2024-09-01'":'NULL'});\n`;
 seed+=`INSERT INTO payments_v2(order_id,status,amount,currency,transaction_type,refunded_amount)VALUES('${oid}','succeeded',${mode===1?249:250},'BYN','payment',${mode===2?1:0});\n`;
 seed+=`INSERT INTO subscriptions_v2(profile_id,user_id,product_id,tariff_id,flow_id,order_id,status,access_start_at,access_end_at)VALUES('${pid}',${uid?`'${uid}'`:'NULL'},'${id(101)}','${id(104)}',${n%3===0?'NULL':`'${id(105)}'`},'${oid}','${n%2?'active':'expired'}','2024-01-01','${n%2?'2100-01-01':'2025-01-01'}');\n`;
 // Parent order may have a different product. It is still the canonical enrollment parent.
 seed+=`INSERT INTO entitlements(profile_id,user_id,product_id,order_id,status)VALUES('${pid}',${uid?`'${uid}'`:'NULL'},'${id(102)}','${oid}','expired');\n`;
 const proof=id(4000+n);seed+=`INSERT INTO orders_v2(id,profile_id,product_id,status,final_price,currency)VALUES('${proof}','${pid}','${id(103)}','paid',100,'BYN');INSERT INTO payments_v2(order_id,status,amount,currency,refunded_amount)VALUES('${proof}','succeeded',100,'${n%3===0?'RUB':'BYN'}',${n%5===0?1:0});\n`;
 seed+=`INSERT INTO entitlements(profile_id,product_id,status,meta)VALUES('${pid}','${id(103)}','expired',${j({granted_by:'rule_engine_product_access',historical_purchase_type:'base_tariff_purchase',...(n%4?{prior_purchase_order_id:proof}:{})})});\n`;
 if(n%2===0)seed+=`INSERT INTO telegram_funnel_profile_tags(profile_id,tag,created_by)VALUES('${pid}','reviewed','${id(1)}');\n`;
}
seed+=`UPDATE profiles SET is_archived=true WHERE id='${id(1032)}';UPDATE profiles SET merged_to_profile_id='${id(1010)}' WHERE id='${id(1033)}';\n`;
const fingerprint=`SELECT md5(string_agg(tab||payload,'|' ORDER BY tab,payload))v FROM(SELECT 'profiles'tab,to_jsonb(t)::text payload FROM profiles t UNION ALL SELECT 'orders',to_jsonb(t)::text FROM orders_v2 t UNION ALL SELECT 'payments',to_jsonb(t)::text FROM payments_v2 t UNION ALL SELECT 'entitlements',to_jsonb(t)::text FROM entitlements t UNION ALL SELECT 'subscriptions',to_jsonb(t)::text FROM subscriptions_v2 t)rows`;
const equivalence=`CREATE TEMP TABLE frozen_financial AS ${fingerprint};
CREATE TEMP TABLE frozen_rpc_acl AS SELECT oid,proacl FROM pg_proc WHERE oid IN('public.telegram_funnel_audience_service(jsonb,uuid,integer,integer)'::regprocedure,'public.telegram_funnel_prepare_audience(uuid)'::regprocedure);
${migration}
${migration}
DO $check$DECLARE s jsonb;expected uuid[];actual uuid[];page jsonb;dialogs bigint;BEGIN
 FOR s IN SELECT value FROM jsonb_array_elements(${j(segments)}) LOOP
  SELECT coalesce(array_agg(pr.id ORDER BY pr.id),'{}')INTO expected FROM profiles pr WHERE pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL AND public.telegram_funnel_segment_matches(pr.id,s->'root');
  SELECT coalesce(array_agg(m ORDER BY m),'{}')INTO actual FROM private.telegram_funnel_matching_profiles(s)m;
  ASSERT actual=expected,'bulk/reference complete profile sets differ: '||s::text;
  page:=public.telegram_funnel_audience_service(s,'${id(3)}',0,200);
  ASSERT (page->>'total')::int=cardinality(expected),'count mismatch';
  SELECT count(*)INTO dialogs FROM unnest(expected)e WHERE public.telegram_funnel_known_dialog(e,'${id(3)}');ASSERT(page->>'available_count')::int=dialogs,'dialog mismatch';
  ASSERT coalesce((SELECT array_agg((x->>'profile_id')::uuid ORDER BY x->>'profile_id')FROM jsonb_array_elements(page->'recipients')x),'{}')=expected,'page mismatch';
  ASSERT NOT EXISTS(SELECT FROM jsonb_array_elements(page->'recipients')x WHERE(x->>'has_dialog')::boolean IS DISTINCT FROM public.telegram_funnel_known_dialog((x->>'profile_id')::uuid,'${id(3)}')),'recipient dialog mismatch';
 END LOOP;
 ASSERT (SELECT v FROM frozen_financial)=(${fingerprint}),'financial/profile rows changed';
 ASSERT NOT EXISTS(SELECT FROM frozen_rpc_acl old JOIN pg_proc now ON now.oid=old.oid WHERE old.proacl IS DISTINCT FROM now.proacl),'existing public ACL changed';
 ASSERT NOT has_function_privilege('authenticated','private.telegram_funnel_bulk_facts(jsonb)','execute'),'helper exposed';
 ASSERT NOT has_function_privilege('service_role','private.telegram_funnel_matching_profiles(jsonb)','execute'),'helper exposed';
END $check$;
SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id(1)}',false);
DO $acl$BEGIN PERFORM public.telegram_funnel_audience(${j(segment(tag('none')))},'${id(3)}',0,1);END$acl$;RESET ROLE;
`;
async function execute(sql){if(native){const p=spawnSync(process.env.PSQL_BIN||'psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:4*1024*1024});if(p.status!==0)throw Error(p.stderr);return p.stdout}const{PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');const db=new PGlite();try{await db.exec(sql);return'PGlite equivalence completed'}catch(e){throw Error(e.message+' '+(e.where||''))}finally{await db.close()}}

// Scale runs only in the explicitly opted-in disposable native PostgreSQL database.
// Expected facts describe the synthetic fixture, not a second financial query implementation.
let scale='';
if(native || process.env.TELEGRAM_FUNNEL_AUDIENCE_PGLITE_SCALE==='1'){
 scale=`
 SET statement_timeout='120s';
 CREATE TEMP TABLE expected_facts AS SELECT pr.id profile_id,public.telegram_funnel_profile_facts(pr.id)facts,public.telegram_funnel_known_dialog(pr.id,'${id(3)}')has_dialog FROM profiles pr WHERE pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL;
 CREATE TEMP TABLE scale_people AS SELECT n,md5('scale-profile-'||n)::uuid pid,CASE WHEN n%3<>0 THEN md5('scale-user-'||n)::uuid END uid FROM generate_series(1,12077)n;
 INSERT INTO auth.users SELECT uid FROM scale_people WHERE uid IS NOT NULL;
 INSERT INTO profiles(id,user_id,telegram_user_id,telegram_link_bot_id,status,country,city,marketing_consent,was_club_member)
 SELECT pid,uid,100000+n,CASE WHEN n%2=0 THEN '${id(3)}'::uuid END,CASE WHEN n%11<>0 THEN 'active' END,'BY',CASE n%3 WHEN 0 THEN NULL WHEN 1 THEN '' ELSE 'Minsk' END,n%2=0,n%3=0 FROM scale_people;
 INSERT INTO orders_v2(id,profile_id,user_id,product_id,tariff_id,flow_id,status,final_price,currency)
 SELECT md5('scale-order-'||n||'-'||i)::uuid,CASE WHEN uid IS NOT NULL AND n%2=0 THEN NULL ELSE pid END,uid,CASE i%3 WHEN 0 THEN '${id(101)}'::uuid WHEN 1 THEN '${id(102)}'::uuid ELSE '${id(103)}'::uuid END,'${id(104)}',CASE WHEN n%7<>0 THEN '${id(105)}'::uuid END,'paid',250,'BYN' FROM scale_people CROSS JOIN generate_series(1,9)i;
 INSERT INTO payments_v2(order_id,status,amount,currency,transaction_type)
 SELECT md5('scale-order-'||n||'-'||i)::uuid,'succeeded',125,'BYN','payment' FROM scale_people CROSS JOIN generate_series(1,9)i CROSS JOIN generate_series(1,2)receipt;
 INSERT INTO subscriptions_v2(profile_id,user_id,product_id,tariff_id,order_id,status,access_start_at,access_end_at)
 SELECT pid,uid,'${id(101)}','${id(104)}',md5('scale-order-'||n||'-1')::uuid,CASE WHEN n%3=0 THEN 'active' ELSE 'expired' END,'2024-01-01',CASE WHEN n%3=0 THEN '2100-01-01'::timestamptz ELSE '2025-01-01'::timestamptz END FROM scale_people;
 INSERT INTO entitlements(profile_id,user_id,product_id,status)SELECT pid,uid,'${id(102)}','expired' FROM scale_people;
 INSERT INTO entitlements(profile_id,user_id,product_id,status,expires_at)SELECT pid,uid,'${id(103)}','active','2100-01-01' FROM scale_people WHERE n%2=0;
 INSERT INTO telegram_funnel_profile_tags(profile_id,tag,created_by)SELECT pid,'reviewed','${id(1)}' FROM scale_people WHERE n%5=0;
 INSERT INTO telegram_messages(bot_id,telegram_user_id,transport,direction,status)SELECT '${id(3)}',100000+n,'bot','incoming','received' FROM scale_people WHERE n%3=0;
 -- Additional messages exercise set-based dialog resolution independently of matching counts.
 INSERT INTO telegram_messages(bot_id,telegram_user_id,transport,direction,status)SELECT '${id(999)}',100000+n,'business','outgoing','sent' FROM scale_people CROSS JOIN generate_series(1,2)i;
 INSERT INTO expected_facts SELECT pid,jsonb_build_object(
 'purchases',${j([101,102,103].map(p=>({product_id:id(p),tariff_id:id(104)})))},
 'participations',jsonb_build_array(jsonb_build_object('product_id','${id(101)}','tariff_id','${id(104)}','flow_id',CASE WHEN n%7<>0 THEN '${id(105)}' END,'year',CASE WHEN n%7<>0 THEN 2024 END),jsonb_build_object('product_id','${id(102)}','tariff_id',NULL,'flow_id',NULL,'year',NULL))||CASE WHEN n%2=0 THEN jsonb_build_array(jsonb_build_object('product_id','${id(103)}','tariff_id',NULL,'flow_id',NULL,'year',NULL)) ELSE '[]'::jsonb END,
 'active_access',CASE WHEN n%3=0 THEN ${j([{product_id:id(101),tariff_id:id(104)}])} ELSE '[]'::jsonb END||CASE WHEN n%2=0 THEN ${j([{product_id:id(103),tariff_id:null}])} ELSE '[]'::jsonb END,
 'tags',CASE WHEN n%5=0 THEN '["reviewed"]'::jsonb ELSE '[]'::jsonb END,
 'fields',jsonb_build_object('country','BY','city',CASE n%3 WHEN 0 THEN NULL WHEN 1 THEN '' ELSE 'Minsk' END,'source',NULL,'status',CASE WHEN n%11<>0 THEN 'active' END,'marketing_consent',n%2=0,'was_club_member',n%3=0)),n%2=0 OR n%3=0 FROM scale_people;
 -- Mirror existing production ownership/join indexes, without changing PostgreSQL limits.
 CREATE INDEX fixture_orders_profile ON orders_v2(profile_id);CREATE INDEX fixture_orders_user ON orders_v2(user_id);CREATE INDEX fixture_payments_order ON payments_v2(order_id);
 CREATE INDEX fixture_entitlements_profile ON entitlements(profile_id);CREATE INDEX fixture_entitlements_user ON entitlements(user_id);CREATE INDEX fixture_entitlements_product ON entitlements(product_id);
 CREATE INDEX fixture_subscriptions_profile ON subscriptions_v2(profile_id);CREATE INDEX fixture_subscriptions_user ON subscriptions_v2(user_id);
 CREATE INDEX fixture_profiles_user ON profiles(user_id);CREATE INDEX fixture_messages_tg ON telegram_messages(telegram_user_id);
 ANALYZE;DO $size$BEGIN ASSERT(SELECT count(*)FROM profiles)=12102,'scale fixture must include12100profiles';ASSERT(SELECT count(*)FROM orders_v2)>100000,'dense order fixture required';ASSERT(SELECT count(*)FROM payments_v2)>200000,'dense receipt fixture required';END$size$;
 CREATE TEMP TABLE scale_fingerprint AS ${fingerprint};
 CREATE FUNCTION public.audience_fixture_assert_case(s jsonb,case_number integer)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $case$
 DECLARE expected uuid[];actual uuid[];page jsonb;expected_dialogs integer;started timestamptz:=clock_timestamp();BEGIN
 ASSERT current_setting('statement_timeout')='8s','real 8s budget required';
 SELECT coalesce(array_agg(e.profile_id ORDER BY e.profile_id),'{}'),count(*)FILTER(WHERE e.has_dialog) INTO expected,expected_dialogs FROM pg_temp.expected_facts e WHERE public.telegram_funnel_segment_evaluate(s->'root',e.facts);
 SELECT coalesce(array_agg(m ORDER BY m),'{}')INTO actual FROM private.telegram_funnel_matching_profiles(s)m;
 ASSERT actual=expected,'scale complete profile sets differ: '||case_number;
 page:=public.telegram_funnel_audience(s,'${id(3)}',0,200);
 ASSERT(page->>'total')::int=cardinality(expected),'scale count mismatch';ASSERT(page->>'available_count')::int=expected_dialogs,'scale dialog mismatch';
 RETURN jsonb_build_object('case',case_number,'matched',cardinality(expected),'elapsed_ms',round(extract(epoch FROM clock_timestamp()-started)*1000));END $case$;
 SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id(1)}',false);SET statement_timeout='8s';
 `;
 segments.forEach((s,i)=>scale+=`SELECT public.audience_fixture_assert_case(${j(s)},${i+1});\n`);
 scale+=`RESET ROLE;SET statement_timeout='120s';DO $immutable$BEGIN ASSERT(SELECT v FROM scale_fingerprint)=(${fingerprint}),'scale financial/profile rows changed';END$immutable$;\n`;
 scale+=`
 -- Two archived/merged negative fixtures are excluded: exactly12100 canonical recipients.
 UPDATE profiles SET telegram_link_bot_id='${id(3)}',telegram_link_status='active';
 CREATE TEMP TABLE freeze_fingerprint AS ${fingerprint};
 CREATE FUNCTION public.audience_fixture_assert_freeze(phase text,launch_uuid uuid,restart_flag boolean,scheduled timestamptz)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $freeze$
 DECLARE started timestamptz:=clock_timestamp();selected integer;f public.telegram_funnel_launches;BEGIN
 ASSERT current_setting('statement_timeout')='8s','real 8s freeze budget required';
 ASSERT auth.uid()='${id(1)}'::uuid,'staff fixture context required';
 f:=public.telegram_funnel_begin_launch(launch_uuid,'${id(6000)}',1,'${id(3)}',${j(segment(tag('fixture-no-tag',true)))},restart_flag,scheduled);
 SELECT count(*)INTO selected FROM public.telegram_funnel_enrollments WHERE launch_id=launch_uuid;
 ASSERT selected=12100,'full12100 recipient freeze required';
 ASSERT(SELECT count(*)FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments e ON e.id=d.enrollment_id WHERE e.launch_id=launch_uuid)=12100,'every recipient needs one start';
 ASSERT f.prepared_at IS NOT NULL,'prepare must commit with launch';
 ASSERT(SELECT count(*)FROM pg_catalog.pg_locks WHERE pid=pg_catalog.pg_backend_pid()AND locktype='advisory')<=1,'unbounded advisory locks';
 IF phase='scheduled_restart' THEN
 ASSERT(SELECT count(*)FROM public.telegram_funnel_enrollments WHERE launch_id='${id(6003)}'AND status='active')=12100,'future restart stopped current recipients';
 ASSERT(SELECT count(*)FROM public.telegram_funnel_enrollments WHERE launch_id=launch_uuid AND status='scheduled')=12100,'future recipients not pending';
 ELSE ASSERT(SELECT count(*)FROM public.telegram_funnel_enrollments WHERE launch_id=launch_uuid AND status='active')=12100,'current launch not active';END IF;
 RETURN jsonb_build_object('freeze_phase',phase,'recipients',selected,'elapsed_ms',round(extract(epoch FROM clock_timestamp()-started)*1000));END $freeze$;
 SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id(1)}',false);SET statement_timeout='8s';
 SELECT public.telegram_funnel_save('${id(6000)}',0,'Synthetic full audience','${id(6001)}',${j([{id:id(6001),text:'Synthetic terminal',buttons:[]}])},'active');
 SELECT public.audience_fixture_assert_freeze('initial','${id(6002)}',false,NULL);
 SELECT public.audience_fixture_assert_freeze('same_intent_replay','${id(6002)}',false,NULL);
 SELECT public.audience_fixture_assert_freeze('immediate_restart','${id(6003)}',true,NULL);
 SELECT public.audience_fixture_assert_freeze('scheduled_restart','${id(6004)}',true,'2100-01-01');
 RESET ROLE;SET statement_timeout='120s';DO $immutable$BEGIN ASSERT(SELECT v FROM freeze_fingerprint)=(${fingerprint}),'freeze changed financial/profile rows';END$immutable$;
 `;

}

const sql=fixture+'\n'+original+'\n'+seed+'\n'+equivalence+'\n'+scale;
const output=await execute(sql);if(native)console.log(output);

async function nativeStopActivationRace(){
 const run=text=>{const p=spawnSync(process.env.PSQL_BIN||'psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});if(p.status!==0)throw Error(p.stderr);return p.stdout};
 const staff=`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id(1)}',false);SET statement_timeout='8s';`;
 const graph=[{id:id(7001),text:'Synthetic race',buttons:[]}],filter=segment(tag('race-only'));
 run(`INSERT INTO telegram_funnel_profile_tags(profile_id,tag,created_by)VALUES('${id(4)}','race-only','${id(1)}');${staff}SELECT public.telegram_funnel_save('${id(7000)}',0,'Race','${id(7001)}',${j(graph)},'active');SELECT public.telegram_funnel_begin_launch('${id(7002)}','${id(7000)}',1,'${id(3)}',${j(filter)},false,NULL);SELECT public.telegram_funnel_begin_launch('${id(7003)}','${id(7000)}',1,'${id(3)}',${j(filter)},true,'2100-01-01');RESET ROLE;UPDATE telegram_funnel_launches SET scheduled_for=now()-interval '1 second'WHERE id='${id(7003)}';`);
 function session(name,initial,end=false){const child=spawn(process.env.PSQL_BIN||'psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});let stdout='',stderr='',readyResolve;const ready=new Promise(r=>readyResolve=r);child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('FENCE_READY'))readyResolve()});child.stderr.on('data',b=>stderr+=b);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)))});done.catch(()=>{});if(end)child.stdin.end(initial);else child.stdin.write(initial);return{child,ready,done}}
 const a=session('audience-activation-fence',`BEGIN;SET ROLE service_role;SET statement_timeout='8s';SELECT id FROM telegram_funnel_launches WHERE id='${id(7003)}' FOR UPDATE;SELECT 'FENCE_READY';\n`);
 await Promise.race([a.ready,a.done.then(()=>{throw Error('activation fence exited early')})]);
 const b=session('audience-definition-stop',`BEGIN;${staff}SELECT public.telegram_funnel_save('${id(7000)}',1,'Race','${id(7001)}',${j(graph)},'stopped');COMMIT;`,true);
 let observed=false;
 try{for(let i=0;i<50;i++){if(run("SELECT count(*)FROM pg_stat_activity WHERE application_name='audience-definition-stop' AND wait_event_type='Lock'").trim()==='1'){observed=true;break}await new Promise(r=>setTimeout(r,50))}assert.ok(observed,'real second session must block on held launch before activation');
 a.child.stdin.end(`SELECT jsonb_build_object('activated',public.telegram_funnel_activate_due('${id(7003)}'));COMMIT;\n`);
 const [out]=await Promise.all([a.done,b.done]);assert.ok(out.includes('"activated": 1'),'exactly one due activation');
 assert.equal(run(`SELECT count(*)FROM telegram_funnel_enrollments WHERE funnel_id='${id(7000)}' AND status IN('active','scheduled')`).trim(),'0');
 console.log(JSON.stringify({native_stop_activation_race:'PASS',actual_two_sessions:true,lock_wait_observed:true}));
 }catch(e){if(!a.child.stdin.destroyed)a.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([a.done,b.done]);throw e}
}
if(native)await nativeStopActivationRace();

console.log(JSON.stringify({engine:native?'PostgreSQL':'PGlite',equivalence_cases:segments.length,scale_profiles:scale?12102:0,scale_recipients:scale?12100:0,financial_rows_unchanged:true,helpers_private:true}));
