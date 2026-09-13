import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.HISTORICAL_PGLITE_MODULE || '@electric-sql/pglite');
const migration = readFileSync(new URL('../../supabase/migrations/20260913081341_confirmed_historical_purchase_date.sql', import.meta.url), 'utf8');
const approvedHash = 'cbf4f09b72f3be568e6281b31d9c6c226a4d1d52743911ed138716c7beefeecf';
const id = '00000000-0000-4000-8000-000000000001';
const profile = '00000000-0000-4000-8000-000000000002';
const user = '00000000-0000-4000-8000-000000000003';
const product = '00000000-0000-4000-8000-000000000004';
const payload = [{ id, profile_id: profile, user_id: user, product_id: product,
  refs: ['17:87'], deal_date: '2024-05-15T12:17:17+03:00', source_date_ref: '17:87',
  source_date_origin: 'owner_confirmed_staff_clarification', source_date_confirmed_on: '2026-09-13' }];

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.role',true),'')$$;
    GRANT USAGE ON SCHEMA auth TO PUBLIC; GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    CREATE TABLE orders_v2(id uuid PRIMARY KEY, profile_id uuid, user_id uuid, product_id uuid,
      reconcile_source text, meta jsonb, status text, is_deleted boolean, base_price numeric,
      final_price numeric, paid_amount numeric, created_at timestamptz, deal_date timestamptz,
      updated_at timestamptz, purchase_snapshot jsonb);
    CREATE TABLE audit_logs(action text,actor_type text,actor_label text,meta jsonb);
    CREATE TABLE payments_v2(order_id uuid); CREATE TABLE subscriptions_v2(order_id uuid);
    CREATE TABLE entitlements(order_id uuid); CREATE TABLE entitlement_sources(order_id uuid);
    CREATE TABLE access_grant_ledger(order_id uuid,source_order_id uuid);
    CREATE TABLE referral_balance_transactions(source_id uuid);`);
  await db.exec(`ALTER TABLE orders_v2 ADD COLUMN is_trial boolean DEFAULT false,
    ADD COLUMN tariff_id uuid, ADD COLUMN flow_id uuid, ADD COLUMN currency text DEFAULT 'BYN'`);
  // Use the shipped month guard, not a mock of its behaviour.
  const existing = readFileSync(new URL('../../supabase/migrations/20260911163000_historical_purchase_source_dates.sql', import.meta.url), 'utf8');
  await db.exec(existing.slice(0, existing.indexOf('-- Fixed source-backed date repair.')));
  await db.exec('CREATE TRIGGER month BEFORE INSERT OR UPDATE OF status,deal_date,meta ON orders_v2 FOR EACH ROW EXECUTE FUNCTION orders_v2_autofill_deal_month()');
  const hash = (await db.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h", [JSON.stringify(payload)])).rows[0].h;
  assert.equal(migration.split(approvedHash).length, 2);
  await db.exec(migration.replace(approvedHash, hash));
  await db.query(`INSERT INTO orders_v2(id,profile_id,user_id,product_id,reconcile_source,meta,status,
    is_deleted,base_price,final_price,paid_amount,created_at,deal_date,updated_at,purchase_snapshot)
    VALUES($1,$2,$3,$4,'owner_confirmed_historical',$5,
    'paid',false,0,0,0,'2026-09-11T13:20:00Z',null,'2026-09-11T13:20:00Z','{"history_only":true}')`,
  [id, profile, user, product, JSON.stringify({ history_only: true, historical_batch_id: 'hist-cb17-18-20260911-v1',
    source_spreadsheet_id: '1dw8ljnBwfyNn26INHdwxt7MdRGs7aX5qkby7V1wWUq8', source_refs: ['17:87'],
    source_purchase_date_unknown: true, owner_confirmed_paid: true, source_paid_at: null, keep_unrelated: 'preserved' })]);
  await db.exec("SET request.jwt.claim.role='service_role'");
  return db;
}
const rpc = async (db, mode = 'dry-run', p = payload) =>
  (await db.query('SELECT admin_confirm_historical_cb_date($1,$2) result', [JSON.stringify(p), mode])).rows[0].result;
const row = async db => (await db.query('SELECT * FROM orders_v2')).rows[0];
const auditCount = async db => (await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n;

test('confirmed timestamp and provenance preserve ownership, import time, amounts, snapshot and month boundary; rollback and replay are safe', async () => {
  const db = await fixture();
  try {
    const before = await row(db);
    assert.equal((await rpc(db)).changes, 1);
    assert.deepEqual(await row(db), before);
    assert.equal((await rpc(db, 'rollback')).rolled_back, true);
    assert.deepEqual(await row(db), before);
    assert.equal(await auditCount(db), 0);
    assert.equal((await rpc(db, 'execute')).changes, 1);
    const after = await row(db);
    assert.equal(after.deal_date.toISOString(), '2024-05-15T09:17:17.000Z');
    assert.deepEqual({ ...after, deal_date: before.deal_date, meta: before.meta }, before);
    assert.equal(after.meta.source_date_origin, 'owner_confirmed_staff_clarification');
    assert.equal(after.meta.source_date_confirmed_on, '2026-09-13');
    assert.equal(after.meta.source_purchase_date_unknown, false);
    assert.equal(after.meta.source_date_column, undefined);
    assert.equal(after.meta.deal_month, undefined);
    assert.equal(after.meta.keep_unrelated, 'preserved');
    assert.equal(after.meta.source_paid_at, null);
    assert.equal((await rpc(db, 'execute')).changes, 0);
    assert.equal((await rpc(db)).already_repaired, 1);
    assert.equal(await auditCount(db), 1);
  } finally { await db.close(); }
});

test('anon/authenticated are denied; altered or missing payload and invalid mode cannot repair other facts', async () => {
  const db = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(rpc(db), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec("SET request.jwt.claim.role='authenticated'");
    await assert.rejects(rpc(db), /Service role/);
    await db.exec("SET request.jwt.claim.role='service_role'");
    for (const patch of [{ id: profile }, { deal_date: '2025-01-01T00:00:00Z' }, { source_date_origin: 'D' }])
      await assert.rejects(rpc(db, 'execute', [{ ...payload[0], ...patch }]), /Unapproved/);
    await assert.rejects(rpc(db, 'execute', null), /Unapproved/);
    await assert.rejects(db.query("SELECT admin_confirm_historical_cb_date(NULL,'execute')"), /Explicit payload/);
    await assert.rejects(rpc(db, 'write'), /supported mode/);
    assert.equal((await row(db)).deal_date, null);
    assert.equal(await auditCount(db), 0);
  } finally { await db.close(); }
});

test('ownership or source drift and existing date stop without overwrite', async () => {
  const db = await fixture();
  try {
    for (const field of ['profile_id', 'user_id', 'product_id']) {
      await db.exec('BEGIN');
      await db.exec(`UPDATE orders_v2 SET ${field}='00000000-0000-4000-8000-000000000099'`);
      await assert.rejects(rpc(db, 'execute'), /source or financial/);
      await db.exec('ROLLBACK');
    }
    for (const update of ["is_trial=true", "status='pending'", "paid_amount=1", "currency='USD'",
      "tariff_id='00000000-0000-4000-8000-000000000099'", "meta=meta||'{\"source_refs\":[\"17:88\"]}'"]) {
      await db.exec('BEGIN');
      await db.exec(`UPDATE orders_v2 SET ${update}`);
      await assert.rejects(rpc(db, 'execute'), /source or financial/);
      await db.exec('ROLLBACK');
    }
    await db.exec("UPDATE orders_v2 SET deal_date='2024-01-01T00:00:00Z'");
    await assert.rejects(rpc(db, 'execute'), /existing purchase date/);
    assert.equal((await row(db)).deal_date.toISOString(), '2024-01-01T00:00:00.000Z');
    assert.equal(await auditCount(db), 0);
  } finally { await db.close(); }
});

test('unexpected access side effects roll back the date and audit atomically', async () => {
  const db = await fixture();
  try {
    await db.exec(`CREATE FUNCTION bad_access() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO entitlements VALUES(NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER bad AFTER UPDATE ON orders_v2 FOR EACH ROW EXECUTE FUNCTION bad_access()`);
    await assert.rejects(rpc(db, 'execute'), /money\/access/);
    assert.equal((await row(db)).deal_date, null);
    assert.equal((await db.query('SELECT count(*)::int n FROM entitlements')).rows[0].n, 0);
    assert.equal(await auditCount(db), 0);
  } finally { await db.close(); }
});
