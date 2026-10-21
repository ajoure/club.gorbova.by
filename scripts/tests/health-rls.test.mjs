import { test } from 'node:test';
import assert from 'node:assert/strict';
import {fixture,migration,asRole,visible,qi,id,users,tables,publicTables} from './health-rls-fixture.mjs';

test('reproduces wide reads and unsafe grants, applies all24 tables idempotently with zero row changes',async()=>{
  const db=await fixture();
  try {
    assert.equal((await visible(db,'products_v2',null,'anon')).length,4);
    assert.equal((await visible(db,'kb_questions',users.b)).length,2);
    assert.equal((await visible(db,'crm_pipelines',users.a)).length,2);
    assert.equal((await db.query("SELECT has_table_privilege('anon','public.tariffs','TRUNCATE') ok")).rows[0].ok,true);
    const counts=async()=>Promise.all(tables.map(async t=>(await db.query(`SELECT count(*) n FROM public.${qi(t)}`)).rows[0].n));
    const before=await counts();
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await counts(),before);
    for(const table of tables) for(const role of ['anon','authenticated']) for(const privilege of ['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) {
      assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) ok',[role,'public.'+table,privilege])).rows[0].ok,false,`${role}/${table}/${privilege}`);
    }
    for(const table of tables) for(const privilege of ['INSERT','UPDATE','DELETE']) assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) ok',['anon','public.'+table,privilege])).rows[0].ok,false);
    assert.equal((await db.query("SELECT count(*) n FROM pg_policies WHERE schemaname='public' AND qual='true' AND tablename=ANY($1)",[tables])).rows[0].n,0);
  } finally { await db.close(); }
});

test('anon catalog, published routing and privacy history work without privileged helper EXECUTE',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    for(const table of publicTables) assert.deepEqual(await visible(db,table,null,'anon'),[id(1)],table);
    for(const table of tables.filter(t=>!publicTables.includes(t))) await assert.rejects(visible(db,table,null,'anon'),e=>e.code==='42501',table);
    await assert.rejects(asRole(db,'anon',null,'SELECT metadata,created_by,workspace_id FROM public.site_domain_bindings'),e=>e.code==='42501');
    await assert.rejects(asRole(db,'anon',null,"SELECT public.has_admin_section_access(auth.uid(),'products','view')"),e=>e.code==='42501');
  } finally { await db.close(); }
});

test('clients keep own historical metadata, own roles, active menus/legal catalogs and entitled knowledge; no cross-client rows',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    for(const [u,own,other] of [[users.a,2,3],[users.b,3,2]]) {
      for(const table of ['products_v2','tariffs','tariff_features','module_access']) {
        const rows=await visible(db,table,u); assert(rows.includes(id(1)),table);assert(rows.includes(id(own)),table);assert(!rows.includes(id(other)),table);assert(!rows.includes(id(4)),table);
      }
      for(const table of ['roles','permissions','role_permissions']) assert.deepEqual(await visible(db,table,u),[id(u===users.a?1:2)],table);
      assert.deepEqual(await visible(db,'kb_questions',u),[id(u===users.a?1:2)]);
      assert.deepEqual(await visible(db,'flows',u),[id(own)]);
      for(const table of ['user_menu_sections','legal_details_positions_catalog','legal_details_roles_catalog','privacy_policy_versions','document_token_registry']) assert.deepEqual(await visible(db,table,u),[id(1)],table);
      for(const table of ['crm_pipelines','crm_pipeline_stages','crm_pipeline_product_bindings','fields','lesson_price_rules','admin_section','admin_resource']) assert.deepEqual(await visible(db,table,u),[],table);
    }
  } finally { await db.close(); }
});

test('staff section grants retain required reads, ungranted staff is blocked, owner/service keep allrows and RBAC bootstrap has no recursion',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    for(const table of ['crm_pipelines','crm_pipeline_stages','crm_pipeline_product_bindings','fields','lesson_price_rules']) {
      assert.equal((await visible(db,table,users.staff)).length,2,table);
      assert.equal((await visible(db,table,users.noGrant)).length,0,table);
    }
    for(const table of tables) {
      const n=(await db.query(`SELECT count(*) n FROM public.${qi(table)}`)).rows[0].n;
      assert.equal((await visible(db,table,users.owner)).length,n,'owner/'+table);
      assert.equal((await visible(db,table,null,'service_role')).length,n,'service/'+table);
    }
    assert.equal((await asRole(db,'authenticated',users.a,`SELECT ur.role_id,r.code FROM public.user_roles_v2 ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=auth.uid()`)).length,1);
  } finally { await db.close(); }
});

test('client writes are denied or affect zero rows on all24tables; staff media stays shared but cannot move outside telegram-media',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    for(const table of tables) {
      await assert.rejects(asRole(db,'authenticated',users.a,`INSERT INTO public.${qi(table)} DEFAULT VALUES`),e=>e.code==='42501',table);
      const col=table==='role_permissions'?'role_id':'id';
      for(const sql of [`UPDATE public.${qi(table)} SET ${col}=${col} RETURNING ${col}`,`DELETE FROM public.${qi(table)} RETURNING ${col}`]) {
        try {assert.deepEqual(await asRole(db,'authenticated',users.a,sql),[],table);} catch(e){assert.equal(e.code,'42501',table);}
      }
      await assert.rejects(asRole(db,'authenticated',users.a,`TRUNCATE public.${qi(table)}`),e=>e.code==='42501',table);
    }
    assert.deepEqual(await asRole(db,'authenticated',users.a,"UPDATE storage.objects SET name='shared/client' RETURNING id"),[]);
    const shared=await asRole(db,'authenticated',users.owner,"UPDATE storage.objects SET name='shared/changed-by-other-staff' WHERE bucket_id='telegram-media' RETURNING id");
    assert.equal(shared.length,1);
    await assert.rejects(asRole(db,'authenticated',users.owner,"UPDATE storage.objects SET bucket_id='other' WHERE bucket_id='telegram-media'"),e=>e.code==='42501');
    await assert.rejects(asRole(db,'authenticated',users.a,"INSERT INTO storage.objects(bucket_id,name) VALUES('telegram-media','client/fixture')"),e=>e.code==='42501');
  } finally { await db.close(); }
});

test('unexpected policy baseline stops before changing privileges',async()=>{
  const db=await fixture();
  try {
    await db.exec('CREATE POLICY unexpected_wide_read ON public.roles FOR SELECT TO authenticated USING(true)');
    await assert.rejects(db.exec(migration),/health_rls_policy_baseline_changed/);
    assert.equal((await db.query("SELECT has_table_privilege('anon','public.tariffs','TRUNCATE') ok")).rows[0].ok,true);
  } finally { await db.close(); }
});
