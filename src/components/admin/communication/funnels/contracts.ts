import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
export { parseTelegramFunnelSegment } from '../../../../../supabase/functions/_shared/telegram-funnel-segments';
export type { TelegramFunnelSegment, TelegramFunnelSegmentNode } from '../../../../../supabase/functions/_shared/telegram-funnel-segments';

// Additive managed schema: keep contracts outside generated types.ts until Cloud sync.
export const funnelDb = supabase as unknown as SupabaseClient;
export type FunnelButton = { id: string; text: string } & ({ kind: 'url'; url: string } | { kind: 'next'; target_block_id: string } | { kind: 'finish'; tag?: string | null });
export interface FunnelBlock { next_step?: { at: string; target_block_id: string } | null; channel?: 'telegram' | 'sms'; id: string; text: string; image_path?: string | null; buttons: FunnelButton[] }
export interface FunnelRecord { id: string; name: string; status: 'draft' | 'active' | 'stopped'; revision: number; start_block_id: string; blocks: FunnelBlock[]; created_at?: string; created_by?: string }
export interface FunnelLaunch { id: string; funnel_id: string; bot_id: string | null; scheduled_for: string; status: string; created_at: string }
export interface FunnelReportRow { id?: string; enrollment_id?: string; funnel_name?: string; profile_name?: string; status?: string; reason?: string | null; current_block?: string; block_id?: string; text?: string; buttons?: FunnelButton[]; created_at?: string; kind?: string; button_id?: string; error_code?: string | null; detail?: Record<string, unknown> }
export interface FunnelReport { total: number; enrollments: FunnelReportRow[]; deliveries: FunnelReportRow[]; events: FunnelReportRow[]; summary: { entered: number; skipped: number; sent: number; failed: number; unknown: number; clicked: number; url_clicked: number }; blocks?: unknown[]; buttons?: unknown[] }
export interface NamedOption { id: string; name: string; product_id?: string }
export interface PendingFunnelLaunch { id: string; actor_id: string; args: Record<string, unknown>; selfTest: boolean; queue?: { id: string; args: Record<string, unknown> }[] }
const pendingKey = (actorId: string, funnelId: string) => `telegram-funnel-pending:${actorId}:${funnelId}`;
export function readPendingFunnelLaunch(actorId: string, funnelId: string): PendingFunnelLaunch | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(actorId, funnelId)); if (!raw) return null;
    const value = JSON.parse(raw) as PendingFunnelLaunch;
    if (!value || value.actor_id !== actorId || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id) || typeof value.selfTest !== 'boolean'
      || !value.args || value.args.p_id !== value.id || value.args.p_funnel !== funnelId) throw Error();
    if (!value.selfTest) parseTelegramFunnelSegmentForPending(value.args.p_filters);
    if (value.queue !== undefined && (value.selfTest || !Array.isArray(value.queue) || value.queue.length > 20 || value.queue.some(q => !q || typeof q.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(q.id) || !q.args || q.args.p_id !== q.id || q.args.p_funnel !== funnelId || (parseTelegramFunnelSegmentForPending(q.args.p_filters), false)))) throw Error();
    return value;
  } catch { return null; }
}
// Import separately from the re-export so the pending snapshot is validated as well.
import { parseTelegramFunnelSegment as parseTelegramFunnelSegmentForPending } from '../../../../../supabase/functions/_shared/telegram-funnel-segments';
export function rememberPendingFunnelLaunch(actorId: string, funnelId: string, value: PendingFunnelLaunch | null) {
  if (value) sessionStorage.setItem(pendingKey(actorId, funnelId), JSON.stringify(value));
  else sessionStorage.removeItem(pendingKey(actorId, funnelId));
}
export const makeBlock = (): FunnelBlock => ({ id: crypto.randomUUID(), text: '', buttons: [] });
export const makeFunnel = (): FunnelRecord => { const b = makeBlock(); return { id: crypto.randomUUID(), name: '', status: 'draft', revision: 0, start_block_id: b.id, blocks: [b] }; };
export const blockTitle = (b: FunnelBlock, i: number) => `${i + 1}. ${b.text.replace(/[*_`]/g, '').split('\n')[0].slice(0, 45) || 'Новое сообщение'}`;
export function graphErrors(funnel: FunnelRecord): string[] {
  const errors: string[] = [];
  if (!funnel.name.trim()) errors.push('Укажите название воронки.');
  const ids = new Set(funnel.blocks.map(b => b.id));
  if (!ids.has(funnel.start_block_id)) errors.push('Выберите стартовое сообщение.');
  if (ids.size !== funnel.blocks.length) errors.push('Повторяются ID сообщений.');
  for (const [i, block] of funnel.blocks.entries()) {
    if (block.next_step && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(block.next_step.at) || block.next_step.target_block_id === block.id || !funnel.blocks.some(b => b.id === block.next_step?.target_block_id && (b.channel || 'telegram') === (block.channel || 'telegram')) || block.buttons.some(b => b.kind === 'next'))) errors.push(`Сообщение ${i + 1}: выберите время и другое сообщение того же канала; уберите кнопки перехода.`);
    const visited = new Set<string>(); let cursor: FunnelBlock | undefined = block;
    while (cursor?.next_step) { if (visited.has(cursor.id)) { errors.push(`Сообщение ${i + 1}: расписание не должно образовывать цикл.`); break; } visited.add(cursor.id); cursor = funnel.blocks.find(b => b.id === cursor?.next_step?.target_block_id); }
    if (block.channel === 'sms') {
      if (!block.text.trim() || block.text.length > 1000) errors.push(`Сообщение ${i + 1}: текст SMS должен содержать 1–1000 символов.`);
      if (block.image_path || block.buttons.length) errors.push(`Сообщение ${i + 1}: SMS не поддерживает изображения и интерактивные кнопки.`);
    }
    if (!block.text.trim() && !block.image_path) errors.push(`Сообщение ${i + 1}: добавьте текст или изображение.`);
    if (block.text.length > 4096) errors.push(`Сообщение ${i + 1}: превышен лимит 4096 символов.`);
    for (const button of block.buttons) {
      if (!button.text.trim() || button.text.length > 64) errors.push(`Сообщение ${i + 1}: текст кнопки должен содержать 1–64 символа.`);
      if (button.kind === 'next' && !ids.has(button.target_block_id)) errors.push(`Сообщение ${i + 1}: выберите существующее целевое сообщение.`);
      if (button.kind === 'finish' && button.tag && (button.tag !== button.tag.trim() || button.tag.length > 80 || [...button.tag].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))) errors.push(`Сообщение ${i + 1}: метка кнопки завершения — до 80 символов, без пробелов по краям.`);
      if (button.kind === 'url') {
        try { const url = new URL(button.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error(); }
        catch { errors.push(`Сообщение ${i + 1}: укажите корректную ссылку http/https.`); }
      }
    }
  }
  return errors;
}
export const errorText = (error: unknown) => {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  if (message === 'telegram_funnel_segment_selection_timeout') return 'Проверка получателей заняла слишком много времени. Отправка не запускалась. Повторите проверку позже.';
  if (['telegram_funnel_segment_selection_unavailable', 'telegram_funnel_segment_selection_failed'].includes(message)) return 'Не удалось проверить получателей. Отправка не запускалась. Повторите проверку позже.';
  if (message.startsWith('telegram_funnel_segment_')) return 'Проверьте условия сегмента: все продукты, потоки и значения должны быть выбраны. Пустые, неизвестные или слишком сложные условия не допускаются.';
  const messages: Record<string, string> = { funnel_revision_changed: 'Версия воронки изменилась. Загрузите актуальную воронку перед сохранением.', communication_manage_required: 'Недостаточно прав для управления рассылками.', funnel_bot_unavailable: 'Выбранный бот недоступен. Обновите список ботов.', funnel_no_self_profile: 'Ваш профиль не найден. Проверка на себе не запущена.', funnel_no_self_dialog: 'Нет доступного диалога с выбранным ботом. Сначала подключите свой Telegram.', funnel_finish_tag_invalid: 'Метка кнопки завершения: до 80 символов, без пробелов по краям.', funnel_button_kind_invalid: 'Неизвестный тип кнопки. Обновите страницу.' };
  return messages[message] || message || 'Не удалось выполнить действие. Повторите проверку.';
};

/** SMS uses the same bounded page contract with phone reachability in has_dialog. */
export function parseSmsFunnelAudience(value: unknown, offset = 0, limit = 50): import('../../../../../supabase/functions/_shared/telegram-funnel-segments').TelegramFunnelAudiencePage {
  const fail = () => { throw Error('Не удалось проверить получателей SMS. Отправка не запускалась.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const p = value as Record<string, unknown>, uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if (!Number.isSafeInteger(p.total) || Number(p.total) < 0 || !Number.isSafeInteger(p.available_count) || Number(p.available_count) < 0 || Number(p.available_count) > Number(p.total) || !Array.isArray(p.recipients) || p.recipients.length > limit || p.recipients.length > Math.max(0, Number(p.total) - offset)) return fail();
  const seen = new Set();
  for (const r of p.recipients) {
    if (!r || typeof r !== 'object' || !uuid(r.profile_id) || seen.has(r.profile_id) || !(r.user_id === null || uuid(r.user_id)) || !(r.full_name === null || typeof r.full_name === 'string') || typeof r.has_dialog !== 'boolean') return fail();
    seen.add(r.profile_id);
  }
  return p as unknown as import('../../../../../supabase/functions/_shared/telegram-funnel-segments').TelegramFunnelAudiencePage;
}
