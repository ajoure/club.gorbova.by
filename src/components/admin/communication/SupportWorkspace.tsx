import SupportWebWorkspace from "./SupportWebWorkspace";
import { useEffect, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ContactTelegramChat } from '@/components/admin/ContactTelegramChat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useAuth } from '@/contexts/AuthContext';
import { latestObservedIncomingBoundary, telegramMessageCacheKey } from '@/lib/telegramChatCache';

type Bot = { id: string; label: string; username: string | null };
type Dialog = { user_id: string; display_name: string; telegram_user_id: number | null; telegram_username: string | null;
  can_reply: boolean; last_message_preview: string | null; unread_count: number; latest_incoming_id: string;
  assignee_user_id: string | null; assignee_name: string | null };
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as any, args as any);
  if (error) throw error;
  return data as T;
}
export default function SupportWorkspace() {
  const [params] = useSearchParams();
  return params.get('channel') === 'web' ? <SupportWebWorkspace /> : <SupportBotWorkspace />;
}
function SupportBotWorkspace() {
  const [params, setParams] = useSearchParams();
  const cache = useQueryClient();
  const access = useAdminAccess();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [historyScope, setHistoryScope] = useState<string | null>(null);
  useEffect(() => {
    // Do not retain a combined history from a previous operator-workspace visit.
    const roots = ['telegram-messages', 'telegram-messages-lean', 'telegram-messages-full-at', 'contact-center-unanswered'];
    const predicate = (q: { queryKey: readonly unknown[] }) => roots.includes(String(q.queryKey[0])) && !String(q.queryKey[2]).startsWith('support-bot:');
    void cache.cancelQueries({ predicate }).then(() => cache.removeQueries({ predicate }));
  }, [cache]);
  const channels = useQuery({ queryKey: ['support-bot-channels'], queryFn: () => rpc<Bot[]>('support_bot_channels_v1'), refetchInterval: 15_000 });
  const selectedBot = params.get('bot');
  // An unknown/deactivated explicit bot never falls back to a different sender.
  const bot = selectedBot ? channels.data?.find(b => b.id === selectedBot) : channels.data?.[0];
  const selectedUser = params.get('chat');
  const assignees = useQuery({ queryKey: ['contact-center-assignees'],
    queryFn: () => rpc<Array<{ user_id: string; display_name: string }>>('get_contact_center_assignees_v1'), staleTime: 60_000 });
  const dialogs = useQuery({
    queryKey: ['support-bot-dialogs', bot?.id, search, unreadOnly, offset], enabled: !!bot,
    queryFn: () => rpc<Dialog[]>('support_bot_dialogs_v1', { p_bot_id: bot!.id, p_search: search || null, p_unread_only: unreadOnly, p_limit: 50, p_offset: offset }),
    refetchInterval: 15_000,
  });
  const detail = useQuery({
    queryKey: ['support-bot-dialog', bot?.id, selectedUser], enabled: !!bot && !!selectedUser,
    queryFn: async () => (await rpc<Dialog[]>('support_bot_dialogs_v1', { p_bot_id: bot!.id, p_search: selectedUser, p_limit: 1 }))[0] ?? null,
    refetchInterval: 15_000,
  });
  const dialog = detail.data;
  const currentScope = bot && dialog ? `${bot.id}:${dialog.user_id}` : null;
  const onHistoryReadyChange = useCallback((ready: boolean) => setHistoryScope(ready ? currentScope : null), [currentScope]);
  const blocked = !currentScope || historyScope !== currentScope || !access.canAccessSection('communication', 'manage') || channels.isError || detail.isError || !!(dialog?.assignee_user_id && dialog.assignee_user_id !== user?.id);
  const updateRoute = (botId?: string, userId?: string) => setParams({ tab: 'inbox', support_mode: '1', ...(botId ? { bot: botId } : {}), ...(userId ? { chat: userId } : {}) });
  const refresh = () => Promise.all([
    cache.invalidateQueries({ queryKey: ['support-bot-dialogs'] }),
    cache.invalidateQueries({ queryKey: ['support-bot-dialog'] }),
  ]);
  const assign = async () => {
    if (!bot || !dialog || busy || blocked || !assignee) return;
    const rows = cache.getQueryData<Array<{ id: string; created_at: string; direction: string }>>(telegramMessageCacheKey(dialog.user_id, `support-bot:${bot.id}`)) || [];
    const boundary = latestObservedIncomingBoundary(rows);
    const observed = rows.filter(r => r.direction === 'incoming' && r.created_at === boundary).sort((a,b) => b.id.localeCompare(a.id))[0];
    if (!observed) { toast.error('Сначала дождитесь загрузки истории вопроса'); return; }
    setBusy(true);
    try {
      const result = await rpc<{ assignment_id: string; created: boolean }>('support_bot_assign_v1', {
        p_user_id: dialog.user_id, p_bot_id: bot.id, p_observed_incoming_id: observed.id, p_assignee_user_id: assignee,
      });
      await refresh();
      if (!result.created) { toast.info('Назначение уже существует. Повторное уведомление не отправлено'); return; }
      const { data, error } = await supabase.functions.invoke('contact-center-assignment-notify', { body: { assignment_id: result.assignment_id, support_bot_id: bot.id } });
      if (error || data?.success !== true) toast.warning('Назначение сохранено, доставка уведомления не подтверждена');
      else toast.success('Менеджер назначен, уведомление доставлено');
    } catch { toast.error('Результат назначения не подтверждён. Обновите историю перед повтором'); }
    finally { setBusy(false); }
  };
  const setState = async (action: 'resolve' | 'reopen') => {
    if (!bot || !dialog || busy || blocked) return;
    const key = telegramMessageCacheKey(dialog.user_id, `support-bot:${bot.id}`);
    const rows = cache.getQueryData<Array<{ id: string; created_at: string; direction: string }>>(key) || [];
    const boundary = latestObservedIncomingBoundary(rows);
    const observed = rows.filter(r => r.direction === 'incoming' && r.created_at === boundary).sort((a,b) => b.id.localeCompare(a.id))[0];
    if (!observed) { toast.error('Сначала дождитесь загрузки истории вопроса'); return; }
    setBusy(true);
    try {
      const result = await rpc<{ remaining_unread: number }>('support_bot_set_state_v1', {
        p_user_id: dialog.user_id, p_bot_id: bot.id, p_observed_incoming_id: observed.id, p_action: action,
      });
      await Promise.all([refresh(), cache.invalidateQueries({ queryKey: key }), cache.invalidateQueries({ queryKey: ['contact-center-unanswered', dialog.user_id, `support-bot:${bot.id}`] })]);
      toast.success(result.remaining_unread ? 'Вопрос оставлен требующим ответа' : 'Вопрос отмечен решённым');
    } catch { toast.error('Статус не подтверждён. Обновите историю и проверьте новые сообщения перед повтором'); }
    finally { setBusy(false); }
  };
  return <div className="flex h-full min-h-0 flex-col p-2 md:p-4 gap-2" data-testid="support-workspace">
    <header className="flex flex-wrap items-center gap-2 shrink-0">
      <h1 className="text-base font-semibold">Служебная поддержка</h1>
      <select aria-label="Служебный бот" className="max-w-full rounded border bg-background p-2 text-sm" value={bot?.id || ''} onChange={e => { setOffset(0); updateRoute(e.target.value); }}>
        {!bot && <option value="">Выберите разрешённый канал</option>}
        {channels.data?.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
      <Button variant="outline" size="sm" onClick={() => setParams({ tab: 'inbox', support_mode: '1', channel: 'web' })}>Тикеты сайта</Button>
      <Button variant="ghost" size="sm" onClick={() => setParams({ tab: 'inbox' })}>Общий контакт-центр</Button>
    </header>
    <p className="text-xs text-muted-foreground shrink-0">Только служебные боты. Просмотр и отправка ответа сохраняют вопрос открытым до явного решения.</p>
    {(channels.isError || dialogs.isError || detail.isError) && <p role="alert" className="text-sm text-destructive">Не удалось проверить канал или загрузить обращения. Отправка недоступна до повторной проверки.</p>}
    <div className="flex min-h-0 flex-1 gap-3">
      <aside className={`${selectedUser ? 'hidden md:flex' : 'flex'} w-full md:w-72 shrink-0 min-h-0 flex-col gap-2`}>
        <Input aria-label="Поиск обращений" placeholder="Поиск клиента" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} />
        <div className="flex gap-2"><Button size="sm" variant={unreadOnly ? 'outline' : 'default'} onClick={() => { setUnreadOnly(false); setOffset(0); }}>Все</Button><Button size="sm" variant={unreadOnly ? 'default' : 'outline'} onClick={() => { setUnreadOnly(true); setOffset(0); }}>Требуют ответа</Button></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {dialogs.isLoading && <p className="p-3 text-sm">Загрузка…</p>}
          {dialogs.data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">Обращений нет</p>}
          {dialogs.data?.map(d => <button key={d.user_id} className={`w-full border-b p-3 text-left text-sm ${selectedUser === d.user_id ? 'bg-muted' : ''}`} onClick={() => updateRoute(bot!.id, d.user_id)}>
            <span className="block font-medium break-words">{d.display_name}{d.unread_count > 0 ? ' · Требует ответа' : ''}</span>
            <span className="block line-clamp-2 text-muted-foreground break-words">{d.last_message_preview || 'Вложение'}</span>
          </button>)}
        </div>
        <div className="flex justify-between"><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Назад</Button><Button variant="outline" size="sm" disabled={(dialogs.data?.length || 0) < 50} onClick={() => setOffset(offset + 50)}>Далее</Button></div>
      </aside>
      <section className={`${selectedUser ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 min-h-0 flex-col`}>
        <Button variant="ghost" size="sm" className="md:hidden self-start" onClick={() => updateRoute(bot?.id)}>К списку</Button>
        {dialog && bot ? <>
          <div className="flex flex-wrap gap-2 items-center border-b pb-2 mb-2 shrink-0">
            <span className="font-medium break-words">{dialog.display_name}</span>
            <span className="text-xs">{dialog.unread_count ? 'Требует ответа' : 'Решён'}</span>
            {dialog.assignee_name && <span className="text-xs">Ответственный: {dialog.assignee_name}</span>}
            <select aria-label="Передать менеджеру" className="max-w-full rounded border bg-background p-1 text-xs" value={assignee} disabled={busy || blocked} onChange={e => setAssignee(e.target.value)}>
              <option value="">Выберите менеджера</option>
              {assignees.data?.map(person => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={busy || blocked || !assignee} onClick={() => void assign()}>Передать менеджеру</Button>
            <Button size="sm" variant="outline" disabled={busy || blocked} onClick={() => void setState('reopen')}>Оставить нерешённым</Button>
            <Button size="sm" disabled={busy || blocked} onClick={() => void setState('resolve')}>Все вопросы решены</Button>
          </div>
          <div className="flex-1 min-h-0"><ContactTelegramChat userId={dialog.user_id} telegramUserId={dialog.telegram_user_id} telegramUsername={dialog.telegram_username} clientName={dialog.display_name} hidePhotoButton onHistoryReadyChange={onHistoryReadyChange} onMessageSent={() => { void refresh(); }}
            supportChannel={{ transport:'bot', channel_ref:bot.id, channel_key:`bot:${bot.id}`, bot_id:bot.id, label:bot.label, username:bot.username,
              first_name:null,last_name:null,business_connection_id:null,is_primary:true,can_reply:dialog.can_reply && !blocked && !channels.isError && !detail.isError,
              message_count:0,incoming_count:0,unanswered_count:dialog.unread_count }} /></div>
        </> : <p className="p-4 text-sm text-muted-foreground">{selectedUser ? 'Обращение загружается или недоступно в выбранном канале' : 'Выберите обращение'}</p>}
      </section>
    </div>
  </div>;
}
