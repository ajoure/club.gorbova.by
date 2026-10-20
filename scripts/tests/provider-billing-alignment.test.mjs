import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);
const old = readFileSync(new URL('supabase/migrations/20260125141326_d06ffc29-75be-4730-8cd7-01c8f69e8c33.sql', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20261020202000_preserve_provider_billing_schedule.sql', root), 'utf8');
const club = '11c9f1b8-0355-4753-bd74-40b42aa53616';
const other = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000001';
const end = '2026-11-14T12:00:00Z';
const schedule = '2026-11-13T09:12:37Z';
const later = '2026-11-15T12:00:00Z';

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.audit_logs(action text,actor_type text,actor_label text,meta jsonb);
    CREATE TABLE public.subscriptions_v2(id uuid PRIMARY KEY,product_id uuid,billing_type text,
      auto_renew boolean,status text,access_start_at timestamptz,access_end_at timestamptz,
      next_charge_at timestamptz,meta jsonb DEFAULT '{}');`);
  await db.exec(old);
  await db.exec('REVOKE EXECUTE ON FUNCTION public.ensure_billing_alignment() FROM PUBLIC, anon, authenticated');
  await db.exec('GRANT EXECUTE ON FUNCTION public.ensure_billing_alignment() TO service_role');
  return db;
}
const state = async db => (await db.query(`SELECT jsonb_build_object(
  'rows',(SELECT jsonb_agg(s ORDER BY id) FROM subscriptions_v2 s),
  'audit',(SELECT jsonb_agg(a) FROM audit_logs a)) value`)).rows[0].value;
async function insert(db, { type = 'provider_managed', renew = false, status = 'active', next = schedule, product = club } = {}) {
  await db.query(`INSERT INTO subscriptions_v2 VALUES($1,$2,$3,$4,$5,'2026-10-14T12:00:00Z',$6,$7,'{"retain":"fixture"}')`,
    [id, product, type, renew, status, end, next]);
  return state(db);
}

test('reproduces the live trigger overwrite and preserves a verified provider date after migration', async () => {
  const db = await fixture();
  try {
    const before = await insert(db);
    assert.equal(Date.parse(before.rows[0].next_charge_at), Date.parse(end));
    assert.equal(before.audit[0].action, 'billing.charge_date_auto_corrected');
    await db.exec(migration);
    await db.query('UPDATE subscriptions_v2 SET next_charge_at=$1 WHERE id=$2', [schedule, id]);
    const after = await state(db);
    assert.equal(Date.parse(after.rows[0].next_charge_at), Date.parse(schedule));
    assert.deepEqual(after.rows[0], { ...before.rows[0], next_charge_at: after.rows[0].next_charge_at });
    assert.deepEqual(after.audit, before.audit);
  } finally { await db.close(); }
});

test('provider schedules stay independent for true/false/null consent, all statuses and NULL/before/equal/after dates', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    for (const renew of [true, false, null]) for (const status of ['active', 'trial', 'past_due', 'expired']) {
      for (const next of [null, schedule, end, later]) {
        await db.exec('TRUNCATE subscriptions_v2,audit_logs');
        const s = await insert(db, { renew, status, next });
        assert.equal(s.rows[0].next_charge_at === null ? null : Date.parse(s.rows[0].next_charge_at), next === null ? null : Date.parse(next));
        assert.equal(s.rows[0].auto_renew, renew);
        assert.equal(s.rows[0].status, status);
        assert.equal(Date.parse(s.rows[0].access_end_at), Date.parse(end));
        assert.deepEqual(s.rows[0].meta, { retain: 'fixture' });
        assert.equal(s.audit, null);
      }
    }
  } finally { await db.close(); }
});

test('local MIT, legacy NULL and other billing types retain the exact old trigger behavior', async () => {
  const db = await fixture();
  try {
    for (const type of ['mit', null, 'internal_installment']) for (const renew of [true, false, null]) {
      for (const status of ['active', 'trial', 'past_due', 'expired']) for (const next of [null, schedule, end, later]) {
        await db.exec('TRUNCATE subscriptions_v2,audit_logs');
        await db.exec(old);
        const before = await insert(db, { type, renew, status, next });
        await db.exec('TRUNCATE subscriptions_v2,audit_logs');
        await db.exec(migration);
        assert.deepEqual(await insert(db, { type, renew, status, next }), before);
      }
    }
  } finally { await db.close(); }
});

test('unrelated products remain unchanged; replacing the function does not backfill or change trigger/security grants', async () => {
  const db = await fixture();
  try {
    await insert(db, { type: 'mit', product: other, renew: true, next: null });
    const before = await state(db);
    const security = async () => (await db.query(`SELECT prosecdef,proconfig,proacl::text,
      (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='trg_ensure_billing_alignment') binding
      FROM pg_proc WHERE oid='public.ensure_billing_alignment()'::regprocedure`)).rows;
    const grants = await security();
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await state(db), before, 'schema migration performs no data writes');
    assert.deepEqual(await security(), grants);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') ok', [role, 'public.ensure_billing_alignment()'])).rows[0].ok, false);
    }
    await db.query('UPDATE subscriptions_v2 SET next_charge_at=$1 WHERE id=$2', [schedule, id]);
    const after = await state(db);
    assert.equal(Date.parse(after.rows[0].next_charge_at), Date.parse(schedule));
    assert.equal(after.audit, null);
  } finally { await db.close(); }
});
