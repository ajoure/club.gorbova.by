import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CHAT_AUDIT_VERSION, writeAccessAudit } from '../../supabase/functions/gorbova-ai-chat/access-audit';

const user = '00000000-0000-4000-8000-000000000001';
const receipt = '00000000-0000-4000-8000-000000000002';
const details = { prompt_id: receipt, baseline: '227:2026-01-01:v1', current_output: false, follows_current_law: true };
function client(result: unknown, throws = false) {
  const single = vi.fn(async () => { if (throws) throw result; return result; });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { from, insert, select, single };
}
afterEach(() => vi.restoreAllMocks());

describe('AI access audit uses the production schema without exposing diagnostics payloads', () => {
  it('confirms a canonical audit row and keeps the receipt out of logs', async () => {
    const db = client({ data: { id: receipt }, error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await writeAccessAudit(db, user, 'ai_chat.mns_law_rejected', details)).toBe(true);
    expect(db.from).toHaveBeenCalledWith('audit_logs');
    expect(db.insert).toHaveBeenCalledExactlyOnceWith({ actor_user_id: user, actor_type: 'user', action: 'ai_chat.mns_law_rejected', entity_type: 'ai_chat', meta: { ...details, audit_schema_version: AI_CHAT_AUDIT_VERSION } });
    expect(db.select).toHaveBeenCalledWith('id');
    expect(db.single).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });
  it.each([['PGRST204', 'schema'], ['42501', 'permission'], ['23514', 'constraint'], ['arbitrary-private-value', 'write_error']])('handles a resolved PostgREST error %s without throwing or retrying', async (code, kind) => {
    const db = client({ data: null, error: { code, message: 'private request text', details: user, hint: receipt } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await writeAccessAudit(db, user, 'ai_chat.mns_law_rejected', details)).toBe(false);
    expect(db.insert).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledExactlyOnceWith('[gorbova-ai-chat] audit_write_failed', { action: 'ai_chat.mns_law_rejected', kind });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private request|00000000|arbitrary-private/);
  });
  it('does not claim a write when the insert returned no receipt', async () => {
    const db = client({ data: null, error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await writeAccessAudit(db, user, 'ai_chat.mns_law_rejected', details)).toBe(false);
    expect(warn).toHaveBeenCalledWith('[gorbova-ai-chat] audit_write_failed', { action: 'ai_chat.mns_law_rejected', kind: 'missing_receipt' });
  });
  it('keeps uncertain thrown failures non-fatal and never retries the insert', async () => {
    const db = client(new Error('sensitive model output'), true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await writeAccessAudit(db, user, 'ai_chat.mns_law_rejected', details)).toBe(false);
    expect(db.insert).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledExactlyOnceWith('[gorbova-ai-chat] audit_write_failed', { action: 'ai_chat.mns_law_rejected', kind: 'exception' });
  });
});
