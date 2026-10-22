import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { TicketChat } from '@/components/support/TicketChat';
import type { TicketMessage } from '@/hooks/useTickets';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAccess } from '@/hooks/useAdminAccess';

type Ticket = { id: string; ticket_number: string; subject: string; status: string; has_unread_admin: boolean; assigned_to: string | null };
export default function SupportWebWorkspace() {
  const cache = useQueryClient();
  const { user } = useAuth();
  const access = useAdminAccess();
  const [params, setParams] = useSearchParams();
  const [includeClosed, setIncludeClosed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const selectedId = params.get('ticket');
  const [historyTicket,setHistoryTicket] = useState<string|null>(null);
  const onHistoryReadyChange = useCallback((ready:boolean)=>setHistoryTicket(ready ? selectedId : null),[selectedId]);
  const tickets = useQuery({ queryKey: ['support-web-tickets', includeClosed, offset], queryFn: async () => {
    const { data, error } = await supabase.rpc('support_web_tickets_v1' as any, { p_include_closed: includeClosed, p_limit:50, p_offset:offset } as any);
    if (error) throw error;
    return (data || []) as unknown as Ticket[];
  }, refetchInterval: 15_000 });
  const ticket = tickets.data?.find(t => t.id === selectedId);
  const select = (id?: string) => setParams({ tab:'inbox', support_mode:'1', channel:'web', ...(id ? { ticket:id } : {}) });
  const blocked = !selectedId || historyTicket !== selectedId || tickets.isError || tickets.isFetching || !access.canAccessSection('communication', 'manage') || !!(ticket?.assigned_to && ticket.assigned_to !== user?.id);
  const setState = async (action: 'resolve' | 'reopen' | 'close') => {
    if (!ticket || busy || blocked) return;
    const messages = cache.getQueryData<TicketMessage[]>(['ticket-messages',ticket.id,true,'web-only']);
    if (!messages) { toast.error('Сначала дождитесь загрузки истории'); return; }
    const last = messages.filter(m => m.author_type === 'user').at(-1);
    setBusy(true);
    try {
      const { error } = await supabase.rpc('support_web_set_state_v1' as any, {
        p_ticket_id:ticket.id,p_observed_incoming_id:last?.id ?? null,p_action:action,
      } as any);
      if (error) throw error;
      await cache.invalidateQueries({queryKey:['support-web-tickets']});
      toast.success(action === 'close' ? 'Тикет закрыт' : action === 'reopen' ? 'Вопрос оставлен нерешённым' : 'Вопрос отмечен решённым');
    } catch { toast.error('Статус не подтверждён. Проверьте новые сообщения перед повтором'); }
    finally { setBusy(false); }
  };
  return <div className="h-full min-h-0 flex flex-col gap-2 p-2 md:p-4">
    <header className="flex flex-wrap items-center gap-2"><h1 className="text-base font-semibold">Тикеты сайта</h1><Button variant="outline" size="sm" onClick={() => setParams({tab:'inbox',support_mode:'1'})}>Служебные боты</Button>
      <label className="text-xs"><input type="checkbox" checked={includeClosed} onChange={e => { setIncludeClosed(e.target.checked); setOffset(0); }} /> Включая закрытые</label></header>
    <p className="text-xs text-muted-foreground">Тикеты с Telegram-мостом или историей синхронизации исключены. Просмотр и промежуточный ответ не снимают отметку нерешённого вопроса.</p>
    {tickets.isError && <p role="alert" className="text-destructive text-sm">Не удалось проверить список тикетов</p>}
    <div className="min-h-0 flex-1 flex gap-3">
      <aside className={`${selectedId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 shrink-0 min-h-0`}>
        <div className="min-h-0 flex-1 overflow-y-auto">{tickets.data?.map(t => <button key={t.id} onClick={() => select(t.id)} className={`w-full border-b p-3 text-left text-sm ${t.id === selectedId ? 'bg-muted' : ''}`}>
          <span className="block text-xs">{t.ticket_number}{t.has_unread_admin ? ' · Требует ответа' : ''}</span><span className="break-words">{t.subject}</span>
        </button>)}{tickets.data?.length === 0 && <p className="p-3 text-sm">Обращений нет</p>}</div>
        <div className="flex justify-between"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0,offset-50))}>Назад</Button><Button size="sm" variant="outline" disabled={(tickets.data?.length || 0)<50} onClick={() => setOffset(offset+50)}>Далее</Button></div>
      </aside>
      <section className={`${selectedId ? 'flex' : 'hidden md:flex'} min-w-0 min-h-0 flex-1 flex-col`}>
        <Button className="md:hidden self-start" size="sm" variant="ghost" onClick={() => select()}>К списку</Button>
        {ticket ? <><div className="flex flex-wrap items-center gap-2 border-b pb-2"><span className="font-medium break-words">{ticket.ticket_number}: {ticket.subject}</span>
          <Button size="sm" variant="outline" disabled={busy || blocked} onClick={() => void setState('reopen')}>Оставить нерешённым</Button>
          <Button size="sm" variant="outline" disabled={busy || blocked} onClick={() => void setState('resolve')}>Все вопросы решены</Button>
          <Button size="sm" disabled={busy || blocked || ticket.has_unread_admin || ticket.status === 'closed'} onClick={() => void setState('close')}>Закрыть тикет</Button>
        </div><div className="min-h-0 flex-1"><TicketChat key={ticket.id} ticketId={ticket.id} isAdmin isolatedWeb onHistoryReadyChange={onHistoryReadyChange} readOnly={blocked} isClosed={ticket.status === 'closed' || ticket.status === 'resolved'} /></div></>
        : <p className="p-4 text-sm text-muted-foreground">Выберите доступный тикет из списка</p>}
      </section>
    </div>
  </div>;
}
