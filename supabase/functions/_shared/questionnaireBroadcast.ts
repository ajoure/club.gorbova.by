type Block = { id?: string; type?: string; content?: Record<string, unknown> };
export type QuestionnaireSource = { id: string; workspace_id: string; status: string; blocks: unknown };
export type QuestionnaireThanks = QuestionnaireSource & { slug: string };
const tokens = ['{{questionnaire.channel_url}}', '{{questionnaire.personal_chat_url}}'];
export function hasQuestionnaireLinks(message: string): boolean {
  return message.includes('{{questionnaire.');
}
function blocks(value: unknown): Block[] {
  return Array.isArray(value) ? value.filter(v => v && typeof v === 'object' && !Array.isArray(v)) : [];
}
export function questionnaireThanksSlug(source: QuestionnaireSource, blockId: string, origin: string): string {
  const forms = blocks(source.blocks).filter(b => b.id === blockId && b.type === 'form');
  if (source.status !== 'published' || forms.length !== 1 || forms[0].content?.questionnaire_first !== true || forms[0].content?.auth_mode !== true) throw new Error('questionnaire_source_invalid');
  const redirect = forms[0].content?.redirectUrl;
  if (typeof redirect !== 'string' || !redirect.trim()) throw new Error('questionnaire_thanks_missing');
  const url = new URL(redirect, origin);
  if (url.origin !== new URL(origin).origin || url.username || url.password || !/^https?:$/.test(url.protocol)) throw new Error('questionnaire_thanks_external');
  const slug = url.pathname.replace(/^\/+|\/+$/g, '');
  if (!slug || slug.includes('/')) throw new Error('questionnaire_thanks_invalid');
  return slug;
}
export function renderQuestionnaireBroadcast(message: string, source: QuestionnaireSource, blockId: string, thanks: QuestionnaireThanks, origin: string) {
  const slug = questionnaireThanksSlug(source, blockId, origin);
  if (thanks.status !== 'published' || thanks.workspace_id !== source.workspace_id || thanks.slug !== slug) throw new Error('questionnaire_thanks_invalid');
  const bonuses = blocks(thanks.blocks).filter(b => b.type === 'questionnaire_bonuses');
  if (bonuses.length !== 1 || bonuses[0].content?.source_page_id !== source.id || bonuses[0].content?.source_block_id !== blockId) throw new Error('questionnaire_bonuses_ambiguous');
  const { channel_url: channel, personal_chat_url: personal } = bonuses[0].content!;
  if (typeof channel !== 'string' || !/^https:\/\/t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+$/.test(channel) ||
      typeof personal !== 'string' || !/^https:\/\/t\.me\/m\/[A-Za-z0-9_-]+$/.test(personal)) throw new Error('questionnaire_bonus_url_invalid');
  // Markdown links preserve the exact URL, including underscores and invite '+'.
  let rendered = message.split(tokens[0]).join(`[Telegram-канал](${channel})`).split(tokens[1]).join(`[Переписка с Катериной](${personal})`);
  if (/\{\{[^}]*\}\}/.test(rendered)) throw new Error('questionnaire_message_unresolved');
  return { message: rendered, protectedUrls: [channel, personal] };
}
export function preserveQuestionnaireUrls<T extends { clickTokens: Map<string, string> }>(tracking: T, urls: string[]): T {
  const protectedSet = new Set(urls);
  return { ...tracking, clickTokens: new Map([...tracking.clickTokens].filter(([url]) => !protectedSet.has(url))) };
}
