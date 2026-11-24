import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8'),scalar=async(s,a=[])=>(await db.query(s,a)).rows[0]?.v;
await db.exec(read('./fixtures/telegram-funnel-base.sql'));
await db.exec(`CREATE TABLE products_v2(id uuid PRIMARY KEY,name text); CREATE TABLE crm_pipelines(id uuid PRIMARY KEY,name text);CREATE TABLE crm_pipeline_stages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pipeline_id uuid,name text,stage_type text DEFAULT 'open',order_index int CHECK(order_index>=0),UNIQUE(pipeline_id,order_index));CREATE TABLE crm_pipeline_automation_rules(pipeline_id uuid,status text);ALTER TABLE orders_v2 ADD order_number text UNIQUE,ADD base_price numeric,ADD paid_amount numeric DEFAULT 0,ADD pipeline_id uuid,ADD pipeline_stage_id uuid,ADD campaign_key text,ADD creation_batch_id uuid;ALTER TABLE audit_logs ADD actor_type text,ADD created_at timestamptz DEFAULT now();`);
await db.exec(read('../../supabase/migrations/20261120100609_telegram_funnel_buttons.sql'));
await db.exec(read('../../supabase/migrations/20261121120000_telegram_funnel_finish_button.sql'));
await db.exec(read('../../supabase/migrations/20261124181000_telegram_funnel_crm_stages.sql'));
const pipeline='615be9f5-e621-4124-a996-35509915005f',product='e71c0dbb-baf2-4b6c-a950-bf0f728708af';
await db.query("INSERT INTO crm_pipelines VALUES($1,'Закрой год 2027');",[pipeline]);await db.query("INSERT INTO products_v2 VALUES($1,' ЗАКРОЙ ГОД 2027');",[product]);
const stages=[['c47ca858-add4-4f3c-b09c-471a77f0c1d9','Новая','open'],['1b5865a2-4cc0-4312-a895-87713e6425d8','В работе','open'],['a718bf28-f445-4555-89f2-9494a1f0aa08','Успешно','closed_won'],['b7e5ca02-37d3-42dd-a4ce-33cb79e52ed0','Отказ','closed_lost']];
for(const [n,[key,name,type]]of stages.entries())await db.query('INSERT INTO crm_pipeline_stages VALUES($1,$2,$3,$4,$5)',[key,pipeline,name,type,n]);
for(let n=0;n<256;n++){await db.query('INSERT INTO profiles(id)VALUES($1)',[id(1000+n)]);await db.query('INSERT INTO telegram_funnel_profile_tags(profile_id,tag,created_by)VALUES($1,$2,$3)',[id(1000+n),n<142?'ЦБ 2.0 + Закрой год':n<162?'ЦБ 1.0 + Закрой год':'ЦБ 2.0, без Закрой год',id(1)]);}
const funnelIds=['1edf4ce9-ad2f-40b9-8591-3bf540df7d15','84bf5843-9f96-4ee3-98b6-f29e3043ac50','54d7da56-1ed6-40ba-88af-a445d9ed8339','8ae9ee07-dddd-4816-a4cd-831217ce85b8'];
const graphs=[];
for(let n=0;n<4;n++){const graph=Array.from({length:n<2?9:1},(_,i)=>({id:id(100+n*20+i),text:n<2?`synthetic ${n} step ${i}`:`synthetic ${n-2} step 1`,buttons:n<2&&i===8?[{id:id(500+n),text:'Refuse',kind:'finish',tag:'ЗГ 2027 не участвую'}]:[]}));graphs.push(graph);await db.query('INSERT INTO telegram_funnels(id,name,status,revision,start_block_id,blocks,created_by)VALUES($1,$2,\'active\',$3,$4,$5,$6)',[funnelIds[n],'Synthetic', [9,14,3,2][n],graph[0].id,JSON.stringify(graph),id(1)]);}
await db.query("INSERT INTO orders_v2(id,profile_id,product_id,status,paid_amount,final_price)VALUES($1,$2,$3,'paid',890,890),($4,$5,$3,'partial',430,1290)",[id(6000),id(1000),product,id(6001),id(1200)]);
// Mismatched membership must roll the entire operation back, including stage edits.
await db.query('DELETE FROM telegram_funnel_profile_tags WHERE profile_id=$1',[id(1255)]);
await assert.rejects(db.exec(read('../../scripts/telegram-funnel-release/zg27-cohorts-once.sql')),/cohort_count_mismatch/);await db.exec('ROLLBACK');assert.equal(await scalar('SELECT count(*)::int v FROM crm_pipeline_stages'),4);
await db.query('INSERT INTO telegram_funnel_profile_tags(profile_id,tag,created_by)VALUES($1,$2,$3)',[id(1255),'ЦБ 2.0, без Закрой год',id(1)]);
await db.exec(read('../../scripts/telegram-funnel-release/zg27-cohorts-once.sql'));
assert.equal(await scalar("SELECT count(*)::int v FROM orders_v2 WHERE campaign_key='zg27-telegram-20261124'"),256);
assert.equal(await scalar('SELECT count(*)::int v FROM crm_pipeline_stages'),12);
assert.equal(await scalar("SELECT count(*)::int v FROM orders_v2 WHERE campaign_key='zg27-telegram-20261124' AND pipeline_stage_id=$1",[stages[2][0]]),2);
assert.equal(await scalar("SELECT count(*)::int v FROM orders_v2 WHERE campaign_key='zg27-telegram-20261124' AND status='paid'"),0);
assert.equal(await scalar("SELECT (block_stages->>$1)=$2::text v FROM telegram_funnel_crm_bindings WHERE funnel_id=$3",[graphs[2][0].id,(await db.query('SELECT id FROM crm_pipeline_stages WHERE pipeline_id=$1 AND order_index=2',[pipeline])).rows[0].id,funnelIds[2]]),true);
await db.exec(read('../../scripts/telegram-funnel-release/zg27-cohorts-once.sql'));assert.equal(await scalar('SELECT count(*)::int v FROM orders_v2'),258);
const profile=id(1001),stage=n=>scalar('SELECT id::text v FROM crm_pipeline_stages WHERE pipeline_id=$1 AND order_index=$2',[pipeline,n]);
const move=async n=>db.query('SELECT telegram_funnel_crm_move($1,$2,$3)',[profile,pipeline,await stage(n)]);
await move(3);await move(1);assert.equal(await scalar("SELECT pipeline_stage_id::text v FROM orders_v2 WHERE profile_id=$1 AND campaign_key IS NOT NULL",[profile]),await stage(3));
await move(10);await move(9);assert.equal(await scalar("SELECT pipeline_stage_id::text v FROM orders_v2 WHERE profile_id=$1 AND campaign_key IS NOT NULL",[profile]),await stage(10));
await db.query("INSERT INTO orders_v2(profile_id,product_id,status,paid_amount)VALUES($1,$2,'partial',100)",[profile,product]);assert.equal(await scalar("SELECT pipeline_stage_id::text v FROM orders_v2 WHERE profile_id=$1 AND campaign_key IS NOT NULL",[profile]),await stage(11));

// Confirmed event -> corresponding stage; unknown and self-tests never change a deal.
const eventProfile=id(1002),eventLaunch=id(7000),eventEn=id(7001),delivery=id(7002);
await db.query("INSERT INTO telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,created_by)VALUES($1,$2,$3,$4,'{}',$5)",[eventLaunch,funnelIds[0],id(3),JSON.stringify({blocks:graphs[0]}),id(1)]);
await db.query("INSERT INTO telegram_funnel_enrollments(id,launch_id,funnel_id,profile_id,bot_id,status)VALUES($1,$2,$3,$4,$5,'active')",[eventEn,eventLaunch,funnelIds[0],eventProfile,id(3)]);
await db.query("INSERT INTO telegram_funnel_deliveries(id,enrollment_id,transition_key,block_id,status)VALUES($1,$2,'synthetic',$3,'sent')",[delivery,eventEn,graphs[0][1].id]);
await db.query("INSERT INTO telegram_funnel_events(enrollment_id,delivery_id,event_key,kind)VALUES($1,$2,'synthetic-sent','sent')",[eventEn,delivery]);
assert.equal(await scalar("SELECT pipeline_stage_id::text v FROM orders_v2 WHERE profile_id=$1 AND campaign_key IS NOT NULL",[eventProfile]),await stage(2));
await db.query("INSERT INTO telegram_funnel_events(enrollment_id,event_key,kind,detail)VALUES($1,'synthetic-refused','finished',$2)",[eventEn,JSON.stringify({button_id:id(500)})]);
assert.equal(await scalar("SELECT pipeline_stage_id::text v FROM orders_v2 WHERE profile_id=$1 AND campaign_key IS NOT NULL",[eventProfile]),await stage(10));
await db.query("INSERT INTO orders_v2(id,profile_id,product_id,status)VALUES($1,$2,$3,'pending')",[id(7010),eventProfile,product]);
await db.query("INSERT INTO payments_v2(order_id,status,amount)VALUES($1,'succeeded',100)",[id(7010)]);
assert.equal(await scalar("SELECT pipeline_stage_id::text v FROM orders_v2 WHERE profile_id=$1 AND campaign_key IS NOT NULL",[eventProfile]),await stage(11));
await db.exec('SET ROLE authenticated');await assert.rejects(db.query('SELECT telegram_funnel_crm_move($1,$2,$3)',[profile,pipeline,stages[0][0]]),/permission denied/);await db.exec('RESET ROLE');
await db.close();console.log('PASS CRM: count-stop atomic rollback,162/94 import, paid+partial, stable stages, verified single-message2 mapping, replay no-op, forward priority and grants');
