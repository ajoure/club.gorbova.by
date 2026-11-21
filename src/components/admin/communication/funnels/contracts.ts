import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
export { parseTelegramFunnelSegment } from '../../../../../supabase/functions/_shared/telegram-funnel-segments';
export type { TelegramFunnelSegment, TelegramFunnelSegmentNode } from '../../../../../supabase/functions/_shared/telegram-funnel-segments';

// Additive managed schema: keep contracts outside generated types.ts until Cloud sync.
export const funnelDb = supabase as unknown as SupabaseClient;
export type FunnelButton = { id: string; text: string } & ({ kind: 'url'; url: string } | { kind: 'next'; target_block_id: string });
export interface FunnelBlock { id: string; text: string; image_path?: string | null; buttons: FunnelButton[] }
export interface FunnelRecord { id: string; name: string; status: 'draft' | 'active' | 'stopped'; revision: number; start_block_id: string; blocks: FunnelBlock[]; created_at?: string; created_by?: string }
export interface FunnelLaunch { id: string; funnel_id: string; bot_id: string; scheduled_for: string; status: string; created_at: string }
export interface FunnelReportRow { id?: string; enrollment_id?: string; funnel_name?: string; profile_name?: string; status?: string; reason?: string | null; current_block?: string; block_id?: string; text?: string; buttons?: FunnelButton[]; created_at?: string; kind?: string; button_id?: string; error_code?: string | null; detail?: Record<string, unknown> }
export interface FunnelReport { total: number; enrollments: FunnelReportRow[]; deliveries: FunnelReportRow[]; events: FunnelReportRow[]; summary: { entered: number; skipped: number; sent: number; failed: number; unknown: number; clicked: number; url_clicked: number }; blocks?: unknown[]; buttons?: unknown[] }
export interface NamedOption { id: string; name: string; product_id?: string }
export interface PendingFunnelLaunch { id: string; actor_id: string; args: Record<string, unknown>; selfTest: boolean }
const pendingKey = (actorId: string, funnelId: string) => `telegram-funnel-pending:${actorId}:${funnelId}`;
export function readPendingFunnelLaunch(actorId: string, funnelId: string): PendingFunnelLaunch | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(actorId, funnelId)); if (!raw) return null;
    const value = JSON.parse(raw) as PendingFunnelLaunch;
    if (!value || value.actor_id !== actorId || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id) || typeof value.selfTest !== 'boolean'
      || !value.args || value.args.p_id !== value.id || value.args.p_funnel !== funnelId) throw Error();
    if (!value.selfTest) parseTelegramFunnelSegmentForPending(value.args.p_filters);
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
    if (!block.text.trim() && !block.image_path) errors.push(`Сообщение ${i + 1}: добавьте текст или изображение.`);
    if (block.text.length > (block.image_path ? 1024 : 4096)) errors.push(`Сообщение ${i + 1}: превышен лимит ${block.image_path ? 1024 : 4096} символов.`);
    for (const button of block.buttons) {
      if (!button.text.trim() || button.text.length > 64) errors.push(`Сообщение ${i + 1}: текст кнопки должен содержать 1–64 символа.`);
      if (button.kind === 'next' && !ids.has(button.target_block_id)) errors.push(`Сообщение ${i + 1}: выберите существующее целевое сообщение.`);
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
  const messages: Record<string, string> = { funnel_revision_changed: 'Версия воронки изменилась. Загрузите актуальную воронку перед сохранением.', communication_manage_required: 'Недостаточно прав для управления рассылками.', funnel_bot_unavailable: 'Выбранный бот недоступен. Обновите список ботов.', funnel_no_self_profile: 'Ваш профиль не найден. Проверка на себе не запущена.', funnel_no_self_dialog: 'Нет доступного диалога с выбранным ботом. Сначала подключите свой Telegram.' };
  return messages[message] || message || 'Не удалось выполнить действие. Повторите проверку.';
};
