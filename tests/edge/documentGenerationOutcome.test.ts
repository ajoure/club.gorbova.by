import { describe, expect, it, vi } from 'vitest';
import { classifyExternalGeneration, recordExternalGeneration } from '../../supabase/functions/_shared/document-generation-outcome';

const documentId = '00000000-0000-4000-8000-000000000001';
const generated = { success: true, status: 'generated', results: [{ status: 'generated', document_id: documentId }] };
const now = () => '2026-09-13T10:00:00.000Z';

describe('external submission generation checkpoint', () => {
  it.each([
    ['blocked', 'role_assignment_missing:ln-000018'],
    ['failed', 'pf_required_value_missing:private-input'],
  ])('records the item cause of HTTP 200 + %s without a generation timestamp', async (status, cause) => {
    const body = { success: false, status, results: [{ status: 'error', errors: [cause] }] };
    const save = vi.fn(async () => true);
    const result = await recordExternalGeneration(async () => Response.json(body), save, now);
    expect(result.canDeliver).toBe(false);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', generated_at: null, generated_document_ids: [], error_code: cause.split(':')[0] }));
    expect(JSON.stringify(save.mock.calls)).not.toContain('private-input');
    expect(JSON.stringify(save.mock.calls)).not.toContain('ln-000018');
  });

  it('preserves partial documents and a safe summary without inventing a CHECK status', async () => {
    const save = vi.fn(async () => true);
    const body = { ...generated, status: 'partial', results: [...generated.results, { status: 'error', details: { error: 'active_version_invalid' } }] };
    const result = await recordExternalGeneration(async () => Response.json(body), save, now);
    expect(result).toMatchObject({ canDeliver: true, generationStatus: 'partial', documentIds: [documentId], errorCode: 'active_version_invalid' });
    expect(save).toHaveBeenCalledWith({ status: 'generated', generated_at: now(), generated_document_ids: [documentId], error_code: 'generation_partial', metadata: { generation_status: 'partial', generation_error_code: 'active_version_invalid', stage: 'generation' } });
  });

  it.each([false, 'throw'])('prevents delivery when the update is not acknowledged (%s)', async failure => {
    const save = vi.fn(async () => { if (failure === 'throw') throw new Error('private DB details'); return false; });
    const sender = vi.fn();
    const result = await recordExternalGeneration(async () => Response.json(generated), save, now);
    if (result.canDeliver) sender(result.documentIds);
    expect(sender).not.toHaveBeenCalled();
    expect(result).toMatchObject({ errorCode: 'submission_save_failed', httpStatus: 503, documentIds: [documentId] });
  });

  it.each(['network', 'json'])('records an uncertain %s outcome once without a retry', async failure => {
    const invoke = vi.fn(async () => { if (failure === 'network') throw new Error('private-network-url'); return new Response('<html>private-upstream</html>'); });
    const save = vi.fn(async () => true);
    const result = await recordExternalGeneration(invoke, save, now);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ canDeliver: false, generationStatus: 'unknown', errorCode: 'generation_outcome_unknown' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ generated_at: null, error_code: 'generation_outcome_unknown' }));
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('excludes failed items from partial delivery even if they contain a document ID', () => {
    const result = classifyExternalGeneration({ ...generated, status: 'partial', results: [
      ...generated.results,
      { status: 'error', document_id: '00000000-0000-0000-0000-000000000002', errors: ['render_failed'] },
    ] }, 200);
    expect(result).toMatchObject({ canDeliver: true, documentIds: [documentId], generationStatus: 'partial' });
  });

  it('never delivers an explicit failure just because document IDs were returned', async () => {
    const save = vi.fn(async () => true);
    const result = await recordExternalGeneration(async () => Response.json({ ...generated, success: false, status: 'failed' }), save, now);
    expect(result.canDeliver).toBe(false);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ generated_document_ids: [documentId], generated_at: null, status: 'failed' }));
  });

  it.each([
    [{ success: true, results: [] }, 200, 'generation_failed'],
    [{ error: 'Unauthorized' }, 401, 'unauthorized'],
    [{ error: 'new code containing private data' }, 502, 'generation_failed'],
    [{ results: [{ document_id: 'not-a-uuid' }] }, 200, 'generation_failed'],
  ])('fails safely on malformed or failed upstream response', (body, status, code) => {
    expect(classifyExternalGeneration(body, status)).toMatchObject({ canDeliver: false, errorCode: code });
  });

  it('deduplicates document IDs and permits a confirmed successful checkpoint', async () => {
    const save = vi.fn(async () => true);
    const result = await recordExternalGeneration(async () => Response.json({ ...generated, results: [...generated.results, ...generated.results] }), save, now);
    expect(result).toMatchObject({ canDeliver: true, errorCode: null, documentIds: [documentId] });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ generated_at: now(), error_code: null }));
  });
});
