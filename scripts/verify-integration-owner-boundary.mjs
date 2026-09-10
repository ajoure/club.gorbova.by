// Runs the exact migration against an isolated PostgreSQL engine with synthetic
// rows and intentionally overbroad legacy policies. Never connects to production.
// node scripts/verify-integration-owner-boundary.mjs /path/to/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const targets = ['integration_instances', 'integration_credentials', 'payment_settings',
  'email_accounts', 'telegram_bots', 'integration_field_mappings',
  'integration_sync_settings', 'acquiring_connections', 'integrations'];
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
  CREATE TABLE public.test_roles(user_id uuid, role_code text, section_code text);
  CREATE FUNCTION public.has_role_v2(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
    'SELECT EXISTS(SELECT 1 FROM public.test_roles WHERE user_id=u AND role_code=r)';
  CREATE FUNCTION public.has_admin_section_access(u uuid, s text, l text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
    'SELECT EXISTS(SELECT 1 FROM public.test_roles WHERE user_id=u AND (role_code IN (''admin'',''super_admin'') OR section_code=s))';
  CREATE FUNCTION public.has_permission(u uuid, p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
    'SELECT public.has_admin_section_access(u,''payments'',''manage'')';
  INSERT INTO test_roles VALUES
    ('00000000-0000-0000-0000-000000000001','user',''),
    ('00000000-0000-0000-0000-000000000002','staff','payments'),
    ('00000000-0000-0000-0000-000000000003','staff','communication'),
    ('00000000-0000-0000-0000-000000000004','admin',''),
    ('00000000-0000-0000-0000-000000000005','super_admin','');
  CREATE TABLE integration_instances(id uuid DEFAULT gen_random_uuid(), alias text, category text,
    provider text, status text, is_default boolean, config jsonb, config_secrets jsonb);
  CREATE TABLE telegram_bots(id uuid DEFAULT gen_random_uuid(), bot_name text, bot_username text,
    bot_id bigint, status text, is_primary boolean, last_check_at timestamptz,
    error_message text, created_at timestamptz, updated_at timestamptz, bot_token_encrypted text);
  CREATE TABLE email_accounts(id uuid DEFAULT gen_random_uuid(), email text, display_name text,
    provider text, is_default boolean, is_active boolean, imap_enabled boolean,
    created_at timestamptz, smtp_password text);
  CREATE TABLE acquiring_connections(id uuid DEFAULT gen_random_uuid(), account_code text, account_name text,
    provider text, test_mode boolean, is_default boolean, status text, capabilities_snapshot jsonb);
  CREATE TABLE integration_credentials(id uuid DEFAULT gen_random_uuid(), secrets jsonb);
  CREATE TABLE payment_settings(id uuid DEFAULT gen_random_uuid(), value text);
  CREATE TABLE integration_field_mappings(id uuid DEFAULT gen_random_uuid());
  CREATE TABLE integration_sync_settings(id uuid DEFAULT gen_random_uuid());
  CREATE TABLE integrations(id uuid DEFAULT gen_random_uuid());
  CREATE TABLE telegram_clubs(id uuid DEFAULT gen_random_uuid());
  INSERT INTO integration_instances(alias,provider,category,config,config_secrets) VALUES
    ('Payments','bepaid','payments','{"shop_id":"synthetic-shop","secret_key":"FORBIDDEN_MARKER","fee_rules":{"card_by_percent":2.4,"fixed_per_txn":{"secret":"FORBIDDEN_MARKER"}}}','{"token":"FORBIDDEN_MARKER"}'),
    ('Mail','smtp','email','{"email":"sender@example.test","smtp_password":"FORBIDDEN_MARKER"}','{}'),
    ('Video','kinescope','other','{"api_token":"FORBIDDEN_MARKER"}','{}');
  INSERT INTO telegram_bots(bot_name,bot_token_encrypted,error_message) VALUES ('Bot','FORBIDDEN_MARKER','FORBIDDEN_MARKER');
  INSERT INTO email_accounts(email,smtp_password) VALUES ('sender@example.test','FORBIDDEN_MARKER');
  INSERT INTO acquiring_connections(account_code,capabilities_snapshot) VALUES ('synthetic','{"supported_currencies":["byn",{"secret":"FORBIDDEN_MARKER"}],"secret":"FORBIDDEN_MARKER"}');
`);
for (const table of [...targets, 'telegram_clubs']) {
  await db.exec(`
    INSERT INTO public.${table} DEFAULT VALUES;
    ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_overbroad ON public.${table} FOR ALL USING (true) WITH CHECK (true);
    GRANT ALL ON public.${table} TO anon, authenticated, service_role;
  `);
}
const migration = readFileSync(new URL('../supabase/migrations/20260910181807_integration_owner_boundary.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // Repeat must be safe, no duplicate policies/functions.
let assertions = 0;
const equal = (a, b, message) => { assert.deepEqual(a, b, message); assertions++; };
const denied = async sql => {
  await assert.rejects(db.query(sql), e => e.code === '42501'); assertions++;
};
async function actor(n, role = 'authenticated') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [n ? `00000000-0000-0000-0000-${String(n).padStart(12,'0')}` : '']);
  await db.exec(`SET ROLE ${role}`);
}
const projections = ['telegram_bots','email_accounts','integrations','acquiring_connections'];
for (const n of [1,2,3,4]) {
  await actor(n);
  for (const table of targets) {
    equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0, `${n} cannot read ${table}`);
    await denied(`INSERT INTO ${table} DEFAULT VALUES`);
    equal((await db.query(`UPDATE ${table} SET id=id RETURNING id`)).rows.length, 0);
    equal((await db.query(`DELETE FROM ${table} RETURNING id`)).rows.length, 0);
    await denied(`TRUNCATE ${table}`);
  }
  await denied('INSERT INTO telegram_clubs DEFAULT VALUES');
  equal((await db.query('UPDATE telegram_clubs SET id=id RETURNING id')).rows.length,0);
  equal((await db.query('DELETE FROM telegram_clubs RETURNING id')).rows.length,0);
  for (const resource of projections) {
    const rows=(await db.query(`SELECT * FROM list_operational_${resource}()`)).rows;
    if (n===1) equal(rows.length,0,'ordinary users receive no operational data');
    equal(JSON.stringify(rows).includes('FORBIDDEN_MARKER'),false,'no credentials through projection');
  }
}
await actor(2);
equal((await db.query('SELECT provider FROM list_operational_integrations()')).rows,[{provider:'bepaid'}]);
await actor(3);
equal((await db.query('SELECT provider FROM list_operational_integrations()')).rows,[{provider:'smtp'}]);
for (const role of ['authenticated','service_role']) {
  await actor(role === 'authenticated' ? 5 : null, role);
  for (const table of targets) {
    assert.ok((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n>0); assertions++;
    await db.exec('BEGIN');
    equal((await db.query(`INSERT INTO ${table} DEFAULT VALUES RETURNING id`)).rows.length,1);
    assert.ok((await db.query(`UPDATE ${table} SET id=id RETURNING id`)).rows.length>0); assertions++;
    assert.ok((await db.query(`DELETE FROM ${table} RETURNING id`)).rows.length>0); assertions++;
    await db.exec('ROLLBACK');
  }
}
await actor(null,'anon');
for (const table of [...targets, 'telegram_clubs']) {
  for (const sql of [`SELECT * FROM ${table}`,`INSERT INTO ${table} DEFAULT VALUES`,`UPDATE ${table} SET id=id`,`DELETE FROM ${table}`,`TRUNCATE ${table}`]) await denied(sql);
}
for (const resource of projections) await denied(`SELECT * FROM list_operational_${resource}()`);
await db.close();
console.log(`PASS: ${assertions} isolated PostgreSQL assertions; migration applied twice; no production connection.`);
