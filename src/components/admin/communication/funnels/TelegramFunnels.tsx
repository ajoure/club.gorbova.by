import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uploadToTelegramMedia } from '@/components/admin/chat/uploadToTelegramMedia';
import { TelegramMessagePreview } from '../TelegramMessagePreview';
import { resolveTelegramFunnelAudience, type TelegramFunnelAudiencePage } from '../../../../../supabase/functions/_shared/telegram-funnel-segments';
import { blockTitle, errorText, graphErrors, parseSmsFunnelAudience, makeBlock, makeFunnel, parseTelegramFunnelSegment, readPendingFunnelLaunch, rememberPendingFunnelLaunch, type PendingFunnelLaunch, type FunnelButton, type FunnelLaunch, type FunnelRecord, type NamedOption } from './contracts';
import { emptySegment, SegmentBuilder } from './SegmentBuilder';
import { FunnelGraph } from './FunnelGraph';
import { FunnelReportPanel } from './FunnelReportPanel';
import { FunnelActorBoundary, runFunnelRpc, useFunnelActor } from './FunnelActor';
const selectClass = 'h-10 max-w-full rounded-md border bg-background px-2 text-sm';

export function TelegramFunnels() {
  return <FunnelActorBoundary><TelegramFunnelsContent/></FunnelActorBoundary>;
}
function TelegramFunnelsContent() {
  const actor = useFunnelActor();
  const [selected, setSelected] = useState<FunnelRecord | null>(null);
  const list = useQuery({ queryKey: ['telegram-funnels', actor.actorId, actor.generation], queryFn: () => actor.read<FunnelRecord[]>(client => client.from('telegram_funnels').select('id,name,status,revision,start_block_id,blocks,created_at,created_by').order('updated_at', { ascending: false })), retry: false });
  return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">Воронки</h2><p className="text-sm text-muted-foreground">Telegram и SMS — выбранной базе. Следующий шаг запускается нажатием кнопки Telegram.</p></div><Button onClick={() => setSelected(makeFunnel())}>Создать воронку</Button></div>
    {list.error && <p role="alert">{errorText(list.error)}</p>}{list.isLoading && <p role="status">Загружаем воронки…</p>}
    <div className="flex flex-wrap gap-2">{list.data?.map(f => <Button key={f.id} variant={selected?.id === f.id ? 'default' : 'outline'} onClick={() => setSelected(f)}>{f.name} · {f.status === 'active' ? 'Активна' : f.status === 'draft' ? 'Черновик' : 'Остановлена'}</Button>)}</div>
    {selected ? <FunnelWorkspace key={selected.id} initial={selected} onSaved={f => { setSelected(f); void list.refetch(); }}/>: <p className="text-sm text-muted-foreground">Выберите воронку или создайте новую.</p>}
  </div>;
}
function FunnelWorkspace({ initial, onSaved }: { initial: FunnelRecord; onSaved: (f: FunnelRecord) => void }) {
  const actor = useFunnelActor();
  const [draft, setDraft] = useState(initial), [saved, setSaved] = useState(initial), [blockId, setBlockId] = useState(initial.start_block_id);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [imageUrl, setImageUrl] = useState('');
  const [segment, setSegment] = useState(() => emptySegment()), [bot, setBot] = useState(''), [extraBots, setExtraBots] = useState<string[]>([]), [restart, setRestart] = useState(false), [when, setWhen] = useState(''), [scheduled, setScheduled] = useState(false);
  const [preview, setPreview] = useState<{ key: string; generation: number; page: TelegramFunnelAudiencePage; offset: number; byBot: { id: string; available: number }[] } | null>(null), [checking, setChecking] = useState(false), [confirmed, setConfirmed] = useState(false), [launchId, setLaunchId] = useState<string | undefined>();
  const pendingLaunch = useRef<PendingFunnelLaunch | null>(readPendingFunnelLaunch(actor.actorId, initial.id));
  const textRef = useRef<HTMLTextAreaElement>(null), scopeRef = useRef('');
  const previewClock = useRef({ key: '', generation: 0 });
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ['telegram-funnel-products', actor.actorId, actor.generation], queryFn: () => actor.read<NamedOption[]>(client => client.from('products_v2').select('id,name').order('name')) });
  const flows = useQuery({ queryKey: ['telegram-funnel-flows', actor.actorId, actor.generation], queryFn: () => actor.read<NamedOption[]>(client => client.from('flows').select('id,name,product_id').order('start_date', { ascending: false })) });
  const segmentTags = useQuery({ queryKey: ['telegram-funnel-segment-tags', actor.actorId, actor.generation], queryFn: async () => [...new Set((await actor.read<{ tag: string }[]>(client => client.from('telegram_funnel_profile_tags').select('tag').order('tag').limit(5000))).map(r => String(r.tag)))], retry: false });
  const bots = useQuery({ queryKey: ['telegram-funnel-bots', actor.actorId, actor.generation], queryFn: async () => (await actor.rpc<{ id: string; bot_name: string; status: string }[]>('list_operational_telegram_bots', {})).filter(b => b.status === 'active') });
  const author = useQuery({ queryKey: ['telegram-funnel-author', actor.actorId, actor.generation, saved.created_by], enabled: !!saved.created_by, queryFn: async () => (await actor.read<{ full_name: string | null }[]>(client => client.from('profiles').select('full_name').eq('user_id', saved.created_by).limit(1)))?.[0]?.full_name });
  const launches = useQuery({ queryKey: ['telegram-funnel-launches', actor.actorId, actor.generation, draft.id], enabled: saved.revision > 0, queryFn: () => actor.read<FunnelLaunch[]>(client => client.from('telegram_funnel_launches').select('id,funnel_id,bot_id,scheduled_for,status,created_at').eq('funnel_id', draft.id).order('created_at', { ascending: false }).limit(100)) });
  const smsStart = saved.blocks.find(b => b.id === saved.start_block_id)?.channel === 'sms';
  const launchBots = smsStart ? [''] : bot ? [bot, ...extraBots.filter(id => id !== bot && bots.data?.some(b => b.id === id))] : [];
  const botName = (id: string | null) => !id ? 'SMS' : bots.data?.find(b => b.id === id)?.bot_name || 'Бот';
  const block = draft.blocks.find(b => b.id === blockId) || draft.blocks[0];
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved), errors = graphErrors(draft);
  const scope = JSON.stringify({ actor: actor.actorId, generation: actor.generation, funnel: saved.id, revision: saved.revision, segment, bot, launchBots }); scopeRef.current = scope;
  if (previewClock.current.key !== scope) previewClock.current = { key: scope, generation: previewClock.current.generation + 1 };
  const currentPreview = preview?.key === scope && preview.generation === previewClock.current.generation ? preview : null;
  useEffect(() => { setConfirmed(false); }, [scope, restart, when, scheduled, draft.revision, dirty]);
  useEffect(() => {
    let cancelled = false; setImageUrl('');
    if (block?.image_path) void actor.lease().then(lease => lease.run(() => lease.client.storage.from('telegram-media').createSignedUrl(block.image_path!, 300))).then(({ data, error }) => { if (!cancelled) { if (error) setError('Не удалось загрузить предпросмотр изображения.'); else setImageUrl(data?.signedUrl || ''); } }).catch(() => { if (!cancelled) setError('Предпросмотр изображения недоступен. Проверьте аккаунт.'); });
    return () => { cancelled = true; };
  }, [block?.image_path, actor.actorId, actor.generation]);
  const updateBlock = (patch: Partial<typeof block>) => setDraft(prev => ({ ...prev, blocks: prev.blocks.map(b => b.id === block.id ? { ...b, ...patch } : b) }));
  const updateButton = (id: string, next: FunnelButton) => updateBlock({ buttons: block.buttons.map(b => b.id === id ? next : b) });
  const formatText = (marker: string) => { const el = textRef.current; const start = el?.selectionStart ?? block.text.length, end = el?.selectionEnd ?? start; updateBlock({ text: block.text.slice(0, start) + marker + (block.text.slice(start, end) || 'текст') + marker + block.text.slice(end) }); };
  const save = async () => { setBusy(true); setError(''); setNotice(''); try {
    if (errors.length) throw Error(errors.join(' '));
    const lease = await actor.lease();
    const result = await runFunnelRpc<FunnelRecord>(lease, 'telegram_funnel_save', { p_id: draft.id, p_expected_revision: saved.revision, p_name: draft.name, p_start: draft.start_block_id, p_blocks: draft.blocks, p_status: draft.status });
    setDraft(result); setSaved(result); onSaved(result);
    if (result.status === 'stopped') {
      await lease.run(() => launches.refetch());
      await lease.run(() => qc.invalidateQueries({ queryKey: ['telegram-funnel-report', actor.actorId, actor.generation] }));
    }
    setNotice(result.status === 'stopped' ? 'Воронка сохранена. Все её текущие запуски остановлены. Отправка, которая уже началась, может завершиться.' : 'Воронка сохранена. Существующие запуски сохраняют свою версию сообщений.');
  } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const audience = async (offset = 0) => { setError(''); setChecking(true); const key = scope, generation = previewClock.current.generation, targets = launchBots; try {
    const lease = await actor.lease();
    // Each bot has its own dialogs. The segment and its order are the same, so one page is merged by contact.
    const pages = smsStart ? [parseSmsFunnelAudience(await runFunnelRpc<unknown>(lease, 'sms_funnel_audience', { p_segment: parseTelegramFunnelSegment(segment), p_offset: offset, p_limit: 50 }), offset)] : await Promise.all(targets.map(botId => lease.run(() => resolveTelegramFunnelAudience(lease.client, segment, { botId, offset, limit: 50 }))));
    if (pages.some(p => !p || !Number.isSafeInteger(p.total) || !Number.isSafeInteger(p.available_count) || p.available_count < 0 || p.available_count > p.total || !Array.isArray(p.recipients))) throw Error('Не удалось проверить получателей. Отправка не запускалась.');
    const [first] = pages, reachable = new Set(pages.flatMap(p => p.recipients.filter(r => r.has_dialog).map(r => r.profile_id)));
    const page = { ...first, recipients: first.recipients.map(r => ({ ...r, has_dialog: reachable.has(r.profile_id) })) };
    if (scopeRef.current === key && previewClock.current.generation === generation) setPreview({ key, generation, page, offset, byBot: targets.map((id, i) => ({ id, available: pages[i].available_count })) });
  } catch (e) { if (scopeRef.current === key && previewClock.current.generation === generation) setError(errorText(e)); } finally { setChecking(false); } };
  const launch = async (selfTest = false) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const lease = await actor.lease();
      if (!pendingLaunch.current) {
        if (selfTest ? dirty || !saved.revision || (!smsStart && !bot) : dirty || saved.status !== 'active' || !currentPreview || !confirmed) throw Error(selfTest ? 'Сохраните воронку и выберите бота для проверки на себе.' : 'Сохраните активную воронку, проверьте аудиторию и подтвердите запуск.');
        const date = !selfTest && scheduled ? new Date(when) : null;
        if (!selfTest && scheduled && (!date || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) throw Error('Выберите будущую дату и время запуска.');
        // Several bots = one launch per bot, in the listed order. A person who already started the funnel
        // through an earlier bot is skipped by the next launches ("already active"), so nobody gets it twice.
        // Only the first launch may restart; scheduled launches keep the order with a one-minute step.
        const attempts = (selfTest ? [smsStart ? '' : bot] : launchBots).map((botId, i) => { const id = crypto.randomUUID(); return { id, args: { p_id: id, p_funnel: saved.id, p_revision: saved.revision, p_bot: botId || null, ...(!selfTest ? { p_filters: parseTelegramFunnelSegment(segment), p_restart: restart && i === 0, p_scheduled_at: date ? new Date(date.getTime() + i * 60_000).toISOString() : null } : {}) } }; });
        const [head, ...queue] = attempts;
        pendingLaunch.current = { ...head, actor_id: lease.actorId, selfTest, ...(queue.length ? { queue } : {}) };
        rememberPendingFunnelLaunch(lease.actorId, saved.id, pendingLaunch.current);
      } else {
        // Reconcile the same target after an uncertain request before touching it again.
        if (pendingLaunch.current.actor_id !== lease.actorId) throw Error('Запуск принадлежит другому аккаунту.');
        const { data, error } = await lease.run(() => lease.client.from('telegram_funnel_launches').select('id,status').eq('id', pendingLaunch.current!.id).maybeSingle());
        if (error) throw Error('Не удалось проверить предыдущий запуск. Повторная отправка не выполнялась.');
        if (data?.status === 'stopped') { rememberPendingFunnelLaunch(lease.actorId, saved.id, null); pendingLaunch.current = null; throw Error('Предыдущий запуск остановлен. Новая отправка не выполнялась.'); }
        if (data) setLaunchId(data.id);
      }
      const attempt = pendingLaunch.current, total = 1 + (attempt.queue?.length || 0);
      for (let step = 0; pendingLaunch.current; step++) {
        const current = pendingLaunch.current;
        const result = await runFunnelRpc<FunnelLaunch>(lease, current.selfTest ? 'telegram_funnel_begin_self_test' : 'telegram_funnel_begin_launch', current.args);
        if (step === 0) setLaunchId(result.id);
        if (!current.args.p_scheduled_at) {
          const { error, data } = await lease.run(() => lease.client.functions.invoke('telegram-mass-broadcast', { body: { funnel_action: current.selfTest ? 'test' : 'dispatch', launch_id: result.id }, headers: { Authorization: `Bearer ${lease.bearer}` } }));
          if (error || data?.error) throw Error(total > 1 ? 'Запуск через одного из ботов зарегистрирован; результат обработки пока не подтверждён. Обновите историю и нажмите «Проверить и продолжить этот запуск», чтобы продолжить с остальными ботами.' : 'Запуск зарегистрирован; результат обработки пока не подтверждён. Обновите историю и проверьте этот запуск.');
        }
        const [next, ...rest] = current.queue || [];
        pendingLaunch.current = next ? { ...next, actor_id: current.actor_id, selfTest: current.selfTest, ...(rest.length ? { queue: rest } : {}) } : null;
        rememberPendingFunnelLaunch(lease.actorId, saved.id, pendingLaunch.current);
      } setConfirmed(false); setNotice(attempt.selfTest ? 'Проверка на себе зарегистрирована только для вашего профиля. Подтверждённые отправки и переходы смотрите в истории.' : (total > 1 ? `Запусков через ботов: ${total}. ` : '') + (attempt.args.p_scheduled_at ? 'Запуск запланирован. Аудитория уже зафиксирована. Отправка и перезапуск участников начнутся не раньше назначенного времени.' : 'Запуск зарегистрирован. Подтверждённые отправки и ошибки смотрите в истории.'));
      await lease.run(() => launches.refetch()); await lease.run(() => qc.invalidateQueries({ queryKey: ['telegram-funnel-report', actor.actorId, actor.generation] }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <fieldset disabled={busy} className="min-w-0 space-y-6">
    <section className="space-y-3 rounded-lg border p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Название<Input aria-label="Название воронки" value={draft.name} maxLength={200} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label className="text-sm">Статус<select aria-label="Статус воронки" className={`${selectClass} block w-full`} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as FunnelRecord['status'] })}><option value="draft">Черновик</option><option value="active">Активна</option><option value="stopped">Остановлена</option></select></label></div>
      {saved.created_at && <p className="text-xs text-muted-foreground">Создана {new Date(saved.created_at).toLocaleString('ru-RU')} · Автор: {author.data || 'Имя недоступно'} · Версия {saved.revision}</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !dirty && !!saved.revision} onClick={save}>{draft.status === 'stopped' ? 'Сохранить и остановить все запуски' : 'Сохранить воронку'}</Button><Button variant="outline" onClick={() => { const next = makeBlock(); setDraft({ ...draft, blocks: [...draft.blocks, next] }); setBlockId(next.id); }}>Добавить сообщение</Button></div>
      {!!errors.length && <ul className="text-sm text-muted-foreground">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <p className={draft.status === 'stopped' ? 'text-sm font-medium text-destructive' : 'text-xs text-muted-foreground'}>Сохранение статуса «Остановлена» остановит все текущие запуски этой воронки и запретит новые. Кнопка «Остановить запуск» ниже останавливает только выбранный запуск. Отправка, которая уже началась, может завершиться.</p>
    </section>
    {block && <div className="grid gap-4 xl:grid-cols-[minmax(300px,1fr)_minmax(0,1.3fr)]"><FunnelGraph funnel={draft} selectedId={block.id} onSelect={setBlockId}/><section className="min-w-0 space-y-4 rounded-lg border p-4" aria-label="Редактор сообщения">
      <div className="flex flex-wrap gap-2 items-center"><h3 className="font-semibold">{blockTitle(block, draft.blocks.indexOf(block))}</h3><Button variant="outline" size="sm" disabled={draft.start_block_id === block.id} onClick={() => setDraft({ ...draft, start_block_id: block.id })}>Сделать стартовым</Button><Button size="sm" variant="ghost" disabled={draft.blocks.length < 2} onClick={() => { const remaining = draft.blocks.filter(b => b.id !== block.id); setDraft({ ...draft, blocks: remaining, start_block_id: draft.start_block_id === block.id ? remaining[0].id : draft.start_block_id }); setBlockId(remaining[0].id); }}>Удалить сообщение</Button></div>
      <label className="block text-sm">Канал сообщения<select aria-label="Канал сообщения" className={`${selectClass} block w-full`} value={block.channel || 'telegram'} onChange={e => updateBlock(e.target.value === 'sms' ? { channel: 'sms', image_path: null, buttons: [] } : { channel: 'telegram' })}><option value="telegram">Telegram</option><option value="sms">SMS</option></select></label>
      {block.channel !== 'sms' && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => formatText('*')}>Жирный</Button><Button size="sm" variant="outline" onClick={() => formatText('_')}>Курсив</Button><Button size="sm" variant="outline" onClick={() => formatText('`')}>Код</Button></div>}
      <label className="block text-sm">Текст сообщения<Textarea ref={textRef} aria-label="Текст сообщения" value={block.text} maxLength={block.channel === 'sms' ? 1000 : 4096} rows={7} onChange={e => updateBlock({ text: e.target.value })}/></label><p className="text-xs text-muted-foreground">{block.channel === 'sms' ? 'SMS: обычный текст, до 1000 символов. Без изображений и интерактивных кнопок. Сообщение завершает ветку; ссылки можно указать в тексте.' : <>Абзацы сохраняются. *Жирный*, _курсив_, `код`, [текст](https://…). Лимит: 4096 символов.{block.image_path ? (block.text.length > 1024 ? ' Текст длиннее 1024 символов: картинка придёт отдельным сообщением, сразу за ней — текст с кнопками.' : ' До 1024 символов текст придёт подписью к картинке.') : ''}</>}</p>
      {block.channel !== 'sms' && <><label className="block text-sm">Изображение<span className="block text-xs text-muted-foreground">{block.image_path ? 'К этому сообщению прикреплено изображение (видно в предпросмотре ниже). Выберите файл, чтобы заменить его.' : 'У этого сообщения нет изображения.'}</span><Input key={block.id} aria-label="Изображение сообщения" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; const selectedBlock = block.id; setBusy(true); setError(''); try { if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('Выберите JPG, PNG или WebP до 10 МБ.'); const lease = await actor.lease(); const uploaded = await lease.run(() => uploadToTelegramMedia(file, lease.actorId, lease.client, lease.bearer)); setDraft(prev => ({ ...prev, blocks: prev.blocks.map(b => b.id === selectedBlock ? { ...b, image_path: uploaded.path } : b) })); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }}/></label>
      {block.image_path && <Button size="sm" variant="ghost" onClick={() => updateBlock({ image_path: null })}>Убрать изображение</Button>}
      <div className="space-y-3">{block.buttons.map((btn, i) => <fieldset key={btn.id} className="space-y-2 rounded border p-3"><legend className="text-sm">Кнопка {i + 1}</legend><Input aria-label={`Текст кнопки ${i + 1}`} value={btn.text} maxLength={64} onChange={e => updateButton(btn.id, { ...btn, text: e.target.value })}/><select aria-label={`Действие кнопки ${i + 1}`} className={`${selectClass} w-full`} value={btn.kind} onChange={e => updateButton(btn.id, e.target.value === 'url' ? { id: btn.id, text: btn.text, kind: 'url', url: '' } : e.target.value === 'finish' ? { id: btn.id, text: btn.text, kind: 'finish', tag: null } : { id: btn.id, text: btn.text, kind: 'next', target_block_id: '' })}><option value="next">Отправить следующее сообщение</option><option value="url">Открыть ссылку</option><option value="finish">Завершить воронку (ответ сохраняется в карточке)</option></select>
        {btn.kind === 'finish' ? <label className="block text-sm">Метка в карточке контакта (необязательно)<Input aria-label={`Метка кнопки ${i + 1}`} value={btn.tag || ''} maxLength={80} placeholder="Например: ЗГ 2026 — не участвует" onChange={e => updateButton(btn.id, { ...btn, tag: e.target.value || null })}/><span className="text-xs text-muted-foreground">Нажатие завершает воронку для участника: следующие сообщения не отправляются. В карточке видно, какую кнопку нажали; метку можно использовать в сегментах.</span></label> : btn.kind === 'next' ? <select aria-label={`Целевое сообщение кнопки ${i + 1}`} className={`${selectClass} w-full`} value={btn.target_block_id} onChange={e => updateButton(btn.id, { ...btn, target_block_id: e.target.value })}><option value="">Выберите сообщение</option>{draft.blocks.map((b, j) => <option key={b.id} value={b.id}>{blockTitle(b, j)}</option>)}</select> : <Input aria-label={`URL кнопки ${i + 1}`} value={btn.url} placeholder="https://…" onChange={e => updateButton(btn.id, { ...btn, url: e.target.value })}/>}
        <Button size="sm" variant="ghost" onClick={() => updateBlock({ buttons: block.buttons.filter(b => b.id !== btn.id) })}>Удалить кнопку</Button></fieldset>)}</div>
      <Button size="sm" variant="outline" onClick={() => updateBlock({ buttons: [...block.buttons, { id: crypto.randomUUID(), text: 'Следующее сообщение', kind: 'next', target_block_id: '' }] })}>Добавить кнопку</Button>
      <p className="text-xs text-muted-foreground">Ссылка открывает сайт и не отправляет следующее сообщение. Кнопка «Завершить воронку» сохраняет ответ и останавливает воронку для участника. Сообщение без кнопок завершает ветку.</p>
      </>}
      <div aria-label="Предпросмотр сообщения">{block.channel === 'sms' ? <div className="whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-sm">{block.text || 'Текст SMS'}</div> : <TelegramMessagePreview text={block.text} mediaType={block.image_path ? 'photo' : null} mediaUrl={imageUrl}/>}<div className="mt-2 space-y-2">{block.buttons.map(btn => <div key={btn.id} className="rounded bg-muted p-2 text-center text-sm break-words">{btn.text} · {btn.kind === 'url' ? '↗ Ссылка' : btn.kind === 'finish' ? '⏹ Завершение воронки' : `→ ${draft.blocks.findIndex(b => b.id === btn.target_block_id) + 1 || 'Выберите сообщение'}`}</div>)}</div></div>
    </section></div>}
    <section className="space-y-4 rounded-lg border p-4" aria-label="Настройка запуска"><h3 className="font-semibold">Запуск на сегмент базы</h3>
      {[products.error, flows.error, bots.error].filter(Boolean).map((e, i) => <p key={i} role="alert">{errorText(e)}</p>)}
      <SegmentBuilder value={segment} onChange={setSegment} products={products.data || []} flows={flows.data || []} tags={segmentTags.data || []}/>
      {!smsStart && <label className="block text-sm">Бот<select aria-label="Бот запуска" className={`${selectClass} block w-full sm:max-w-md`} value={bot} onChange={e => setBot(e.target.value)}><option value="">Выберите бота</option>{bots.data?.map(b => <option key={b.id} value={b.id}>{b.bot_name}</option>)}</select></label>}
      {!smsStart && (bots.data?.length || 0) > 1 && <fieldset className="space-y-1 text-sm"><legend>Также отправить через других ботов (необязательно)</legend>{bots.data?.filter(b => b.id !== bot).map(b => <label key={b.id} className="flex items-center gap-2"><input type="checkbox" aria-label={`Также через ${b.bot_name}`} checked={extraBots.includes(b.id)} disabled={!bot} onChange={e => setExtraBots(prev => e.target.checked ? [...prev, b.id] : prev.filter(x => x !== b.id))}/>{b.bot_name}</label>)}<p className="text-xs text-muted-foreground">Каждый человек получит воронку один раз: через первого бота в этом порядке, с которым у него есть диалог. Проверка на себе идёт через основного бота.</p></fieldset>}
      <div className="space-y-1"><Button variant="outline" disabled={busy || dirty || !saved.revision || (!smsStart && !bot) || !!pendingLaunch.current} onClick={() => launch(true)}>Проверить на себе</Button><p className="text-xs text-muted-foreground">{smsStart ? 'Отправит одну SMS на телефон вашего существующего профиля.' : 'Отправит старт только вашему существующему профилю через выбранного бота.'} Можно проверить переходы до активации воронки.</p></div>
      <Button variant="outline" disabled={(!smsStart && !bot) || checking} onClick={() => audience(0)}>Проверить получателей</Button>
      {checking && <p role="status">Рассчитываем сегмент…</p>}
      {currentPreview && <div className="space-y-2">{currentPreview.byBot.length > 1 ? <p>В сегменте: <strong>{currentPreview.page.total}</strong>. Доступный диалог: {currentPreview.byBot.map((b, i) => <span key={b.id}>{i ? '; ' : ''}{botName(b.id)} — <strong>{b.available}</strong></span>)}. Без диалога ни с одним из ботов будут пропущены.</p> : <p>В сегменте: <strong>{currentPreview.page.total}</strong>. {smsStart ? 'Известен телефон:' : 'Доступный диалог с выбранным ботом:'} <strong>{currentPreview.page.available_count}</strong>. {smsStart ? 'Без телефона будут пропущены.' : 'Без диалога будут пропущены.'}</p>}<ul className="max-h-64 overflow-auto text-sm">{currentPreview.page.recipients.map(r => <li key={r.profile_id} className="flex flex-wrap justify-between gap-2 border-b py-2"><span>{r.full_name || 'Контакт без имени'}</span><span>{r.has_dialog ? smsStart ? 'Телефон доступен' : 'Диалог доступен' : smsStart ? 'Нет телефона' : 'Нет доступного диалога'}</span></li>)}</ul><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!currentPreview.offset || checking} onClick={() => audience(Math.max(0, currentPreview.offset - 50))}>Предыдущие</Button><Button size="sm" variant="outline" disabled={currentPreview.offset + 50 >= currentPreview.page.total || checking} onClick={() => audience(currentPreview.offset + 50)}>Следующие</Button></div></div>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restart} onChange={e => setRestart(e.target.checked)}/>Перезапустить с первого сообщения тех, кто уже проходит эту воронку</label><p className="text-xs text-muted-foreground">По умолчанию активные участники этой воронки исключаются из повторного запуска.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scheduled} onChange={e => setScheduled(e.target.checked)}/>Запланировать</label>{scheduled && <label className="block text-sm">Дата и время (ваш часовой пояс)<Input aria-label="Дата и время запуска" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}/></label>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={!currentPreview || dirty || saved.status !== 'active'} onChange={e => setConfirmed(e.target.checked)}/>Подтверждаю запуск выбранной воронки для проверенного сегмента через {smsStart ? 'SMS' : launchBots.length > 1 ? `выбранных ботов (${launchBots.length})` : 'выбранного бота'}</label>
      <Button disabled={busy || !pendingLaunch.current && (!confirmed || !currentPreview || dirty || saved.status !== 'active')} onClick={() => launch()}>{pendingLaunch.current ? 'Проверить и продолжить этот запуск' : scheduled ? 'Запланировать запуск' : 'Запустить воронку'}</Button>
      {pendingLaunch.current && <p className="text-sm text-amber-700">Есть незавершённая проверка предыдущего запуска. Продолжение использует его сохранённые условия и того же получателя, даже после перезагрузки страницы.</p>}
      {dirty && <p className="text-sm text-muted-foreground">Сначала сохраните изменения воронки.</p>}
    </section>
    <section className="space-y-2"><h3 className="font-semibold">Запуски</h3>{launches.error && <p role="alert">{errorText(launches.error)}</p>}{launches.data?.map(l => <div key={l.id} className="flex flex-wrap gap-2 items-center rounded border p-3 text-sm"><span>{new Date(l.scheduled_for).toLocaleString('ru-RU')} · {botName(l.bot_id)} · {l.status === 'active' ? 'Активен / запланирован' : 'Остановлен'}</span><Button size="sm" variant="outline" onClick={() => setLaunchId(l.id)}>История</Button><Button size="sm" variant="outline" disabled={busy || l.status !== 'active'} onClick={async () => { setBusy(true); setError(''); try { const lease = await actor.lease(); await runFunnelRpc(lease, 'telegram_funnel_stop_launch', { p_launch: l.id }); await lease.run(() => launches.refetch()); await lease.run(() => qc.invalidateQueries({ queryKey: ['telegram-funnel-report', actor.actorId, actor.generation] })); setNotice('Запуск остановлен. Отправка, которая уже началась, может завершиться; новые шаги не запускаются.'); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }}>Остановить запуск</Button></div>)}</section>
    {!!saved.revision && <FunnelReportPanel key={`${draft.id}-${launchId || 'all'}`} funnelId={draft.id} launchId={launchId} blockOrder={saved.blocks.map(b => b.id)}/>}
    {notice && <p role="status" className="rounded border p-3 text-sm">{notice}</p>}{error && <p role="alert" className="rounded border border-destructive p-3 text-sm">{error}</p>}
  </fieldset>;
}
