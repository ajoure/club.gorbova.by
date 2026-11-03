import { readFileSync } from 'node:fs';

const base = new URL('../../', import.meta.url);
export const migrationPath = 'supabase/migrations/20261103125859_crm_company_billing_contact_unlink.sql';
export const read = path => readFileSync(new URL(path, base), 'utf8');
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ids = { company: id(1), otherCompany: id(2), profile: id(11), otherProfile: id(12),
  actor: id(101), otherUser: id(102), cld: id(21), otherCld: id(22), map: id(31), otherMap: id(32),
  contact: id(41), otherContact: id(42) };

// Load production definitions, not reimplementations of the writer under test.
export function definition(file, name) {
  const source = read(`supabase/migrations/${file}`);
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw Error(`Missing definition ${name}`);
  const tail = source.slice(start);
  const tag = tail.match(/AS (\$[\w]*\$)/)[1];
  const begin = tail.indexOf(`AS ${tag}`) + 3 + tag.length;
  return tail.slice(0, tail.indexOf(`${tag};`, begin) + tag.length + 1);
}

const phase1 = '20260719162721_d83567e6-e8a4-4beb-8e97-3cfad083da9b.sql';
const phase2 = '20260719214544_9aa2edb0-c9dc-4636-a1b4-711accf867c5.sql';
const linker = '20260719231416_b9fa502e-0849-4336-9bab-b9414eddc501.sql';
const backfill = '20260719230948_1f3e25ec-612e-4540-b2df-a216ed784464.sql';
const upsert = '20260719235959_crm_company_billing_array_append_fix.sql';
const enqueue = '20260721110000_crm_company_sync_enqueue_concurrency.sql';
const trigger = '20260720070323_0c1bcc84-e47d-448a-b43d-72ea10d52ec9.sql';
const table = (file, name) => read(`supabase/migrations/${file}`).match(
  new RegExp(`CREATE TABLE public\.${name} \\([\\s\\S]*?\\n\\);`))[0];

export const protectedTables = ['profiles', 'client_legal_details', 'generated_documents',
  'corporate_draft_sessions', 'company_order_links', 'orders_v2', 'payments_v2',
  'subscriptions_v2', 'entitlements', 'consent_logs'];

export function fixtureSql() {
  const i = ids;
  let sql = `
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE TABLE fixture_roles(user_id uuid, role text);
    CREATE FUNCTION public.has_role_v2(_uid uuid, _role text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
      SELECT EXISTS (SELECT 1 FROM public.fixture_roles WHERE user_id = _uid AND role = _role) $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, user_id uuid);
    INSERT INTO public.profiles VALUES ('${i.profile}', '${i.actor}'), ('${i.otherProfile}', '${i.otherUser}');
    INSERT INTO fixture_roles VALUES ('${i.actor}', 'admin');
    ${table('20260108223929_57f04b68-7af4-4037-a437-2b85491a5b80.sql', 'client_legal_details')}
    ALTER TABLE public.client_legal_details ADD COLUMN purpose text NOT NULL DEFAULT 'billing';
    ALTER TABLE public.client_legal_details ADD COLUMN status text NOT NULL DEFAULT 'active';
    ${table(phase1, 'companies')}
    CREATE UNIQUE INDEX companies_unp_unique ON public.companies(country,unp_normalized) WHERE status <> 'merged';
    ${table(phase1, 'client_legal_details_company_map')}
    ${table(phase1, 'company_contacts')}
    ${read('supabase/migrations/20260724191931_78ff3059-9bb7-4681-956b-f8713279219f.sql')}
    ${table(phase1, 'company_sync_queue')}
    CREATE UNIQUE INDEX fixture_active_queue ON public.company_sync_queue(entity_id,run_reason) WHERE status IN ('queued','running');
    CREATE TABLE public.crm_activity_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_type text,
      source_entity_id uuid, source_entity_type text, user_id uuid NOT NULL, idempotency_key text UNIQUE, metadata jsonb);
    CREATE TABLE public.audit_logs(actor_user_id uuid, action text, actor_type text, entity_type text, entity_id text, meta jsonb);
    CREATE TABLE public.domain_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,source text,entity_id uuid,payload jsonb);
    ${definition(phase2, '_crm_company_emit_domain_event')}
    ${definition(phase2, '_crm_company_resolve_or_create_internal')}
    ${definition(phase2, 'crm_company_merge')}
    ${definition(linker, 'crm_company_link_contact')}
    ${definition(upsert, 'crm_company_upsert_from_billing')}
    ${definition(backfill, 'crm_company_backfill_billing_cld')}
    ${definition(enqueue, 'crm_enqueue_from_source_change')}
    ${definition(enqueue, 'crm_company_sync_enqueue')}
    ${definition(trigger, 'crm_client_legal_details_enqueue_trg')}
    ${read(`supabase/migrations/${trigger}`).match(/CREATE TRIGGER client_legal_details_enqueue_company_sync_trg[\s\S]*?;/)[0]}
    REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC,anon,service_role;
    GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated;
    REVOKE ALL ON FUNCTION public.crm_company_backfill_billing_cld(uuid),public.crm_company_upsert_from_billing(uuid) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.crm_company_backfill_billing_cld(uuid),public.crm_company_upsert_from_billing(uuid) TO service_role;
    INSERT INTO public.companies(id,public_id,full_name,short_name,unp_normalized,company_kind)
      VALUES ('${i.company}','CMP-FIXTURE-A','Fixture A','Fixture A','900000001','legal_entity'),
             ('${i.otherCompany}','CMP-FIXTURE-B','Fixture B','Fixture B','900000002','legal_entity');
    INSERT INTO public.client_legal_details(id,profile_id,client_type,leg_name,leg_unp,leg_address)
      VALUES ('${i.cld}','${i.profile}','legal_entity','Fixture A','900000001','Fixture address A'),
             ('${i.otherCld}','${i.profile}','legal_entity','Fixture B','900000002','Fixture address B');
    INSERT INTO public.client_legal_details_company_map(id,company_id,client_legal_details_id)
      VALUES ('${i.map}','${i.company}','${i.cld}'),('${i.otherMap}','${i.otherCompany}','${i.otherCld}');
    INSERT INTO public.company_contacts(id,company_id,profile_id,relationship_type,is_billing_contact,source,source_client_legal_details_map_id,is_primary,metadata)
      VALUES ('${i.contact}','${i.company}','${i.profile}','billing_contact',true,'billing_requisites','${i.map}',true,'{"fixture":"preserve"}'),
             ('${i.otherContact}','${i.otherCompany}','${i.profile}','billing_contact',true,'billing_requisites','${i.otherMap}',false,'{}');
  `;
  // The protected business tables are minimal sentinels, with real CLD FKs.
  // Production columns are not copied; every row and every write is checked.
  for (const [n, name] of protectedTables.slice(2).entries()) {
    sql += `CREATE TABLE public.${name}(id uuid PRIMARY KEY, profile_id uuid REFERENCES public.profiles(id),
      user_id uuid, client_legal_details_id uuid REFERENCES public.client_legal_details(id), payload jsonb);
      INSERT INTO public.${name} VALUES ('${id(500+n)}','${i.profile}','${i.actor}','${i.cld}','{"fixture":"unchanged","amount":123}');`;
  }
  sql += `CREATE FUNCTION public.fixture_forbid_business_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'unexpected business write: %', TG_TABLE_NAME; END $$;`;
  for (const name of protectedTables.slice(2)) {
    sql += `CREATE TRIGGER fixture_forbid_write BEFORE INSERT OR UPDATE OR DELETE ON public.${name}
      FOR EACH STATEMENT EXECUTE FUNCTION public.fixture_forbid_business_write();`;
  }
  return sql;
}

if (process.argv.includes('--emit-fixture')) process.stdout.write(fixtureSql());
