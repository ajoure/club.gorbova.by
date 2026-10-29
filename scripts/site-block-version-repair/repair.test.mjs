import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const pageId='859c9cf0-657f-4585-a645-e93e66d940ca';
const source=await readFile(new URL('repair-managed.sql',import.meta.url),'utf8');
const original=[
 {id:'b02410a0-2430-4f24-8a24-202610240001',type:'html',content:{code:'<p>Preserve content</p>'},metadata:{fixture:true}},
 {id:'f04721a0-2430-4f24-8a24-202610240001',type:'form',content:{redirectUrl:'/thx-web-2410',webinar_registration:true,fields:[{mapping:'email',required:true}]}}
];
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE site_pages(id uuid PRIMARY KEY,slug text,status text,product_id uuid,blocks jsonb,title text DEFAULT 'unchanged',updated_at timestamptz DEFAULT '2026-10-29T00:00:00Z');
 CREATE FUNCTION stamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END; $$;
 CREATE TRIGGER stamp BEFORE UPDATE ON site_pages FOR EACH ROW EXECUTE FUNCTION stamp();`);
 await db.query("INSERT INTO site_pages(id,slug,status,product_id,blocks) VALUES($1,'web-2410','published','c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740',$2),('00000000-0000-4000-8000-000000000001','unrelated','published',null,'[]')",[pageId,JSON.stringify(original)]);
 const hash=(await db.query('SELECT md5(blocks::text) h FROM site_pages WHERE id=$1',[pageId])).rows[0].h;
 const target=(await db.query("SELECT md5(jsonb_set(jsonb_set($1::jsonb,'{0,version}','1'),'{1,version}','1')::text) h",[JSON.stringify(original)])).rows[0].h;
 const dry=source.replace('99de30ea0a03f7aa7b6649e55372a8a2',target).replace(/v_expected_md5 text := '[^']+'/,'v_expected_md5 text := '+"'"+hash+"'");
 return {db,dry,apply:dry.replace('v_dry_run boolean := true','v_dry_run boolean := false'),snapshot:async()=> (await db.query('SELECT * FROM site_pages ORDER BY id')).rows};
}
test('dry-run writes nothing; apply repairs only version; repeat writes nothing',async()=>{
 const {db,dry,apply,snapshot}=await fixture();try{
 const before=await snapshot();await db.exec(dry);assert.deepEqual(await snapshot(),before);
 await db.exec(apply);const after=await snapshot();assert.deepEqual(after[0],before[0]);
 assert.deepEqual(after[1].blocks,original.map(b=>({...b,version:1})));
 const {blocks,updated_at,...unchanged}=after[1];const {blocks:oldBlocks,updated_at:oldTime,...expected}=before[1];
 assert.deepEqual(unchanged,expected);assert.notEqual(updated_at,oldTime);
 await db.exec(apply);assert.deepEqual(await snapshot(),after);
 }finally{await db.close();}
});
test('content, routing, order, existing/null/partial versions stop without mutations',async()=>{
 const {db,apply,snapshot}=await fixture();try{
 for(const blocks of [
  original.toReversed(),
  [{...original[0],content:{code:'changed'}},original[1]],
  original.map(b=>({...b,version:2})),
  [{...original[0],version:1},original[1]],
  original.map(b=>({...b,version:null})),[],{},null
 ]){
  await db.query('UPDATE site_pages SET blocks=$1 WHERE id=$2',[JSON.stringify(blocks),pageId]);const before=await snapshot();
  await assert.rejects(db.exec(apply),/site_version_/);assert.deepEqual(await snapshot(),before);
 }
 await db.query("UPDATE site_pages SET blocks=$1,status='draft' WHERE id=$2",[JSON.stringify(original),pageId]);
 await assert.rejects(db.exec(apply),/routing_or_shape_drift/);
 }finally{await db.close();}
});
test('unexpected trigger side effects roll back atomically',async()=>{
 const {db,apply,snapshot}=await fixture();try{
 await db.exec("CREATE OR REPLACE FUNCTION stamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.title='unexpected'; RETURN NEW; END; $$");
 const before=await snapshot();await assert.rejects(db.exec(apply),/readback_failed/);assert.deepEqual(await snapshot(),before);
 }finally{await db.close();}
});

test('production baseline reconstructs from GitHub; reviewed repair yields canonical versions',async()=>{
 const prior=await readFile(new URL('../webinars/web-2410/release-managed-apply.sql',import.meta.url),'utf8');
 const blocks=JSON.parse(prior.match(/v_blocks jsonb:='([\s\S]*?)'::jsonb;/)[1].replaceAll("''","'"));
 blocks[1].content.tariff_id='745e77aa-46b5-4838-b5a2-7b7b1c8bad76';
 blocks[0].content.code=await readFile(new URL('../webinars/web-2410-refinement/landing.html',import.meta.url),'utf8');
 const {db,snapshot}=await fixture();try{
 await db.query('UPDATE site_pages SET blocks=$1 WHERE id=$2',[JSON.stringify(blocks),pageId]);
 const before=await snapshot();await db.exec(source);assert.deepEqual(await snapshot(),before);
 const apply=await readFile(new URL('repair-managed-apply.sql',import.meta.url),'utf8');
 assert.equal(apply,source.replace('v_dry_run boolean := true','v_dry_run boolean := false'));
 await db.exec(apply);const actual=(await snapshot())[1].blocks;
 assert.deepEqual(actual,blocks.map(b=>({...b,version:1})));
 assert.equal(actual.some(b=>!b.id||!b.type||b.version===undefined),false);
 const rollback=await readFile(new URL('rollback-managed.sql',import.meta.url),'utf8');
 const repaired=await snapshot();await db.exec(rollback);assert.deepEqual(await snapshot(),repaired);
 await db.exec(rollback.replace('v_dry_run boolean := true','v_dry_run boolean := false'));
 assert.deepEqual((await snapshot())[1].blocks,blocks);
 const restored=await snapshot();await db.exec(rollback.replace('v_dry_run boolean := true','v_dry_run boolean := false'));assert.deepEqual(await snapshot(),restored);
 }finally{await db.close();}
});
