import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramFunnels } from './TelegramFunnels';
import { SegmentBuilder, emptySegment } from './SegmentBuilder';
import { graphErrors, makeFunnel } from './contracts';
import { ContactFunnelHistory, FunnelReportPanel } from './FunnelReportPanel';
import { FunnelActorBoundary, useFunnelActor } from './FunnelActor';

const fixture = vi.hoisted(() => {
  const product = '11111111-1111-4111-8111-111111111111', bot = '22222222-2222-4222-8222-222222222222';
  const first = '33333333-3333-4333-8333-333333333333', next = '44444444-4444-4444-8444-444444444444';
  const record = { id: '66666666-6666-4666-8666-666666666666', revision: 1, name: 'Учебная воронка', status: 'active', start_block_id: first,
    blocks: [{ id: first, text: 'Приветствие', buttons: [{ id: '77777777-7777-4777-8777-777777777777', text: 'Далее', kind: 'next', target_block_id: next }] }, { id: next, text: 'Финал', buttons: [] }] };
  return { product, bot, first, next, record, actor: '88888888-8888-4888-8888-888888888888', otherActor: '99999999-9999-4999-8999-999999999999', currentActor: '', authHandlers: new Set<(event: string, session: { user: { id: string }; access_token: string } | null) => void>(), transports: [] as { authorization: string; name: string }[], rpc: vi.fn(), invoke: vi.fn(), from: vi.fn(), upload: vi.fn(), sign: vi.fn(), session: vi.fn() };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: fixture.from, rpc: fixture.rpc, auth: {
  getSession: () => fixture.session(),
  onAuthStateChange: (callback: typeof fixture.authHandlers extends Set<infer C> ? C : never) => { fixture.authHandlers.add(callback); return { data: { subscription: { unsubscribe: () => fixture.authHandlers.delete(callback) } } }; },
} } }));
vi.mock('@supabase/supabase-js', async importOriginal => ({ ...await importOriginal<typeof import('@supabase/supabase-js')>(), createClient: (_url: string, _key: string, options: { global: { headers: { Authorization: string } } }) => ({
  from: fixture.from,
  rpc: (name: string, args: unknown) => { fixture.transports.push({ authorization: options.global.headers.Authorization, name }); return fixture.rpc(name, args); },
  functions: { invoke: fixture.invoke }, storage: { from: () => ({ createSignedUrl: fixture.sign, upload: (...args: unknown[]) => { fixture.transports.push({ authorization: options.global.headers.Authorization, name: 'storage.upload' }); return fixture.upload(...args); } }) },
}) }));
const report = { total: 0, enrollments: [], deliveries: [], events: [], block_stats: [], button_stats: [], summary: { entered: 0, skipped: 0, sent: 0, failed: 0, unknown: 0, clicked: 0, url_clicked: 0, converted: 0 } };
beforeEach(() => {
  sessionStorage.clear();
  fixture.currentActor = fixture.actor; fixture.authHandlers.clear(); fixture.transports.length = 0;
  fixture.rpc.mockReset(); fixture.invoke.mockReset(); fixture.from.mockReset();
  fixture.upload.mockReset(); fixture.sign.mockReset();
  fixture.session.mockReset().mockImplementation(async () => ({ data: { session: fixture.currentActor ? { user: { id: fixture.currentActor }, access_token: `synthetic-${fixture.currentActor}` } : null }, error: null }));
  fixture.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'list_operational_telegram_bots') return { data: [{ id: fixture.bot, bot_name: 'Учебный бот', status: 'active' }, { id: fixture.next, bot_name: 'Другой бот', status: 'active' }], error: null };
    if (name === 'telegram_funnel_audience') return { data: { total: 101, available_count: 80, recipients: [{ profile_id: fixture.first, user_id: fixture.next, full_name: 'Тестовый участник', has_dialog: true }] }, error: null };
    if (name === 'telegram_funnel_save') return { data: { id: args.p_id, name: args.p_name, status: args.p_status, revision: Number(args.p_expected_revision) + 1, start_block_id: args.p_start, blocks: args.p_blocks }, error: null };
    if (name === 'telegram_funnel_begin_launch' || name === 'telegram_funnel_begin_self_test') return { data: { id: args.p_id, status: 'active' }, error: null };
    return { data: report, error: null };
  });
  fixture.invoke.mockResolvedValue({ data: { results: [] }, error: null });
  fixture.from.mockImplementation((table: string) => {
    const data = table === 'telegram_funnels' ? [fixture.record] : table === 'products_v2' ? [{ id: fixture.product, name: 'ЦБ' }] : [];
    const q = { select: () => q, order: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: { id: 'existing', status: 'active' }, error: null }), then: (resolve: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve) };
    return q;
  });
});
afterEach(cleanup);
function view() { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); return render(<QueryClientProvider client={client}><TelegramFunnels/></QueryClientProvider>); }
function reportView(child: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); return render(<QueryClientProvider client={client}><FunnelActorBoundary>{child}</FunnelActorBoundary></QueryClientProvider>); }
function switchActor(actorId: string) { act(() => { fixture.currentActor = actorId; for (const callback of fixture.authHandlers) callback(actorId ? 'SIGNED_IN' : 'SIGNED_OUT', actorId ? { user: { id: actorId }, access_token: `synthetic-${actorId}` } : null); }); }
async function openSaved() { view(); fireEvent.click(await screen.findByRole('button', { name: 'Учебная воронка · Активна' })); await screen.findByRole('option', { name: 'Учебный бот' }); }
async function preview() { fireEvent.change(screen.getByLabelText('Продукт условия'), { target: { value: fixture.product } }); fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.bot } }); fireEvent.click(screen.getByRole('button', { name: 'Проверить получателей' })); await screen.findByText('Тестовый участник'); }

describe('authoring and dispatch guardrails', () => {
  it('authors 3+ messages with stable next IDs and a URL button; editing and saving send nothing', async () => {
    await openSaved();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить сообщение' }));
    fireEvent.change(screen.getByLabelText('Текст сообщения'), { target: { value: 'Третий блок' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать сообщение 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить кнопку' }));
    fireEvent.change(screen.getByLabelText('Действие кнопки 2'), { target: { value: 'url' } });
    fireEvent.change(screen.getByLabelText('Текст кнопки 2'), { target: { value: 'Программа' } });
    fireEvent.change(screen.getByLabelText('URL кнопки 2'), { target: { value: 'https://example.com/program' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить воронку' }));
    await screen.findByText(/Воронка сохранена/);
    const [, args] = fixture.rpc.mock.calls.find(c => c[0] === 'telegram_funnel_save')!;
    expect(args.p_blocks).toHaveLength(3);
    expect(args.p_blocks[0].buttons).toEqual([{ id: '77777777-7777-4777-8777-777777777777', text: 'Далее', kind: 'next', target_block_id: fixture.next }, expect.objectContaining({ kind: 'url', url: 'https://example.com/program' })]);
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('has no ten-message limit and blocks deleted target references', async () => {
    await openSaved();
    for (let i = 0; i < 9; i++) fireEvent.click(screen.getByRole('button', { name: 'Добавить сообщение' }));
    expect(screen.getByRole('button', { name: 'Выбрать сообщение 11' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать сообщение 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить сообщение' }));
    expect(screen.getByText(/выберите существующее целевое сообщение/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить воронку' }));
    await screen.findByRole('alert');
    expect(fixture.rpc.mock.calls.some(c => c[0] === 'telegram_funnel_save')).toBe(false);
  });
  it('previews bounded recipients and excludes active reentry by default; explicit launch only', async () => {
    await openSaved();
    expect(screen.getByRole('button', { name: 'Запустить воронку' })).toBeDisabled();
    await preview();
    fireEvent.click(screen.getByRole('button', { name: 'Следующие' }));
    await waitFor(() => expect(fixture.rpc).toHaveBeenCalledWith('telegram_funnel_audience', expect.objectContaining({ p_offset: 50, p_limit: 50 })));
    expect(fixture.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Подтверждаю запуск/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Запустить воронку' }));
    await waitFor(() => expect(fixture.invoke).toHaveBeenCalledTimes(1));
    expect(fixture.rpc).toHaveBeenCalledWith('telegram_funnel_begin_launch', expect.objectContaining({ p_restart: false, p_scheduled_at: null, p_bot: fixture.bot }));
    const [, args] = fixture.rpc.mock.calls.find(c => c[0] === 'telegram_funnel_begin_launch')!;
    expect(fixture.invoke).toHaveBeenCalledWith('telegram-mass-broadcast', { body: { funnel_action: 'dispatch', launch_id: args.p_id }, headers: { Authorization: `Bearer synthetic-${fixture.actor}` } });
  });
  it('registers a future schedule with explicit restart and never immediately dispatches it', async () => {
    await openSaved(); await preview();
    fireEvent.click(screen.getByRole('checkbox', { name: /Перезапустить с первого/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Запланировать' }));
    fireEvent.change(screen.getByLabelText('Дата и время запуска'), { target: { value: '2099-01-20T10:30' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Подтверждаю запуск/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать запуск' }));
    await screen.findByText(/Запуск запланирован/);
    expect(screen.getByText(/Аудитория уже зафиксирована.*Отправка и перезапуск участников начнутся не раньше назначенного времени/)).toBeInTheDocument();
    expect(fixture.rpc).toHaveBeenCalledWith('telegram_funnel_begin_launch', expect.objectContaining({ p_restart: true, p_scheduled_at: new Date('2099-01-20T10:30').toISOString() }));
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('invalidates recipient approval when bot changes and discards late audience replies', async () => {
    await openSaved();
    let resolve!: (v: unknown) => void;
    const normal = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'telegram_funnel_audience' ? new Promise(r => { resolve = r; }) : normal(name, args));
    fireEvent.change(screen.getByLabelText('Продукт условия'), { target: { value: fixture.product } });
    fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.bot } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить получателей' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.next } });
    await act(async () => resolve({ data: { total: 1, available_count: 1, recipients: [{ profile_id: fixture.first, user_id: fixture.next, full_name: 'Старая аудитория', has_dialog: true }] }, error: null }));
    expect(screen.queryByText('Старая аудитория')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Подтверждаю запуск/ })).toBeDisabled();
  });
  it('builds nested AND/OR without hardcoded product segments', () => {
    let value = emptySegment(fixture.product);
    const renderBuilder = () => <SegmentBuilder value={value} onChange={v => { value = v; rerender(renderBuilder()); }} products={[{ id: fixture.product, name: 'ЦБ' }]} flows={[]}/>;
    const { rerender } = render(renderBuilder());
    fireEvent.click(screen.getByRole('button', { name: 'Добавить группу И/ИЛИ' }));
    const groups = screen.getAllByRole('group', { name: 'Группа условий' });
    fireEvent.change(within(groups[1]).getByLabelText('Связь условий'), { target: { value: 'or' } });
    fireEvent.change(within(groups[1]).getByLabelText('Тип условия'), { target: { value: 'year' } });
    fireEvent.change(screen.getByLabelText('Год участия'), { target: { value: '2024' } });
    expect(value.root).toMatchObject({ op: 'and', args: [expect.anything(), { op: 'or', args: [{ kind: 'year', year: 2024, product_id: fixture.product }] }] });
  });
  it('self-tests only through the own-profile RPC without segment or recipient override', async () => {
    await openSaved();
    fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.bot } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить на себе' }));
    await screen.findByText(/Проверка на себе зарегистрирована/);
    const [, args] = fixture.rpc.mock.calls.find(c => c[0] === 'telegram_funnel_begin_self_test')!;
    expect(Object.keys(args).sort()).toEqual(['p_bot', 'p_funnel', 'p_id', 'p_revision']);
    expect(fixture.invoke).toHaveBeenCalledWith('telegram-mass-broadcast', { body: { funnel_action: 'test', launch_id: args.p_id }, headers: { Authorization: `Bearer synthetic-${fixture.actor}` } });
    expect(fixture.rpc.mock.calls.some(c => c[0] === 'telegram_funnel_begin_launch' || c[0] === 'telegram_funnel_audience')).toBe(false);
  });
  it('preserves an uncertain launch across remount and reconciles the same ID before continuation', async () => {
    await openSaved(); await preview();
    fixture.invoke.mockResolvedValueOnce({ error: Error('timeout'), data: null });
    fireEvent.click(screen.getByRole('checkbox', { name: /Подтверждаю запуск/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Запустить воронку' }));
    await screen.findByText(/результат обработки пока не подтверждён/);
    const [, firstArgs] = fixture.rpc.mock.calls.find(c => c[0] === 'telegram_funnel_begin_launch')!;
    cleanup();
    await openSaved();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и продолжить этот запуск' }));
    await waitFor(() => expect(fixture.invoke).toHaveBeenCalledTimes(2));
    const beginCalls = fixture.rpc.mock.calls.filter(c => c[0] === 'telegram_funnel_begin_launch');
    expect(beginCalls).toHaveLength(2);
    expect(beginCalls[1][1]).toEqual(firstArgs);
    expect(sessionStorage.getItem(`telegram-funnel-pending:${fixture.actor}:${fixture.record.id}`)).toBeNull();
  });
  it('rejects unsupported URL schemes before saving', () => {
    const draft = makeFunnel(); draft.name = 'Проверка'; draft.blocks[0].text = 'Сообщение';
    draft.blocks[0].buttons = [{ id: crypto.randomUUID(), text: 'Ссылка', kind: 'url', url: 'javascript:alert(1)' }];
    expect(graphErrors(draft)).toEqual([expect.stringContaining('http/https')]);
  });
  it('shows native block/button totals and distinct-user conversion, with paginated full participant history', async () => {
    const base = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'telegram_funnel_report') return Promise.resolve({ error: null, data: { ...report, total: 1,
        enrollments: [{ id: fixture.first, funnel_name: 'История курса', profile_name: 'Участник', current_block: 'Текущий шаг', status: 'active' }],
        block_stats: [{ block_id: fixture.first, block_text: 'Первый блок', received: 2 }, { block_id: fixture.next, block_text: 'Следующий блок', received: 1 }, { block_id: fixture.bot, received: 0 }], button_stats: [{ block_id: fixture.first, button_id: fixture.next, text: 'Продолжить', kind: 'next', clicked: 3, unique_clicked: 1 }, { block_id: fixture.bot, button_id: fixture.bot, clicked: 0 }],
        transitions: [{ source_block_id: fixture.first, target_block_id: fixture.next, received: 1, source_received: 2, conversion: .5 }, { source_block_id: fixture.bot, target_block_id: fixture.bot, received: 0, source_received: 0, conversion: 0 }],
        deliveries: [{ id: fixture.bot, block_id: fixture.first, status: 'sent' }], events: [{ id: fixture.next, kind: 'clicked', detail: { button_id: fixture.next } }, { id: fixture.bot, kind: 'clicked', detail: { button_id: fixture.bot } }],
        summary: { ...report.summary, entered: 2, converted: 1, clicked: 3, unknown: 1 } } });
      if (name === 'telegram_funnel_history') return Promise.resolve({ error: null, data: { total: 51, deliveries: [{ id: fixture.next, status: 'sent', block: { text: 'Полный текст отправленного сообщения', buttons: [{ id: fixture.first, text: 'Кнопка истории', kind: 'next' }] }, events: [{ id: fixture.bot, kind: 'clicked', detail: { button_id: fixture.first } }] }] } });
      return base(name, args);
    });
    const { container } = reportView(<FunnelReportPanel profileId={fixture.first}/>);
    await screen.findByText('Первый блок: 2');
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/Продолжить.*3 нажатий, 1 человек/)).toBeInTheDocument();
    expect(screen.getByText(/Повторная отправка автоматически не выполняется/)).toBeInTheDocument();
    expect(screen.getByText('Первый блок → Следующий блок: 1 / 2, 50%')).toBeInTheDocument();
    expect(screen.getByText('Кнопка: Продолжить')).toBeInTheDocument();
    expect(screen.getByText('Кнопка: Кнопка без названия')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    fireEvent.click(screen.getByRole('button', { name: 'Все сообщения и нажатия участника' }));
    await screen.findAllByText('Полный текст отправленного сообщения');
    expect(screen.getByText('Кнопки: Кнопка истории')).toBeInTheDocument();
    expect(screen.getByText('Кнопка: Кнопка истории')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    fireEvent.click(screen.getByRole('button', { name: 'Следующие сообщения' }));
    await waitFor(() => expect(fixture.rpc).toHaveBeenCalledWith('telegram_funnel_history', { p_enrollment: fixture.first, p_offset: 50, p_limit: 50 }));
    expect(screen.queryByRole('button', { name: 'Создать воронку' })).not.toBeInTheDocument();
  });
  it('edits explicit manual tags in the contact history without inferring paid status', async () => {
    reportView(<ContactFunnelHistory profileId={fixture.first}/>);
    const field = await screen.findByLabelText('Ручные метки контакта');
    await waitFor(() => expect(field).not.toBeDisabled());
    fireEvent.change(field, { target: { value: 'Первый поток, Проверено, Первый поток' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить метки' }));
    await waitFor(() => expect(fixture.rpc).toHaveBeenCalledWith('telegram_funnel_set_tags', { p_profile: fixture.first, p_tags: ['Первый поток', 'Проверено'] }));
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(screen.getByText(/не подтверждают оплату или участие/)).toBeInTheDocument();
  });
  it('does not dispatch an in-flight self-test after A switches to B before begin returns', async () => {
    await openSaved();
    let resolve!: (v: unknown) => void;
    const base = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'telegram_funnel_begin_self_test' ? new Promise(r => { resolve = r; }) : base(name, args));
    fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.bot } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить на себе' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    const [, args] = fixture.rpc.mock.calls.find(c => c[0] === 'telegram_funnel_begin_self_test')!;
    expect(fixture.transports).toContainEqual({ name: 'telegram_funnel_begin_self_test', authorization: `Bearer synthetic-${fixture.actor}` });
    switchActor(fixture.otherActor);
    await screen.findByRole('button', { name: 'Учебная воронка · Активна' });
    await act(async () => resolve({ data: { id: args.p_id, status: 'active' }, error: null }));
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`telegram-funnel-pending:${fixture.actor}:${fixture.record.id}`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Учебная воронка · Активна' }));
    expect(screen.queryByRole('button', { name: 'Проверить и продолжить этот запуск' })).not.toBeInTheDocument();
  });
  it('does not inherit A unresolved pending launch when B remounts; A can recover its own ID', async () => {
    await openSaved();
    fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.bot } });
    fixture.invoke.mockResolvedValueOnce({ error: Error('uncertain'), data: null });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить на себе' }));
    await screen.findByText(/результат обработки пока не подтверждён/);
    const [, original] = fixture.rpc.mock.calls.find(c => c[0] === 'telegram_funnel_begin_self_test')!;
    cleanup(); fixture.currentActor = fixture.otherActor;
    await openSaved();
    expect(screen.queryByRole('button', { name: 'Проверить и продолжить этот запуск' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(`telegram-funnel-pending:${fixture.actor}:${fixture.record.id}`)).not.toBeNull();
    switchActor(fixture.actor);
    fireEvent.click(await screen.findByRole('button', { name: 'Учебная воронка · Активна' }));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и продолжить этот запуск' }));
    await waitFor(() => expect(fixture.invoke).toHaveBeenCalledTimes(2));
    const calls = fixture.rpc.mock.calls.filter(c => c[0] === 'telegram_funnel_begin_self_test');
    expect(calls).toHaveLength(2); expect(calls[1][1]).toEqual(original);
    expect(fixture.invoke.mock.calls[1][1].headers.Authorization).toBe(`Bearer synthetic-${fixture.actor}`);
  });
  it('fresh session read catches an actor switch even before an auth event arrives', async () => {
    await openSaved();
    const base = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => { const reply = await base(name, args); if (name === 'telegram_funnel_begin_self_test') fixture.currentActor = fixture.otherActor; return reply; });
    fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.bot } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить на себе' }));
    await waitFor(() => expect(fixture.rpc.mock.calls.some(c => c[0] === 'telegram_funnel_begin_self_test')).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText('Настройка запуска')).not.toBeInTheDocument());
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('rejects old A audience after A→B→A and requires a fresh preview after saving a revision', async () => {
    await openSaved();
    let resolve!: (v: unknown) => void;
    const base = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'telegram_funnel_audience' ? new Promise(r => { resolve = r; }) : base(name, args));
    fireEvent.change(screen.getByLabelText('Продукт условия'), { target: { value: fixture.product } });
    fireEvent.change(screen.getByLabelText('Бот запуска'), { target: { value: fixture.bot } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить получателей' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    switchActor(fixture.otherActor); switchActor(fixture.actor);
    fireEvent.click(await screen.findByRole('button', { name: 'Учебная воронка · Активна' }));
    await act(async () => resolve({ data: { total: 1, available_count: 1, recipients: [{ profile_id: fixture.first, user_id: fixture.next, full_name: 'Просроченный результат А', has_dialog: true }] }, error: null }));
    expect(screen.queryByText('Просроченный результат А')).not.toBeInTheDocument();
    fixture.rpc.mockImplementation(base);
    await screen.findByRole('option', { name: 'Учебный бот' });
    await preview();
    fireEvent.change(screen.getByLabelText('Название воронки'), { target: { value: 'Новая версия' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить воронку' }));
    await screen.findByText(/Воронка сохранена/);
    expect(screen.queryByText('Тестовый участник')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Подтверждаю запуск/ })).toBeDisabled();
  });
  it('does not expose A report cache to B on an account switch', async () => {
    const base = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'telegram_funnel_report' ? Promise.resolve({ error: null, data: { ...report, total: 1, enrollments: [{ id: fixture.first, funnel_name: fixture.currentActor === fixture.actor ? 'История аккаунта А' : 'История аккаунта Б', status: 'active' }] } }) : base(name, args));
    reportView(<FunnelReportPanel profileId={fixture.first}/>);
    await screen.findByText(/История аккаунта А/);
    switchActor(fixture.otherActor);
    expect(screen.queryByText(/История аккаунта А/)).not.toBeInTheDocument();
    await screen.findByText(/История аккаунта Б/);
  });
  it('keeps an in-flight media upload bound to A and never assigns its result to B', async () => {
    await openSaved();
    let resolve!: (v: unknown) => void;
    fixture.upload.mockImplementation(() => new Promise(r => { resolve = r; }));
    fireEvent.change(screen.getByLabelText('Изображение сообщения'), { target: { files: [new File(['png'], 'example.png', { type: 'image/png' })] } });
    await waitFor(() => expect(fixture.upload).toHaveBeenCalledTimes(1));
    expect(fixture.upload.mock.calls[0][0]).toMatch(new RegExp(`^outbound/${fixture.actor}/`));
    expect(fixture.transports).toContainEqual({ authorization: `Bearer synthetic-${fixture.actor}`, name: 'storage.upload' });
    switchActor(fixture.otherActor);
    await act(async () => resolve({ error: null }));
    fireEvent.click(await screen.findByRole('button', { name: 'Учебная воронка · Активна' }));
    expect(screen.queryByRole('button', { name: 'Убрать изображение' })).not.toBeInTheDocument();
    expect(fixture.sign).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('rejects a delayed initial A snapshot after sign-out even before an actor was selected', async () => {
    const seen: string[] = [];
    function Probe() { const actor = useFunnelActor(); seen.push(actor.actorId); return <FunnelReportPanel profileId={fixture.first}/>; }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const mount = () => render(<QueryClientProvider client={client}><FunnelActorBoundary><Probe/></FunnelActorBoundary></QueryClientProvider>);
    mount(); await screen.findByText('Запусков пока нет.'); cleanup(); seen.length = 0;
    let resolve!: (v: unknown) => void;
    fixture.session.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    mount(); switchActor('');
    await act(async () => resolve({ data: { session: { user: { id: fixture.actor }, access_token: `synthetic-${fixture.actor}` } }, error: null }));
    expect(seen).not.toContain(fixture.actor);
    expect(screen.getByText('Войдите в аккаунт для работы с воронками.')).toBeInTheDocument();
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
  for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN']) it(`keeps the current draft during same-actor ${event}`, async () => {
    await openSaved();
    fireEvent.change(screen.getByLabelText('Название воронки'), { target: { value: 'Несохранённый черновик' } });
    act(() => { for (const callback of fixture.authHandlers) callback(event, { user: { id: fixture.actor }, access_token: 'synthetic-refreshed' }); });
    expect(screen.getByLabelText('Название воронки')).toHaveValue('Несохранённый черновик');
  });
  it('states the all-launch stop scope before saving and submits stopped status through the save contract', async () => {
    await openSaved();
    fireEvent.change(screen.getByLabelText('Статус воронки'), { target: { value: 'stopped' } });
    expect(screen.getByText(/Сохранение статуса «Остановлена» остановит все текущие запуски этой воронки/)).toBeInTheDocument();
    expect(screen.getByText(/Кнопка «Остановить запуск» ниже останавливает только выбранный запуск/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить воронку' })).not.toBeInTheDocument();
    expect(fixture.rpc.mock.calls.some(c => c[0] === 'telegram_funnel_save')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и остановить все запуски' }));
    await screen.findByText(/Все её текущие запуски остановлены/);
    expect(fixture.rpc).toHaveBeenCalledWith('telegram_funnel_save', expect.objectContaining({ p_id: fixture.record.id, p_expected_revision: 1, p_status: 'stopped' }));
    expect(fixture.rpc.mock.calls.some(c => c[0] === 'telegram_funnel_stop_launch')).toBe(false);
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('labels scheduled activation and safe waiting reasons without raw lifecycle codes', async () => {
    const base = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'telegram_funnel_report' ? Promise.resolve({ error: null, data: { ...report, total: 3,
      enrollments: [{ id: fixture.first, funnel_name: 'Будущий запуск', status: 'scheduled', reason: 'waiting_until_due' }, { id: fixture.next, funnel_name: 'Ожидание результата', status: 'scheduled', reason: 'prior_delivery_unresolved' }, { id: fixture.bot, funnel_name: 'Изменённый получатель', status: 'skipped', reason: 'recipient_binding_changed' }],
      events: [{ id: fixture.product, kind: 'activated' }] } }) : base(name, args));
    const { container } = reportView(<FunnelReportPanel profileId={fixture.first}/>);
    await screen.findByText('Будущий запуск · Запланировано');
    expect(screen.getByText('Причина: Ожидает назначенного времени запуска')).toBeInTheDocument();
    expect(screen.getByText('Причина: Предыдущая отправка ещё не подтверждена. Запуск ожидает проверки.')).toBeInTheDocument();
    expect(screen.getByText('Причина: Связь с Telegram-получателем изменилась. Отправка остановлена.')).toBeInTheDocument();
    expect(screen.getByText('Сообщение без названия · Запуск активирован')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/scheduled|activated|waiting_until_due|prior_delivery_unresolved|recipient_binding_changed/);
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
});
