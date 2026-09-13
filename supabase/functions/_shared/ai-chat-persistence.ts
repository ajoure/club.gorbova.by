type Exchange = {
  conversationId: string;
  userId: string;
  userContent?: string;
  userMetadata?: unknown;
  assistantContent: string;
  assistantMetadata: unknown;
};

export async function persistAiChatExchange(client: any, exchange: Exchange, now = new Date()): Promise<void> {
  const rows = [
    ...(exchange.userContent !== undefined ? [{
      conversation_id: exchange.conversationId, user_id: exchange.userId, role: 'user',
      content: exchange.userContent, metadata: exchange.userMetadata ?? null,
      created_at: now.toISOString(),
    }] : []),
    { conversation_id: exchange.conversationId, user_id: exchange.userId, role: 'assistant',
      content: exchange.assistantContent, metadata: exchange.assistantMetadata,
      // Equal database defaults would make history order ambiguous after an atomic INSERT.
      created_at: new Date(now.getTime() + 1).toISOString(),
    },
  ];
  const { data, error } = await client.from('ai_chat_messages').insert(rows).select('id');
  if (error || data?.length !== rows.length) {
    throw new Error('Не удалось сохранить ответ AI. Проверьте историю перед повторным запросом.');
  }
}
