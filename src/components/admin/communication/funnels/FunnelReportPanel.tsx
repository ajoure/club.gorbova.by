import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { errorText, type FunnelReport, type FunnelReportRow } from './contracts';
import { FunnelActorBoundary, runFunnelRpc, useFunnelActor } from './FunnelActor';

type DetailedReport = FunnelReport & {
  summary: FunnelReport['summary'] & { converted?: number };
  block_stats?: { block_id: string; block_text?: string; received: number; recipients?: number; failed?: number }[];
  button_stats?: { block_id: string; button_id: string; text?: string; kind?: string; clicked: number; unique_clicked?: number }[];
  transitions?: { source_block_id: string; target_block_id: string; received: number; source_received: number; conversion: number }[];
};
const statuses: Record<string, string> = { scheduled: 'Запланировано', activated: 'Запуск активирован', active: 'Проходит', completed: 'Завершена', stopped: 'Остановлена', error: 'Ошибка', skipped: 'Пропущен', queued: 'В очереди', sending: 'Отправляется', sent: 'Отправлено', failed: 'Ошибка', unknown: 'Результат неизвестен', clicked: 'Переход к сообщению', button_pressed: 'Нажата кнопка', callback_pending: 'Переход ожидает подтверждения отправки', url_clicked: 'Переход по ссылке', finished: 'Завершил воронку кнопкой', enrolled: 'Начало участия', restarted: 'Перезапуск' };
const reasons: Record<string, string> = { waiting_until_due: 'Ожидает назначенного времени запуска', prior_delivery_unresolved: 'Предыдущая отправка ещё не подтверждена. Запуск ожидает проверки.', recipient_binding_changed: 'Связь с Telegram-получателем изменилась. Отправка остановлена.', no_available_telegram_dialog: 'Нет доступного Telegram-диалога', already_active: 'Уже проходит эту воронку', explicit_restart: 'Перезапущена с первого сообщения', delivery_failed: 'Не удалось отправить сообщение', telegram_rejected: 'Telegram отклонил отправку', telegram_unconfirmed: 'Telegram не подтвердил результат', transport_unknown: 'Результат передачи неизвестен', preflight_failed: 'Не пройдена проверка перед отправкой', bot_blocked: 'Пользователь заблокировал бота', chat_unavailable: 'Диалог с пользователем недоступен', invalid_message: 'Telegram не принял формат сообщения', media_unavailable: 'Изображение недоступно для отправки', rate_limited: 'Telegram временно ограничил частоту отправки', bot_unavailable: 'Выбранный бот недоступен', finished_by_button: 'Завершил воронку кнопкой' };
const unnamedMessage = 'Сообщение без названия', unnamedButton = 'Кнопка без названия';
const buttonKind: Record<string, string> = { url: 'Ссылка', next: 'Следующее сообщение', finish: 'Завершение воронки' };
const plain = (text?: string) => (text || '').replace(/[*_`]/g, '').split('\n')[0].slice(0, 80);
const nameOr = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
interface ReportLabels { blocks: Map<string, string>; buttons: Map<string, string> }
function rows(items: FunnelReportRow[], type: 'enrollment' | 'delivery' | 'event', labels?: ReportLabels) {
  return items.map((r, i) => <li key={r.id || `${type}-${i}`} className="min-w-0 rounded-lg border bg-card p-3 text-sm break-words space-y-1">
    <p className="font-medium">{r.funnel_name || r.profile_name || r.text || r.current_block || labels?.blocks.get(r.block_id || '') || unnamedMessage} · {statuses[r.status || r.kind || ''] || r.status || r.kind}</p>
    {r.profile_name && <p>{r.profile_name}</p>}{r.current_block && <p className="line-clamp-2 text-muted-foreground" title={r.current_block}>Текущий шаг: {r.current_block}</p>}
    {r.text && <p className="whitespace-pre-wrap">{r.text}</p>}
    {r.buttons?.length ? <p>Кнопки: {r.buttons.map(b => nameOr(b.text, unnamedButton)).join(' · ')}</p> : null}
    {(r.reason || r.error_code) && <p className="text-destructive">Причина: {reasons[r.reason || r.error_code || ''] || 'Не удалось подтвердить отправку. Проверьте историю этого сообщения.'}</p>}
    {(r.button_id || r.detail?.button_id) && <p>Кнопка: {nameOr(r.detail?.button_text, labels?.buttons.get(String(r.button_id || r.detail?.button_id)) || unnamedButton)}</p>}
    {r.created_at && <time className="block text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString('ru-RU')}</time>}
  </li>);
}
function EnrollmentHistory({ enrollmentId }: { enrollmentId: string }) {
  const actor = useFunnelActor();
  const [offset, setOffset] = useState(0), [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ['telegram-funnel-history', actor.actorId, actor.generation, enrollmentId, offset], enabled: open, retry: false, queryFn: () => actor.rpc<{ total: number; deliveries: (FunnelReportRow & { block?: { text?: string; buttons?: FunnelReportRow['buttons'] }; events?: FunnelReportRow[] })[] }>('telegram_funnel_history', { p_enrollment: enrollmentId, p_offset: offset, p_limit: 50 }) });
  return <div className="mt-2"><Button size="sm" variant="outline" onClick={() => setOpen(!open)}>{open ? 'Скрыть сообщения' : 'Все сообщения и нажатия участника'}</Button>{open && <div className="space-y-2 mt-2">{query.isLoading && <p role="status">Загружаем сообщения…</p>}{query.error && <p role="alert">{errorText(query.error)}</p>}{query.data && <><ul className="space-y-2">{query.data.deliveries.map(d => {
    const labels = { blocks: new Map([[d.block_id || '', nameOr(d.block?.text, unnamedMessage)]]), buttons: new Map((d.block?.buttons || []).map(b => [b.id, nameOr(b.text, unnamedButton)])) };
    return <li key={d.id}><ul>{rows([{ ...d, text: d.block?.text, buttons: d.block?.buttons }], 'delivery', labels)}{rows(d.events || [], 'event', labels)}</ul></li>;
  })}</ul><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Предыдущие сообщения</Button><Button size="sm" variant="outline" disabled={offset + 50 >= query.data.total} onClick={() => setOffset(offset + 50)}>Следующие сообщения</Button></div></>}</div>}</div>;
}
export function FunnelReportPanel({ funnelId, profileId, launchId, blockOrder }: { funnelId?: string; profileId?: string; launchId?: string; blockOrder?: string[] }) {
  const actor = useFunnelActor();
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['telegram-funnel-report', actor.actorId, actor.generation, funnelId, profileId, launchId, offset], queryFn: () => actor.rpc<DetailedReport>('telegram_funnel_report', { p_funnel: funnelId || null, p_profile: profileId || null, p_launch: launchId || null, p_offset: offset, p_limit: 50 }), retry: false,
    // Sends and presses arrive after the launch; keep the open report current without a manual refresh.
    refetchInterval: 20_000, refetchOnWindowFocus: true });
  const s = query.data?.summary;
  const blockStats = [...(query.data?.block_stats || [])].sort((a, b) => { const ia = blockOrder?.indexOf(a.block_id) ?? -1, ib = blockOrder?.indexOf(b.block_id) ?? -1; return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib); });
  const finishedCount = (query.data?.button_stats || []).filter(b => b.kind === 'finish').reduce((n, b) => n + (b.unique_clicked ?? b.clicked), 0);
  const labels: ReportLabels = { blocks: new Map((query.data?.block_stats || []).map(b => [b.block_id, nameOr(b.block_text, unnamedMessage)])), buttons: new Map((query.data?.button_stats || []).map(b => [b.button_id, nameOr(b.text, unnamedButton)])) };
  return <Card className="min-w-0" aria-label="История и статистика воронок">
    <CardHeader className="space-y-3 p-4 sm:p-6">
    <div className="flex flex-wrap justify-between gap-2"><CardTitle className="text-base">Воронки · история и статистика</CardTitle><div className="flex flex-wrap items-center gap-2">{query.dataUpdatedAt ? <span className="text-xs text-muted-foreground">Обновлено {new Date(query.dataUpdatedAt).toLocaleTimeString('ru-RU')}</span> : null}<Button size="sm" variant="outline" onClick={() => query.refetch()}>Обновить историю</Button></div></div>
    </CardHeader><CardContent className="min-w-0 space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
    {query.isLoading && <div role="status" className="space-y-3"><span className="sr-only">Загружаем историю…</span><Skeleton className="h-24 w-full" /><Skeleton className="h-36 w-full" /></div>}{query.error && <Alert variant="destructive"><AlertDescription>{errorText(query.error)}</AlertDescription></Alert>}
    {s && <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">{[['Вошли', s.entered], ['Пропущены', s.skipped], ['Сообщений отправлено', s.sent], ['Ошибок', s.failed], ['Результат неизвестен', s.unknown], ['Внутренних нажатий', s.clicked], ['Переходов по ссылкам', s.url_clicked], ...(finishedCount ? [['Завершили кнопкой', finishedCount]] : []), ['Конверсия в переход', s.converted === undefined ? 'Нет данных' : `${s.entered ? Math.round(s.converted / s.entered * 100) : 0}%`]].map(([label, value]) => <div key={String(label)} className="min-w-0 rounded-lg border bg-muted/30 p-3"><dt className="text-xs text-muted-foreground break-words">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value ?? 'Нет данных'}</dd></div>)}</dl>}
    {!!blockStats.length && <div><h4 className="font-medium">По каждому сообщению</h4><ol className="space-y-2 text-sm">{blockStats.map(b => { const order = blockOrder?.indexOf(b.block_id) ?? -1; const buttons = (query.data?.button_stats || []).filter(x => x.block_id === b.block_id); return <li key={b.block_id} className="rounded border p-2">
      <p className="font-medium break-words">{order >= 0 ? `${order + 1}. ` : ''}{plain(b.block_text) || unnamedMessage}</p>
      <p>Отправлено: <strong>{b.received}</strong>{b.recipients === undefined ? '' : ` (${b.recipients} чел.)`}{b.failed ? ` · ошибок: ${b.failed}` : ''}</p>
      {buttons.length ? <ul className="mt-1 space-y-0.5">{buttons.map(x => <li key={x.button_id} className="break-words">«{nameOr(x.text, unnamedButton)}» · {buttonKind[x.kind || ''] || 'Кнопка'}: <strong>{x.clicked}</strong> нажатий{x.unique_clicked === undefined ? '' : `, ${x.unique_clicked} чел.`}</li>)}</ul> : <p className="text-muted-foreground">Без кнопок</p>}
    </li>; })}</ol></div>}
    {!!query.data?.transitions?.length && <div><h4 className="font-medium">Конверсия между сообщениями</h4><ul className="text-sm">{query.data.transitions.map(t => <li key={`${t.source_block_id}-${t.target_block_id}`}>{labels.blocks.get(t.source_block_id) || unnamedMessage} → {labels.blocks.get(t.target_block_id) || unnamedMessage}: {t.received} / {t.source_received}, {Math.round(t.conversion * 100)}%</li>)}</ul></div>}
    {s?.unknown ? <p className="text-sm text-amber-700">Для неизвестного результата сначала проверяется та же отправка. Повторная отправка автоматически не выполняется.</p> : null}
    {query.data && <><h4 className="font-medium">Участники и текущие шаги</h4>{query.data.enrollments.length ? <div className="space-y-3">{query.data.enrollments.map((e, i) => <div key={e.id || i}><ul>{rows([e], 'enrollment')}</ul>{e.id && <EnrollmentHistory enrollmentId={e.id}/>}</div>)}</div> : <p className="text-sm text-muted-foreground">Запусков пока нет.</p>}
      <details><summary>Отправленные сообщения и ошибки</summary><ul className="space-y-2 mt-2">{rows(query.data.deliveries, 'delivery', labels)}</ul></details>
      <details><summary>История нажатий</summary><ul className="space-y-2 mt-2">{rows(query.data.events, 'event', labels)}</ul></details>
      <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Назад</Button><span className="text-sm">{query.data.total ? offset + 1 : 0}–{Math.min(offset + 50, query.data.total)} из {query.data.total}</span><Button size="sm" variant="outline" disabled={offset + 50 >= query.data.total} onClick={() => setOffset(offset + 50)}>Далее</Button></div></>}
  </CardContent></Card>;
}
export function ContactFunnelHistory({ profileId }: { profileId: string }) {
  return <FunnelActorBoundary><ContactFunnelHistoryContent profileId={profileId}/></FunnelActorBoundary>;
}
function ContactFunnelHistoryContent({ profileId }: { profileId: string }) {
  const actor = useFunnelActor();
  const [tags, setTags] = useState<string | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const tagQuery = useQuery({ queryKey: ['telegram-funnel-tags', actor.actorId, actor.generation, profileId], queryFn: async () => (await actor.read<{ tag: string }[]>(client => client.from('telegram_funnel_profile_tags').select('tag').eq('profile_id', profileId).order('tag'))).map(r => String(r.tag)), retry: false });
  return <div className="space-y-3"><FunnelReportPanel key={profileId} profileId={profileId}/>
    <Card><CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3"><CardTitle className="text-base">Метки для сегментов</CardTitle></CardHeader><CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0"><label className="text-sm font-medium">Ручные метки для сегментов<Input aria-label="Ручные метки контакта" disabled={tagQuery.isLoading || !!tagQuery.error} value={tags ?? tagQuery.data?.join(', ') ?? ''} onChange={e => setTags(e.target.value)}/></label><p className="text-xs text-muted-foreground">Метки через запятую. Они не подтверждают оплату или участие.</p>
      <Button size="sm" variant="outline" disabled={saving || tags === null || !!tagQuery.error} onClick={async () => { setSaving(true); setError(''); try { const lease = await actor.lease(); await runFunnelRpc(lease, 'telegram_funnel_set_tags', { p_profile: profileId, p_tags: [...new Set((tags || '').split(',').map(s => s.trim()).filter(Boolean))] }); await lease.run(() => tagQuery.refetch()); setTags(null); } catch (e) { setError(errorText(e)); } finally { setSaving(false); } }}>Сохранить метки</Button>
      {(error || tagQuery.error) && <Alert variant="destructive"><AlertDescription>{error || errorText(tagQuery.error)}</AlertDescription></Alert>}</CardContent></Card>
  </div>;
}
