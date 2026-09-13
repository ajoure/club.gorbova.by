import { expect, it } from 'vitest';
import { submissionFingerprint, submissionReplay, isSubmissionRequestId } from '../../supabase/functions/_shared/document-submission-request';

it('hashes equivalent object key order identically and detects changed values', async () => {
  const a = await submissionFingerprint({ fields: { b: 2, a: 1 }, repeat_groups: [{ total: 50 }] });
  expect(a).toBe(await submissionFingerprint({ repeat_groups: [{ total: 50 }], fields: { a: 1, b: 2 } }));
  expect(a).not.toBe(await submissionFingerprint({ fields: { b: 2, a: 1 }, repeat_groups: [{ total: 51 }] }));
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});
it('requires a well-formed opaque attempt ID', () => {
  expect(isSubmissionRequestId('00000000-0000-4000-8000-000000000001')).toBe(true);
  expect(isSubmissionRequestId('client-input')).toBe(false);
  expect(isSubmissionRequestId(null)).toBe(false);
});
it('replays a saved success without treating an unfinished delivery as confirmed', () => {
  expect(submissionReplay({ id: 's', status: 'generated', generated_document_ids: ['d'], metadata: { generation_status: 'partial' } }).body)
    .toMatchObject({ success: true, replayed: true, generation_status: 'partial', delivery_complete: false });
  expect(submissionReplay({ id: 's', status: 'generated', generated_document_ids: ['d'], metadata: { delivery_complete: true } }).body.delivery_complete).toBe(true);
});
it.each(['received', 'generating'])('returns an in-progress read-only result for %s', status => {
  expect(submissionReplay({ id: 's', status }).body).toMatchObject({ found: true, success: false, error: 'generation_in_progress' });
});
it('does not expose raw provider errors from a previous attempt', () => {
  const result = submissionReplay({ id: 's', status: 'failed', error_code: 'private provider details' });
  expect(result.body.error).toBe('generation_outcome_unknown');
  expect(JSON.stringify(result)).not.toContain('private');
});
