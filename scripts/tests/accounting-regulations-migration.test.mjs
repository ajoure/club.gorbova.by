import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const sql = await readFile(new URL('../../supabase/migrations/20261002135930_cb_accounting_regulations.sql', import.meta.url), 'utf8');
const cb20 = '3e43fb28-8322-41bc-bfee-714731bdc630';
const cb21 = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596';
async function fixture(count = 8) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE app_sections(id uuid DEFAULT gen_random_uuid(), code text UNIQUE, label text, icon text, route text, is_public boolean, sort_order integer, is_active boolean);
    CREATE TABLE ai_user_prompts(id uuid DEFAULT gen_random_uuid(), code text UNIQUE, title text, description text, prompt_text text, type text, category text, icon text, input_hint text, is_active boolean, is_archived boolean, sort_order integer, is_visible_in_chat boolean, launcher_title text, launcher_description text, launcher_order integer);
    CREATE TABLE products_v2(id uuid, name text);
    CREATE TABLE tariffs(id uuid DEFAULT gen_random_uuid(), product_id uuid, name text);
    CREATE TABLE access_rules(id uuid DEFAULT gen_random_uuid(), product_id uuid, tariff_id uuid, grant_target_type text, target_ref text, target_label text, is_active boolean, priority integer, conditions jsonb, notes text);
    INSERT INTO products_v2 VALUES ('${cb20}','CB20'),('${cb21}','CB21');
    INSERT INTO tariffs(product_id,name) SELECT '${cb20}', 'synthetic' FROM generate_series(1,5);
    INSERT INTO tariffs(product_id,name) SELECT '${cb21}', 'synthetic' FROM generate_series(1,${count});
    INSERT INTO access_rules(target_ref,is_active) VALUES ('unrelated',true);`);
  return db;
}
test('migration produces exactly 1/1/13 and reruns without changing other rules', async () => {
  const db = await fixture();
  try {
    await db.exec(sql);
    await db.exec(sql);
    const result = await db.query('SELECT (SELECT count(*) FROM app_sections) sections, (SELECT count(*) FROM ai_user_prompts) prompts, (SELECT count(*) FROM access_rules WHERE target_ref <> \'unrelated\') rules');
    assert.deepEqual(result.rows[0], { sections: 1, prompts: 1, rules: 13 });
    assert.equal((await db.query("SELECT is_active FROM access_rules WHERE target_ref='unrelated'")).rows[0].is_active, true);
    assert.equal((await db.query('SELECT is_public FROM app_sections')).rows[0].is_public, false);
  } finally { await db.close(); }
});
test('unexpected tariff scope aborts atomic apply', async () => {
  const db = await fixture(7);
  try {
    await db.exec('BEGIN');
    await assert.rejects(db.exec(sql), /tariff_scope_missing/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*) count FROM app_sections')).rows[0].count, 0);
    assert.equal((await db.query('SELECT count(*) count FROM access_rules')).rows[0].count, 1);
  } finally { await db.close(); }
});
