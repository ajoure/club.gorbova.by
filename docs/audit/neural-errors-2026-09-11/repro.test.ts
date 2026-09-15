// Audit characterization: these assertions confirm defects at the audited SHA.
// Opt-in only. They are NOT release acceptance or desired product behavior.
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { countUserMessages } from '../../../supabase/functions/_shared/ai-access';
import { useAiChat } from '../../../src/hooks/useAiChat';
import { useCorporatePackageGeneration } from '../../../src/hooks/useCorporatePackageGeneration';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'audit-user' } }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function quotaClient(rows: Array<{ created_at: string }>, failure = false) {
  let lowerBound = '';
  const q: any = {
    select: () => q, eq: () => q,
    gte: (_: string, value: string) => { lowerBound = value; return q; },
    then: (resolve: any) => resolve(failure
      ? { data: null, error: { message: 'simulated database failure' } }
      : { data: rows.filter(r => r.created_at >= lowerBound), error: null }),
  };
  return { from: () => q, boundary: () => lowerBound };
}

it('reproduces missing all messages from the first Minsk calendar day', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T10:00:00Z'));
  const db = quotaClient([{ created_at: '2026-09-01T09:00:00Z' }]);
  const result = await countUserMessages(db, 'audit-user', { ai_mode: 'chat' });
  expect(db.boundary()).toBe('2026-09-01T21:00:00.000Z');
  expect(result.monthly).toBe(0); // Desired: 1; correct boundary: Aug 31 21:00Z.
});

it('reproduces counting the previous month during the first three hours of a Minsk month', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
  const db = quotaClient([{ created_at: '2026-09-15T09:00:00Z' }]);
  const result = await countUserMessages(db, 'audit-user', { ai_mode: 'chat' });
  expect(result.monthly).toBe(1); // Desired: 0; in Minsk it is already October.
});

it('reproduces quota fail-open when the database returns an error', async () => {
  const result = await countUserMessages(quotaClient([], true), 'audit-user', { ai_mode: 'chat' });
  expect(result).toEqual({ daily: 0, monthly: 0 }); // A failed read is not a zero counter.
});

it('reproduces an old response appearing after New chat', async () => {
  let resolve!: (value: unknown) => void;
  mocks.invoke.mockReturnValue(new Promise(r => { resolve = r; }));
  const { result } = renderHook(() => useAiChat());
  let pending!: Promise<void>;
  act(() => { pending = result.current.sendMessage('Audit synthetic message'); });
  act(() => { result.current.clearChat(); });
  await act(async () => { resolve({ data: { content: 'Old conversation answer', conversation_id: 'old-conversation' }, error: null }); await pending; });
  expect(result.current.conversationId).toBe('old-conversation');
  expect(result.current.messages.map(m => m.content)).toContain('Old conversation answer');
});

it('reproduces a technical failure being sent back to AI as assistant history', async () => {
  mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
  const { result } = renderHook(() => useAiChat());
  await act(async () => { await result.current.sendMessage('First synthetic message'); });
  mocks.invoke.mockResolvedValueOnce({ data: { content: 'Synthetic answer' }, error: null });
  await act(async () => { await result.current.sendMessage('Second synthetic message'); });
  const history = mocks.invoke.mock.calls[1][1].body.messages;
  expect(history.some((m: any) => m.role === 'assistant' && m.content.includes('временно недоступна'))).toBe(true);
});

it('reproduces loss of server error body in corporate generation', async () => {
  mocks.invoke.mockResolvedValue({ data: null, error: {
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify({ error: 'Session not confirmed' }), { status: 400 }),
  } });
  const { result } = renderHook(() => useCorporatePackageGeneration());
  await act(async () => { await result.current.generateCorporatePackage('audit-session'); });
  expect(result.current.result?.error).toBe('Edge Function returned a non-2xx status code');
});
