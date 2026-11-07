import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sql = await readFile(new URL('../../supabase/migrations/20261029095619_video_drm_pilot_session_guard.sql', import.meta.url), 'utf8');
const uid = '11111111-1111-4111-8111-111111111111';
const sid = '22222222-2222-4222-8222-222222222222';
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz);
    CREATE TABLE public.profiles(user_id uuid,status text,is_archived boolean,merged_to_profile_id uuid);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz,refreshed_at timestamp without time zone,not_after timestamptz);
    INSERT INTO auth.users VALUES('${uid}',NULL,NULL);
    INSERT INTO public.profiles VALUES('${uid}','active',false,NULL);
    INSERT INTO auth.sessions VALUES('${sid}','${uid}',now()-interval '1 minute',(now() AT TIME ZONE 'UTC')-interval '10 seconds',NULL);`);
  await db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
  return db;
}
const allowed = async (db, user = uid, idle = 300, age = 1800, single = false) =>
  (await db.query('SELECT public.video_pilot_session_is_live($1,$2,$3,$4,$5) allowed', [sid, user, idle, age, single])).rows[0].allowed;

test('service-only RPC reads live session without exposing auth tables or allowing anonymous execution', async () => {
  const db = await setup();
  try {
    const before = (await db.query('SELECT to_jsonb(s) data FROM auth.sessions s')).rows;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(allowed(db), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.equal(await allowed(db), true);
    await assert.rejects(db.query('SELECT * FROM auth.sessions'), /permission denied/);
    await db.exec('RESET ROLE');
    assert.deepEqual((await db.query('SELECT to_jsonb(s) data FROM auth.sessions s')).rows, before);
    assert.deepEqual((await db.query("SELECT proconfig FROM pg_proc WHERE proname='video_pilot_session_is_live'")).rows[0].proconfig,
      ['search_path=pg_catalog']);
  } finally { await db.close(); }
});

test('UTC refresh timestamps retain the same validity in different database time zones', async () => {
  const db = await setup();
  try {
    for (const zone of ['UTC', 'Europe/Warsaw', 'America/New_York', 'Asia/Tokyo']) {
      await db.exec(`SET TIME ZONE '${zone}'`);
      await db.exec("UPDATE auth.sessions SET refreshed_at=(now() AT TIME ZONE 'UTC')-interval '10 seconds'");
      assert.equal(await allowed(db), true, `${zone}: recent UTC refresh`);
      await db.exec("UPDATE auth.sessions SET refreshed_at=(now() AT TIME ZONE 'UTC')-interval '6 minutes'");
      assert.equal(await allowed(db), false, `${zone}: expired UTC refresh`);
      await db.exec("UPDATE auth.sessions SET refreshed_at=(now() AT TIME ZONE 'UTC')+interval '1 minute'");
      assert.equal(await allowed(db), false, `${zone}: future UTC refresh`);
      await db.exec('UPDATE auth.sessions SET refreshed_at=NULL');
      assert.equal(await allowed(db), true, `${zone}: falls back to creation instant`);
    }
  } finally { await db.close(); }
});

test('mismatched subject, expired timebox/inactivity, revoked or banned/deleted users fail closed', async () => {
  const db = await setup();
  try {
    assert.equal(await allowed(db, sid), false);
    assert.equal(await allowed(db, uid, null, null), true);
    assert.equal(await allowed(db, uid, 300, 1800, null), false);
    for (const [idle, age] of [[0, 1800], [31536001, 1800], [300, 31536001]])
      assert.equal(await allowed(db, uid, idle, age), false);
    for (const mutation of [
      "not_after=now()-interval '1 second'",
      "created_at=now()-interval '31 minutes'",
      "refreshed_at=(now() AT TIME ZONE 'UTC')-interval '6 minutes'",
      "refreshed_at=(now() AT TIME ZONE 'UTC')+interval '1 minute'",
      "created_at=now()+interval '1 minute'",
    ]) {
      await db.exec('BEGIN');
      await db.exec(`UPDATE auth.sessions SET ${mutation}`);
      assert.equal(await allowed(db), false, mutation);
      await db.exec('ROLLBACK');
    }
    for (const mutation of ["banned_until=now()+interval '1 day'", 'deleted_at=now()']) {
      await db.exec('BEGIN'); await db.exec(`UPDATE auth.users SET ${mutation}`);
      assert.equal(await allowed(db), false, mutation); await db.exec('ROLLBACK');
    }
    for (const mutation of ["status='banned'", 'is_archived=true', `merged_to_profile_id='${sid}'`]) {
      await db.exec('BEGIN'); await db.exec(`UPDATE public.profiles SET ${mutation}`);
      assert.equal(await allowed(db), false, mutation); await db.exec('ROLLBACK');
    }
    await db.exec(`INSERT INTO auth.sessions VALUES('${uid}','${uid}',now(),now() AT TIME ZONE 'UTC',NULL)`);
    assert.equal(await allowed(db, uid, 300, 1800, true), false);
    assert.equal(await allowed(db, uid, 300, 1800, false), true);
    await db.exec('DELETE FROM auth.sessions');
    assert.equal(await allowed(db), false);
  } finally { await db.close(); }
});
