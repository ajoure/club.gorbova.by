import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Local in-memory Postgres only. This test never connects to a production database.
const { PGlite } = await import(process.env.CONTACT_MERGE_PGLITE_MODULE || '@electric-sql/pglite');
const auditSql = readFileSync(new URL('./archived-active-contact-preflight.sql', import.meta.url), 'utf8');

test('archive matching keeps every active candidate, ignores blank/short phones and emits no contact values', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id text PRIMARY KEY);
      CREATE TABLE public.profiles(id text PRIMARY KEY, user_id text REFERENCES auth.users(id),
        is_archived boolean, status text, merged_to_profile_id text REFERENCES public.profiles(id),
        telegram_user_id text, email text, phone text);
      INSERT INTO auth.users VALUES ('login-a'), ('login-b');
      INSERT INTO profiles VALUES
        ('active-a','login-a',false,'active',null,'tg-a','buyer@example.invalid','+375 (29) 123-45-67'),
        ('active-b','login-b',false,'active',null,'tg-b','other@example.invalid','375291234567'),
        ('archive-email',null,true,'archived',null,null,' BUYER@example.invalid ',null),
        ('archive-phone',null,true,'archived',null,'tg-other','old@example.invalid','375291234567'),
        ('archive-empty',null,true,'archived',null,null,'',null),
        ('active-empty',null,false,'imported',null,null,'',''),
        ('archive-short',null,true,'archived',null,null,null,'123'),
        ('active-short',null,false,'imported',null,null,null,'123'),
        ('archive-done',null,true,'archived','active-a',null,'buyer@example.invalid',null);`);
    const results = await db.exec(auditSql);
    const { preflight } = results[0].rows[0];
    const email = preflight.pairs.find(p => p.archived_id === 'archive-email');
    assert.equal(email.master_id, 'active-a');
    assert.equal(email.matched_email, true);
    assert.equal(email.active_candidates, 1);
    const phone = preflight.pairs.filter(p => p.archived_id === 'archive-phone');
    assert.equal(phone.length, 2);
    assert.ok(phone.every(p => p.active_candidates === 2 && p.matched_phone && p.telegram_conflict));
    assert.equal(preflight.pairs.some(p => ['archive-empty','archive-short'].includes(p.archived_id)), false);
    assert.equal(preflight.pairs.find(p => p.archived_id === 'archive-done').merged_to_profile_id, 'active-a');
    assert.ok(results[1].rows.some(r => r.column_name === 'user_id' && r.referenced_table === 'users'));
    assert.ok(results[2].rows.some(r => r.table_name === 'profiles' && r.column_name === 'user_id'));
    const output = JSON.stringify(preflight);
    assert.ok(!output.includes('@') && !output.includes('375291234567') && !output.includes('tg-other'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM profiles')).rows[0].n, 9);
  } finally { await db.close(); }
});
