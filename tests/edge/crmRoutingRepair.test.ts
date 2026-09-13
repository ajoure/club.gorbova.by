import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { repairStage } from '../../supabase/functions/_shared/crm-routing-repair';

const pipeline='a0000001-0000-0000-0000-000000000002';
const pending='b0000001-0002-0000-0000-000000000001';
const won='b0000001-0002-0000-0000-000000000003';
const lost='b0000001-0002-0000-0000-000000000004';
const product='aa11cb00-0000-4000-8000-000000000001';
const batch='00000000-0000-4000-8000-000000000001';
const snapshot={enabled:true,pipeline_id:pipeline,stage_on_pending:pending,stage_on_success:won,stage_on_failed:lost};
const setup=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE products_v2(id uuid PRIMARY KEY,name text);
INSERT INTO products_v2 VALUES('${product}','Ценный бухгалтер | 1 ступень 2.0 | Модуль: Посредничество'),
('2b7bf6d4-ad8d-46ad-9399-7f96c307c596','Ценный бухгалтер | 1 ступень 2.0 | 21 поток');
CREATE TABLE crm_pipelines(id uuid PRIMARY KEY,name text);
INSERT INTO crm_pipelines VALUES('${pipeline}','ЦБ | 1 ступень |');
CREATE TABLE crm_pipeline_stages(id uuid PRIMARY KEY,pipeline_id uuid,name text,stage_type text,order_index int,is_default boolean DEFAULT false);
INSERT INTO crm_pipeline_stages VALUES('${pending}','${pipeline}','Новая','open',0,false),('${won}','${pipeline}','Успешно','closed_won',5,false),('${lost}','${pipeline}','Отказ','closed_lost',6,false);
CREATE TABLE crm_pipeline_product_bindings(id uuid DEFAULT gen_random_uuid(),pipeline_id uuid,product_id uuid,metadata jsonb,UNIQUE(pipeline_id,product_id));
CREATE TABLE tariff_offers(id uuid,tariff_id uuid,is_active boolean,offer_type text,meta jsonb);
CREATE TABLE crm_pipeline_automation_rules(id uuid,status text);
CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,paid_amount numeric,product_id uuid,tariff_id uuid,offer_id uuid,
pipeline_id uuid,pipeline_stage_id uuid,meta jsonb,is_deleted boolean DEFAULT false);
CREATE TABLE audit_logs(actor_type text,action text,entity_type text,entity_id uuid,meta jsonb);`;

describe('reviewed routing repair',()=>{
 it('preserves open progress, routes actual paid money and reversals to configured terminal stages',()=>{
   const o:any={status:'pending',pipeline_id:pipeline,pipeline_stage_id:'in-progress',paid_amount:0};
   expect(repairStage(o,snapshot)).toBe('in-progress');
   expect(repairStage({...o,pipeline_id:'other'},snapshot)).toBe(pending);
   expect(repairStage({...o,status:'failed',paid_amount:10},snapshot)).toBe(won);
   expect(repairStage({...o,status:'refunded',paid_amount:250},snapshot)).toBe(lost);
 });
 it('applies exact batches once, blocks config/automation/money drift and supports rollback',async()=>{
   const db=new PGlite();
   try {
    await db.exec(setup);await db.exec(readFileSync('supabase/migrations/20260913123301_crm_routing_repair.sql','utf8'));
    expect((await db.query(`SELECT count(*)::int n FROM crm_pipeline_product_bindings`)).rows).toEqual([{n:2}]);
    expect((await db.query(`SELECT is_default FROM crm_pipeline_stages WHERE id=$1`,[pending])).rows).toEqual([{is_default:true}]);
    const id=(await db.query<{id:string}>(`INSERT INTO orders_v2(status,paid_amount,product_id,meta) VALUES('paid',250,$1,'{"source":"legacy"}') RETURNING id`,[product])).rows[0].id;
    const config=(await db.query<{r:string}>('SELECT crm_routing_config_fingerprint() r')).rows[0].r;
    const row=(await db.query<{row_fingerprint:string}>(`SELECT * FROM crm_routing_review_page()`)).rows[0];
    const candidates=[{order_id:id,row_fingerprint:row.row_fingerprint,snapshot,target_stage_id:won}];
    const apply=(fingerprint=config)=>db.query<{r:any}>(`SELECT crm_apply_reviewed_routes($1,$2,$3) r`,[batch,fingerprint,JSON.stringify(candidates)]);
    await expect(apply('wrong')).rejects.toThrow('routing_configuration_changed');
    await db.exec(`INSERT INTO crm_pipeline_automation_rules VALUES(gen_random_uuid(),'active')`);
    await expect(apply()).rejects.toThrow('routing_automation_requires_review');
    await db.exec('DELETE FROM crm_pipeline_automation_rules');
    expect((await apply()).rows[0].r).toEqual({repaired:1,already_applied:false});
    expect((await apply()).rows[0].r).toEqual({repaired:1,already_applied:true});
    expect((await db.query(`SELECT status,paid_amount::int money,pipeline_stage_id,meta->>'source' source FROM orders_v2`)).rows)
      .toEqual([{status:'paid',money:250,pipeline_stage_id:won,source:'legacy'}]);
    await db.exec(`UPDATE orders_v2 SET paid_amount=500`);
    await expect(db.query(`SELECT crm_restore_routing_batch($1)`,[batch])).rejects.toThrow('routing_restore_drift');
    await db.exec(`UPDATE orders_v2 SET paid_amount=250`);
    expect((await db.query<{n:number}>(`SELECT crm_restore_routing_batch($1) n`,[batch])).rows[0].n).toBe(1);
    expect((await db.query(`SELECT pipeline_id,meta FROM orders_v2`)).rows).toEqual([{pipeline_id:null,meta:{source:'legacy'}}]);
    await db.exec('SET ROLE authenticated');await expect(apply()).rejects.toMatchObject({code:'42501'});
   } finally {await db.close();}
 },20000);
});
