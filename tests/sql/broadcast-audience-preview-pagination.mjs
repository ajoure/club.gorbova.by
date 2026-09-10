// Install PGlite in a disposable directory; do not point this test at a live database.
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url).pathname;
const db = new PGlite();
await db.exec(await readFile(root + '/tests/sql/broadcast-audience-preview-pagination.sql', 'utf8'));
const migration = await readFile(root + '/supabase/migrations/20260910073936_broadcast_audience_preview_pagination.sql', 'utf8');
await db.exec(migration);
await db.exec(migration); // idempotent DDL
async function page(offset, limit = 50) {
  const r = await db.query('select public.resolve_broadcast_audience($1::jsonb) as result', [JSON.stringify({__preview_offset: offset, __preview_limit: limit})]);
  return r.rows[0].result;
}
const a = await page(0), b = await page(50);
assert.equal(a.total_count, 59);
assert.equal(a.email_count, 55);
assert.equal(a.telegram_count, 58);
assert.equal(a.email_archived_count, 1);
assert.equal(a.email_no_account_count, 1);
assert.equal(a.users.length, 50);
assert.equal(b.users.length, 9);
assert.equal(b.page_offset, 50);
const all = [...a.users, ...b.users];
assert.equal(new Set(all.map(u => u.id)).size, 59);
assert.equal(all.filter(u => !u.has_email && u.has_telegram).length, 4);
assert.deepEqual((await page(0)).users, a.users);
assert.equal((await page(100)).users.length, 0);
assert.equal((await page(-1, 1000)).page_limit, 100);
await db.exec("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated'::text $$;");
await assert.rejects(page(0), /forbidden/);
await db.exec("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$; TRUNCATE preview_test_contacts, preview_test_tg, profiles;");
assert.equal((await page(0)).total_count, 0);
assert.equal((await page(0)).users.length, 0);
console.log('PASS: 59 = 50 + 9; stable order with duplicate/null names; no duplicate IDs; Telegram-only; counts preserved; empty/out-of-range; cap; unauthorized; idempotent DDL.');
await db.close();
