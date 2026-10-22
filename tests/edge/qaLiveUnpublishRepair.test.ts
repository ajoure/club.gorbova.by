import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const repair = readFileSync('docs/operations/2026-10-22-qa-live-catalogue-data-repair.sql', 'utf8');
const open = '6ea22dad-2c60-48a3-986f-aa04efd0eab6';
const locked = '4ad98360-41d5-40c2-9d3c-946d314e5875';
const other = '00000000-0000-4000-8000-000000000001';
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE live_events (
    id uuid PRIMARY KEY, slug text UNIQUE, updated_at timestamptz, scheduled_at timestamptz,
    is_published boolean, status text, platform_status text, room_state text, source_kind text,
    replay_enabled boolean, kinescope_video_id text, kinescope_live_event_id text,
    live_started_at timestamptz, room_opened_at timestamptz, metadata jsonb DEFAULT '{"preserve":true}'
  );
  INSERT INTO live_events(id,slug,updated_at,scheduled_at,is_published,status,platform_status,room_state,source_kind,replay_enabled)
  VALUES ('${open}','qa-live-open','2026-07-21 15:16:34.558461+00','2026-07-07 16:32:14.916+00',true,'scheduled','draft','closed','kinescope_live_event',false),
    ('${locked}','qa-live-locked','2026-07-10 13:32:00.572753+00','2026-07-07 16:32:15.233+00',true,'scheduled','draft','closed','kinescope_live_event',false),
    ('${other}','real-club-event','2026-10-01+00','2026-10-30+00',true,'scheduled','scheduled','closed','kinescope_live_event',false);
  CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
  CREATE TRIGGER touch BEFORE UPDATE ON live_events FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
  return db;
}
const rows = async (db: PGlite) => (await db.query<Record<string, unknown>>('SELECT * FROM live_events ORDER BY id')).rows;

describe('reviewed QA withdrawal runs atomically against its actual SQL guards', () => {
  it('only unpublishes the two fixtures, preserves all content/other events, and replays without timestamp churn', async () => {
    const db = await fixture();
    try {
      const before = await rows(db);
      await db.exec(repair);
      const after = await rows(db);
      for (let i = 0; i < before.length; i++) {
        if (before[i].id === other) expect(after[i]).toEqual(before[i]);
        else expect(after[i]).toEqual({ ...before[i], is_published: false, updated_at: expect.any(Date) });
      }
      await db.exec(repair);
      expect(await rows(db)).toEqual(after);
    } finally { await db.close(); }
  });
  it.each([
    [`DELETE FROM live_events WHERE id='${locked}'`, 'qa_live_expected_two_identities'],
    [`UPDATE live_events SET slug='different-event' WHERE id='${locked}'`, 'qa_live_expected_two_identities'],
    [`UPDATE live_events SET is_published=false WHERE id='${locked}'`, 'qa_live_partial_snapshot'],
    [`UPDATE live_events SET metadata='{"editor_changed":true}' WHERE id='${locked}'`, 'qa_live_snapshot_changed'],
    [`ALTER TABLE live_events DISABLE TRIGGER touch; UPDATE live_events SET room_state='live' WHERE id='${locked}'`, 'qa_live_snapshot_changed'],
    [`ALTER TABLE live_events DISABLE TRIGGER touch; UPDATE live_events SET kinescope_video_id='new-recording' WHERE id='${locked}'`, 'qa_live_snapshot_changed'],
  ])('aborts all repair writes when preflight is no longer true: %s', async (change, error) => {
    const db = await fixture();
    try {
      await db.exec(change);
      const before = await rows(db);
      await expect(db.exec(repair)).rejects.toThrow(error);
      expect(await rows(db)).toEqual(before);
    } finally { await db.close(); }
  });
});
