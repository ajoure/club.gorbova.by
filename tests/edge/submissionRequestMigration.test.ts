import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('claims only one request per link and preserves historical rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE document_package_external_submissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), external_link_id uuid NOT NULL, status text NOT NULL);
      INSERT INTO document_package_external_submissions (external_link_id,status) VALUES ('00000000-0000-4000-8000-000000000001','failed');`);
    await db.exec(readFileSync('supabase/migrations/20260913082426_neural_submission_idempotency.sql', 'utf8'));
    const claim = () => db.query(`INSERT INTO document_package_external_submissions (external_link_id,status,request_id,request_fingerprint)
      VALUES ($1,'generating',$2,$3) RETURNING id`, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'a'.repeat(64)]);
    const results = await Promise.allSettled([claim(), claim()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: '23505' } });
    expect((await db.query(`SELECT status, request_id FROM document_package_external_submissions WHERE request_id IS NULL`)).rows).toEqual([{ status: 'failed', request_id: null }]);
    expect((await db.query(`SELECT count(*)::int AS n FROM document_package_external_submissions WHERE request_id IS NOT NULL`)).rows).toEqual([{ n: 1 }]);
    await expect(db.exec(`INSERT INTO document_package_external_submissions (external_link_id,status,request_fingerprint) VALUES ('00000000-0000-4000-8000-000000000001','generating','raw private data')`)).rejects.toMatchObject({ code: '23514' });
  } finally { await db.close(); }
}, 20000);
