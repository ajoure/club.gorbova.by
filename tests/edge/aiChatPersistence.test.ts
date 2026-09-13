import { expect, it, vi } from 'vitest';
import { persistAiChatExchange } from '../../supabase/functions/_shared/ai-chat-persistence';
const exchange = { conversationId: 'conversation', userId: 'user', userContent: 'Question', assistantContent: 'Answer', assistantMetadata: { ai_mode: 'chat' } };
function client(result: any) {
  const insert = vi.fn(() => ({ select: async () => result }));
  return { from: () => ({ insert }), insert };
}
it('writes both messages atomically and keeps user before assistant after reload', async () => {
  const db = client({ data: [{ id: 'u' }, { id: 'a' }], error: null });
  await persistAiChatExchange(db, exchange, new Date('2026-09-13T10:00:00Z'));
  expect(db.insert).toHaveBeenCalledTimes(1);
  const rows = db.insert.mock.calls[0][0];
  expect(rows.map((row: any) => row.role)).toEqual(['user', 'assistant']);
  expect(rows[0].created_at < rows[1].created_at).toBe(true);
});
it.each([{ data: null, error: { message: 'private DB details' } }, { data: [{ id: 'one' }], error: null }])('does not acknowledge an incomplete exchange', async result => {
  await expect(persistAiChatExchange(client(result), exchange)).rejects.toThrow('Не удалось сохранить ответ');
});
