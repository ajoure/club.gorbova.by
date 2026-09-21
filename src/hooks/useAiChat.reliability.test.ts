import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAiChat } from './useAiChat';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke }, from: mocks.from } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('conversation isolation', () => {
  it.each(['chat', 'classifier'])('ignores an old %s response after New chat, including storage', async kind => {
    const pending = deferred<any>();
    mocks.invoke.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAiChat());
    let request!: Promise<void>;
    act(() => { request = kind === 'chat' ? result.current.sendMessage('Old question') : result.current.runAssetClassifier('Old question'); });
    act(() => result.current.clearChat());
    await act(async () => { pending.resolve({ data: { content: 'Old answer', conversation_id: 'old' }, error: null }); await request; });
    expect(result.current.messages.map(m => m.id)).toEqual(['welcome']);
    expect(result.current.conversationId).toBeNull();
    expect(localStorage.getItem('gorbova_ai_last_conversation_test-user')).toBeNull();
  });

  it('does not clear loading of a new request when the previous request fails', async () => {
    const old = deferred<any>(); const next = deferred<any>();
    mocks.invoke.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useAiChat());
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.sendMessage('Old'); });
    act(() => result.current.clearChat());
    act(() => { second = result.current.sendMessage('New'); });
    await act(async () => { old.resolve({ error: new Error('Old failure') }); await first; });
    expect(result.current.isLoading).toBe(true);
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => { next.resolve({ data: { content: 'New answer', conversation_id: 'new' } }); await second; });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.conversationId).toBe('new');
    expect(result.current.messages.map(m => m.content)).toEqual(expect.arrayContaining(['New', 'New answer']));
  });

  it('ignores a conversation restore completed after New chat', async () => {
    const old = deferred<any>();
    const chain: any = { select: () => chain, eq: () => chain, order: () => old.promise };
    mocks.from.mockReturnValue(chain);
    const { result } = renderHook(() => useAiChat());
    let request!: ReturnType<typeof result.current.loadConversation>;
    act(() => { request = result.current.loadConversation('old'); });
    act(() => result.current.clearChat());
    await act(async () => { old.resolve({ data: [{ id: 'm1', role: 'assistant', content: 'Old answer', created_at: new Date().toISOString() }] }); await request; });
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toHaveLength(1);
  });

  it('prevents two simultaneous submissions before React rerenders', async () => {
    const pending = deferred<any>(); mocks.invoke.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAiChat());
    let request!: Promise<void>;
    act(() => { request = result.current.sendMessage('First'); void result.current.sendMessage('Second'); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ data: { content: 'Answer' } }); await request; });
  });

  it('displays transport failures without feeding them to the next model request', async () => {
    mocks.invoke.mockResolvedValueOnce({ error: new Error('Failed to fetch') });
    const { result } = renderHook(() => useAiChat());
    await act(async () => { await result.current.sendMessage('First'); });
    expect(result.current.messages.at(-1)?.metadata?.is_error).toBe(true);
    mocks.invoke.mockResolvedValueOnce({ data: { content: 'Answer' } });
    await act(async () => { await result.current.sendMessage('Second'); });
    expect(mocks.invoke.mock.calls[1][1].body.messages).toEqual([{ role: 'user', content: 'First' }, { role: 'user', content: 'Second' }]);
  });

  it('keeps a bank statement failure in chat with recovery steps and allows retry', async () => {
    mocks.invoke.mockResolvedValueOnce({
      error: new Error('Request idle timeout limit (150s) reached'),
    });
    const { result } = renderHook(() => useAiChat());

    let succeeded!: boolean;
    await act(async () => {
      succeeded = await result.current.runBankStatementAnalyzer({
        fileContents: 'statement contents',
        fileNames: ['statement.pdf'],
      });
    });

    expect(succeeded).toBe(false);
    expect(result.current.messages.at(-1)?.metadata).toMatchObject({
      is_error: true,
      scenario_code: 'bank_statement_analysis',
      launcher_title_snapshot: 'Анализ выписки',
    });
    expect(result.current.messages.at(-1)?.content).toContain('Выписку не удалось распознать');
    expect(result.current.messages.at(-1)?.content).toContain('statement.pdf');
    expect(result.current.messages.at(-1)?.content).toContain('Что сделать');
    expect(result.current.messages.at(-1)?.content).toContain('XLSX или CSV');
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
