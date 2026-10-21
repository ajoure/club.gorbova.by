import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL fixtures only. No hosted DB, contacts, messages or files.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/health-rls-baseline.json', import.meta.url)));
const migration = readFileSync(new URL('../../supabase/migrations/20261021084810_health_least_privilege.sql', import.meta.url), 'utf8');
const qi = s => '"' + s.replaceAll('"', '""') + '"';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = { a: id(101), b: id(102), staff: id(201), noGrant: id(202), owner: id(301) };
const tables = Object.keys(baseline.columns);
const publicTables = ['products_v2','tariffs','tariff_features','pricing_stages','privacy_policy_versions','site_domain_bindings'];

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA fixture;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    CREATE TYPE public.app_role AS ENUM ('admin','superadmin','student','guest');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
    CREATE TABLE public.user_roles_v2(user_id uuid,role_id uuid);
    CREATE TABLE public.orders_v2(id uuid,user_id uuid,product_id uuid,tariff_id uuid,status text);
    CREATE TABLE public.subscriptions_v2(id uuid,user_id uuid,product_id uuid,tariff_id uuid,flow_id uuid);
    CREATE TABLE public.entitlements(id uuid,user_id uuid,product_id uuid);
    CREATE TABLE public.site_pages(id uuid,status text);
    CREATE TABLE fixture.section_grants(user_id uuid,section text);
    CREATE TABLE fixture.lesson_grants(user_id uuid,lesson_id uuid);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text);`);
  for (const [table, columns] of Object.entries(baseline.columns)) {
    const defs = columns.map(column => {
      const [name, raw] = column.split(':');
      let type = raw.replace(/ NN$/, '');
      if (type === 'USER-DEFINED') type = 'text';
      if (type === 'ARRAY') type = 'text[]';
      return `${qi(name)} ${type}`;
    });
    await db.exec(`CREATE TABLE public.${qi(table)} (${defs.join(',')}); ALTER TABLE public.${qi(table)} ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON public.${qi(table)} TO anon,authenticated,service_role;`);
  }
  await db.exec(`REVOKE ALL ON public.kb_questions FROM anon,authenticated; GRANT SELECT ON public.kb_questions TO authenticated;
    REVOKE SELECT ON public.site_domain_bindings FROM anon;
    GRANT ALL ON storage.objects TO anon,authenticated,service_role;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.user_roles_v2,public.orders_v2,public.subscriptions_v2,public.entitlements,public.site_pages TO anon,authenticated,service_role;
    ALTER TABLE public.user_roles_v2 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.orders_v2 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.subscriptions_v2 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.site_pages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.has_role_v2(u uuid,r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM public.user_roles_v2 ur JOIN public.roles role_row ON role_row.id=ur.role_id WHERE ur.user_id=u AND role_row.code=r) $$;
    CREATE FUNCTION public.has_role(u uuid,r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT public.has_role_v2(u,CASE WHEN r='superadmin' THEN 'super_admin' ELSE r::text END) $$;
    CREATE FUNCTION public.has_any_role(u uuid,rs public.app_role[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM unnest(rs) r WHERE public.has_role(u,r)) $$;
    CREATE FUNCTION public.has_admin_section_access(u uuid,s text,l text DEFAULT 'view') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT public.has_role_v2(u,'super_admin') OR public.has_role_v2(u,'admin') OR (l='view' AND EXISTS(SELECT 1 FROM fixture.section_grants g WHERE g.user_id=u AND g.section=s)) $$;
    CREATE FUNCTION public.has_admin_resource_access(u uuid,s text,r text,l text DEFAULT 'view') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT public.has_admin_section_access(u,s,l) $$;
    CREATE FUNCTION public.has_permission(u uuid,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT public.has_role_v2(u,'super_admin') OR public.has_role_v2(u,'admin') $$;
    CREATE FUNCTION public.user_has_training_lesson_access(u uuid,l uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM fixture.lesson_grants g WHERE g.user_id=u AND g.lesson_id=l) $$;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated,service_role;
    GRANT EXECUTE ON FUNCTION public.user_has_training_lesson_access(uuid,uuid) TO anon;
    CREATE POLICY own_role ON public.user_roles_v2 FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_role_v2(auth.uid(),'super_admin'));
    CREATE POLICY own_order ON public.orders_v2 FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_role_v2(auth.uid(),'super_admin'));
    CREATE POLICY own_subscription ON public.subscriptions_v2 FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_role_v2(auth.uid(),'super_admin'));
    CREATE POLICY own_entitlement ON public.entitlements FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_role_v2(auth.uid(),'super_admin'));
    CREATE POLICY published_page ON public.site_pages FOR SELECT TO anon,authenticated USING(status='published');`);
  for (const p of baseline.policies) {
    const roles = p.roles.map(r => r === 'public' ? 'PUBLIC' : qi(r)).join(',');
    await db.exec(`CREATE POLICY ${qi(p.policyname)} ON ${qi(p.schema)}.${qi(p.table)} AS ${p.permissive} FOR ${p.cmd} TO ${roles}
      ${p.qual ? `USING (${p.qual})` : ''} ${p.with_check ? `WITH CHECK (${p.with_check})` : ''};`);
  }
  const insert = async (table, row) => {
    const names = Object.keys(row);
    await db.query(`INSERT INTO public.${qi(table)} (${names.map(qi).join(',')}) VALUES (${names.map((_,i)=>'$'+(i+1)).join(',')})`, Object.values(row));
  };
  for (const [i, code] of ['student_a','student_b','staff','no_grant','super_admin'].entries()) {
    await insert('roles',{id:id(i+1),code,name:code});
    await insert('permissions',{id:id(i+1),code:code+'.view'});
    await insert('role_permissions',{role_id:id(i+1),permission_id:id(i+1)});
  }
  for (const [i, u] of Object.values(users).entries()) await insert('user_roles_v2',{user_id:u,role_id:id(i+1)});
  for (const section of ['roles','communication','support','products','training','deals','payments','forms-hub','referrals','sites','contacts','integrations','documents','consents']) {
    await db.query('INSERT INTO fixture.section_grants VALUES($1,$2)',[users.staff,section]);
  }
  for (const n of [1,2,3,4]) {
    await insert('products_v2',{id:id(n),is_active:true,status:n===1?'active':'inactive',name:'product'+n});
    await insert('tariffs',{id:id(n),product_id:id(n===4?1:n),is_active:n===1||n===4,is_public:n!==4,name:'tariff'+n});
    await insert('tariff_features',{id:id(n),tariff_id:id(n),label:'feature'+n});
    await insert('pricing_stages',{id:id(n),product_id:id(n),is_active:true});
    await insert('module_access',{id:id(n),module_id:id(n),tariff_id:id(n)});
    await insert('flows',{id:id(n),product_id:id(n),is_active:true});
  }
  for (const [u,n] of [[users.a,2],[users.b,3]]) {
    await insert('orders_v2',{id:id(n),user_id:u,product_id:id(n),tariff_id:id(n),status:'paid'});
    await insert('subscriptions_v2',{id:id(n),user_id:u,product_id:id(n),tariff_id:id(n),flow_id:id(n)});
    await db.query('INSERT INTO fixture.lesson_grants VALUES($1,$2)',[u,id(n)]);
  }
  for (const n of [1,2]) {
    await insert('kb_questions',{id:id(n),lesson_id:id(n+1),title:'question'+n});
    await insert('lesson_price_rules',{id:id(n),lesson_id:id(n+1),tariff_id:id(n+1)});
    await insert('access_rules',{id:id(n),product_id:id(n===1?1:3),is_active:true});
    await insert('user_menu_sections',{id:id(n),is_active:n===1,key:'menu'+n});
    await insert('legal_details_positions_catalog',{id:id(n),is_active:n===1});
    await insert('legal_details_roles_catalog',{id:id(n),is_active:n===1});
    await insert('privacy_policy_versions',{id:id(n),effective_date:n===1?'2000-01-01':'2099-01-01'});
    await insert('document_token_registry',{id:id(n),archived_at:n===1?null:'2000-01-01'});
    await insert('fields',{id:id(n),is_active:true});
    await insert('admin_section',{id:id(n),code:n===1?'products':'ungranted',is_active:true});
    await insert('admin_resource',{id:id(n),section_id:id(n),code:'settings',is_active:true});
    await insert('site_pages',{id:id(n),status:n===1?'published':'draft'});
    await insert('site_domain_bindings',{id:id(n),site_page_id:id(n),domain:'fixture.test'});
    for (const table of ['crm_pipelines','crm_pipeline_stages','crm_pipeline_product_bindings']) await insert(table,{id:id(n)});
  }
  // Shared staff storage has SELECT/INSERT/DELETE policies in addition to the
  // live UPDATE baseline. They are intentionally untouched by this migration.
  await db.exec(`CREATE POLICY staff_storage_read ON storage.objects FOR SELECT TO authenticated USING(public.has_admin_section_access(auth.uid(),'communication','view'));
    CREATE POLICY staff_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='telegram-media' AND public.has_admin_section_access(auth.uid(),'communication','view'));
    INSERT INTO storage.objects(id,bucket_id,name) VALUES('${id(1)}','telegram-media','shared/fixture');`);
  return db;
}

async function asRole(db, role, uid, query, args=[]) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
  await db.exec(`SET ROLE ${qi(role)}`);
  try { return (await db.query(query,args)).rows; } finally { await db.exec('RESET ROLE'); }
}
const visible = async (db, table, user, role='authenticated') => {
  const col = table==='role_permissions'?'role_id':table==='site_domain_bindings'&&role==='anon'?'site_page_id':'id';
  return (await asRole(db,role,user,`SELECT ${col} value FROM public.${qi(table)} ORDER BY 1`)).map(r=>r.value);
};


export { fixture, baseline, migration, asRole, visible, qi, id, users, tables, publicTables };
