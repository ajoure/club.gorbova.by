import {test} from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
const{PGlite}=await import(process.env.HISTORICAL_PGLITE_MODULE||'@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=s=>createHash('sha256').update(s).digest('hex');
const root='7101ed3c-7839-4a74-ad95-aa0660369b22',mod='64d9f812-617c-41a8-b3dc-bb113156d6f3',second='ea98d043-e852-443f-8807-6e77de6a5e1f',tariff='543940b1-99da-47f3-accc-671ad5b11afe';
const sql=readFileSync(new URL('./inventory.sql',import.meta.url),'utf8');
async function fixture(){const db=new PGlite();await db.exec(`CREATE TABLE profiles(id uuid,user_id uuid,status text,is_archived boolean,merged_to_profile_id uuid,email text,phone text);
CREATE TABLE orders_v2(id uuid,profile_id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid,status text,is_deleted boolean,purchase_snapshot jsonb,reconcile_source text,is_trial boolean,meta jsonb);
CREATE TABLE payments_v2(order_id uuid,status text,currency text,amount numeric,refunded_amount numeric);
CREATE TABLE subscriptions_v2(id uuid,user_id uuid,product_id uuid,tariff_id uuid,order_id uuid,status text,is_trial boolean,access_start_at timestamptz,access_end_at timestamptz);
CREATE TABLE entitlements(user_id uuid,product_id uuid,status text);
`);return db}
const src=(ref,email,phone=null)=>({refs:[ref],cohort:18,email_sha256:hash(email),phone_sha256:phone?hash(phone):null,product_id:root,tariff_id:tariff,flow_id:null,module_product_ids:[mod,second],titles_source_only:['confirmed source']});
const run=async(db,source)=>(await db.query(sql.replace("/* SOURCE */ '[]'::jsonb",`'${JSON.stringify(source).replaceAll("'","''")}'::jsonb`))).rows[0].inventory;
async function profile(db,n,email,phone=null,merged=null,user=null){await db.query('INSERT INTO profiles VALUES($1,$2,$3,$4,$5,$6,$7)',[id(n),user?id(user):null,merged?'archived':'active',!!merged,merged?id(merged):null,email,phone])}
test('canonical aliases collapse to active owner; shared matching phone is not an unrelated identity conflict',async()=>{const db=await fixture();try{
 await profile(db,1,'person@example.test','123456789',null,10);await profile(db,2,'person@example.test','123456789',1);await profile(db,3,'other@example.test','123456789');
 const [r]=await run(db,[src('18:36','person@example.test','123456789')]);assert.equal(r.match_status,'matched_email');assert.equal(r.profile_id,id(1));assert.deepEqual(r.candidates_email,[id(1)]);assert.deepEqual(r.matched_alias_ids,[id(2)]);assert.equal(r.phone_points_to_other_profile,false);
 await db.query('UPDATE profiles SET phone=$1 WHERE id=$2',['999999999',id(1)]);await db.query('UPDATE profiles SET phone=NULL WHERE id=$1',[id(2)]);
 assert.equal((await run(db,[src('18:36','person@example.test','123456789')]))[0].phone_points_to_other_profile,true);
}finally{await db.close()}});
test('only paid nondeleted orders prove purchases; component facts remain separate from full course evidence',async()=>{const db=await fixture();try{
 await profile(db,1,'buyer@example.test',null,null,10);
 await db.query(`INSERT INTO orders_v2 VALUES($1,NULL,$2,$3,$4,NULL,'paid',false,$5,'old',false,'{}'),($6,$7,$2,$8,NULL,NULL,'paid',true,'{}','old',false,'{}')`,[id(20),id(10),root,tariff,JSON.stringify({historical_purchase_type:'module_child_purchase',module_list_mapped:[mod]}),id(21),id(1),second]);
 await db.query("INSERT INTO entitlements VALUES($1,$2,'active')",[id(10),second]);
 const[r]=await run(db,[src('18:2','buyer@example.test')]);assert.deepEqual(r.existing_module_coverage_db,[mod]);assert.deepEqual(r.missing_historical_fact,[second]);assert.equal(r.existing_paid_root_orders_db[0].hist_type,'module_child_purchase');assert.equal(r.existing_paid_root_orders_db[0].user_id,id(10));assert.equal(r.deleted_orders_db.length,1);
}finally{await db.close()}});
test('Business eligibility uses paid net 250 and the actual started finite window',async()=>{const db=await fixture();try{
 await profile(db,1,'club@example.test',null,null,10);
 await db.query(`INSERT INTO orders_v2 VALUES($1,$2,$3,'11c9f1b8-0355-4753-bd74-40b42aa53616','7c748940-dcad-4c7c-a92e-76a2344622d3',NULL,'paid',false,'{}',NULL,false,'{}');`,[id(20),id(1),id(10)]);
 await db.query(`INSERT INTO subscriptions_v2 VALUES($1,$2,'11c9f1b8-0355-4753-bd74-40b42aa53616','7c748940-dcad-4c7c-a92e-76a2344622d3',$3,'canceled',false,now()-interval '1 day',now()+interval '1 day')`,[id(30),id(10),id(20)]);
 await db.query("INSERT INTO payments_v2 VALUES($1,'succeeded','BYN',250,0)",[id(20)]);
 const eligible=async()=>(await run(db,[src('18:2','club@example.test')]))[0].club_business_subscriptions[0].verified_paid_250;
 assert.equal(await eligible(),true);await db.exec('UPDATE payments_v2 SET refunded_amount=1');assert.equal(await eligible(),false);await db.exec("UPDATE payments_v2 SET refunded_amount=0; UPDATE subscriptions_v2 SET access_start_at=now()+interval '1 hour'");assert.equal(await eligible(),false);
}finally{await db.close()}});
