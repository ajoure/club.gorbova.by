import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SupportWorkspace from './SupportWorkspace';

const f = vi.hoisted(() => ({
  actor: '00000000-0000-0000-0000-000000000001', client: '00000000-0000-0000-0000-000000000002',
  bot: '1a560e98-574e-4fd9-82ab-4b7bbdc300b4', incoming: '00000000-0000-0000-0000-000000000100',
  old: '00000000-0000-0000-0000-000000000200', manage: true,
  dialog: {} as Record<string, unknown>, assign: vi.fn(), invoke: vi.fn(), rpc: vi.fn(),
  success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: f.rpc, functions: { invoke: f.invoke } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: f.actor } }) }));
vi.mock('@/hooks/useAdminAccess', () => ({ useAdminAccess: () => ({ canAccessSection: () => f.manage }) }));
vi.mock('sonner', () => ({ toast: { success: f.success, warning: f.warning, error: f.error, info: f.info } }));
vi.mock('./SupportWebWorkspace', () => ({ default: () => null }));
vi.mock('@/components/admin/ContactTelegramChat', async () => {
  const React = await import('react');
  const { useQueryClient } = await import('@tanstack/react-query');
  const { telegramMessageCacheKey } = await import('@/lib/telegramChatCache');
  return { ContactTelegramChat: ({ onHistoryReadyChange, supportChannel }: {
    onHistoryReadyChange: (ready: boolean) => void; supportChannel: { can_reply: boolean };
  }) => {
    const cache = useQueryClient();
    React.useEffect(() => {
      cache.setQueryData(telegramMessageCacheKey(f.client, `support-bot:${f.bot}`), [
        { id: f.incoming, direction: 'incoming', created_at: '2026-10-23T06:00:00.123456Z' },
      ]);
      onHistoryReadyChange(true);
    }, [cache, onHistoryReadyChange]);
    return <button disabled={!supportChannel.can_reply}>Отправка в служебном канале</button>;
  } };
});

let cache: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); f.manage = true;
  f.dialog = { user_id: f.client, display_name: 'Synthetic client', telegram_user_id: 123, can_reply: true,
    latest_incoming_id: f.incoming, unread_count: 1, assignment_id: f.old, assignment_version: '4294967290',
    assignee_user_id: f.client, assignee_name: 'Другой сотрудник' };
  f.assign.mockImplementation(async (args) => {
    f.dialog = { ...f.dialog, assignment_id: args.p_request_id, assignee_user_id: f.actor, assignee_name: 'Сергей' };
    return { data: { assignment_id: args.p_request_id, created: true }, error: null };
  });
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'support_bot_channels_v1') return { data: [{ id: f.bot, label: 'Service' }], error: null };
    if (name === 'get_contact_center_assignees_v1') return { data: [{ user_id: f.actor, display_name: 'Сергей' }], error: null };
    if (name === 'support_bot_dialogs_v1') return { data: [{ ...f.dialog }], error: null };
    if (name === 'support_bot_assign_v1') return f.assign(args);
    throw new Error(`Unexpected RPC ${name}`);
  });
  f.invoke.mockResolvedValue({ data: { success: true }, error: null });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); cache.clear(); vi.useRealTimers(); });
function open() {
  render(<QueryClientProvider client={cache}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[
    `/admin/communication?support_mode=1&bot=${f.bot}&chat=${f.client}`,
  ]}><SupportWorkspace /></MemoryRouter></QueryClientProvider>);
}
async function choose() {
  const manager = await screen.findByLabelText('Передать менеджеру');
  await waitFor(() => expect(manager).toBeEnabled());
  fireEvent.change(manager, { target: { value: f.actor } });
  fireEvent.click(screen.getByRole('button', { name: 'Передать менеджеру' }));
  await screen.findByRole('alertdialog');
}

describe('scoped assignment through existing support controls', () => {
  it('shows the exact service bot in both the list and open conversation without broad inbox requests', async () => {
    open();
    await screen.findByLabelText('Передать менеджеру');
    expect(screen.getAllByLabelText('Telegram · Service')).toHaveLength(2);
    expect(screen.getAllByText('TG · Service')).toHaveLength(2);
    expect(f.rpc.mock.calls.every(([name]) => ['support_bot_channels_v1', 'support_bot_dialogs_v1', 'get_contact_center_assignees_v1'].includes(name))).toBe(true);
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.assign).not.toHaveBeenCalled();
  });
  it('replaces the visible source when selecting another service bot', async () => {
    const original = f.rpc.getMockImplementation()!;
    const second = '00000000-0000-0000-0000-000000000099';
    f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'support_bot_channels_v1'
      ? { data: [{ id: f.bot, label: 'Service' }, { id: second, label: 'Second service' }], error: null }
      : original(name, args));
    open();
    await screen.findByLabelText('Передать менеджеру');
    expect(screen.getAllByText('TG · Service')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Служебный бот'), { target: { value: second } });
    await screen.findByText('TG · Second service');
    expect(screen.queryByText('TG · Service')).not.toBeInTheDocument();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.assign).not.toHaveBeenCalled();
  });
  it('opens and closes mobile management actions without changing assignment or channel', async () => {
    open();
    const toggle = await screen.findByRole('button', { name: 'Действия' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Служебный бот')).toHaveValue(f.bot);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('searches only the final term after rapid typing without assignments or notifications', async () => {
    open();
    await screen.findByLabelText('Передать менеджеру');
    const input = screen.getByLabelText('Поиск обращений');
    vi.useFakeTimers();
    for (const value of ['t','te','test']) fireEvent.change(input, { target:{ value } });
    const searches = () => f.rpc.mock.calls.filter(([name,args]) => name === 'support_bot_dialogs_v1' && ['t','te','test'].includes(args.p_search));
    expect(searches()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(searches()).toHaveLength(1);
    expect(searches()[0][1].p_search).toBe('test');
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('allows an explicit confirmed handoff while keeping foreign-owner replies and unread controls blocked', async () => {
    open();
    await screen.findByLabelText('Передать менеджеру');
    expect(screen.getByRole('button', { name: 'Отправка в служебном канале' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Все вопросы решены' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Оставить нерешённым' })).toBeDisabled();
    await choose();
    expect(f.assign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    expect(f.assign.mock.calls[0][0]).toMatchObject({ p_user_id: f.client, p_bot_id: f.bot,
      p_observed_incoming_id: f.incoming, p_assignee_user_id: f.actor, p_observed_assignment_id: f.old,
      p_observed_assignment_version: '4294967290', p_observed_telegram_user_id: 123 });
    expect(f.invoke).toHaveBeenCalledWith('contact-center-assignment-notify', { body: {
      assignment_id: f.assign.mock.calls[0][0].p_request_id, support_bot_id: f.bot,
    } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отправка в служебном канале' })).toBeEnabled());
  });
  it('reconciles an unknown RPC result with the original request and no duplicate notification', async () => {
    let count = 0;
    f.assign.mockImplementation(async (args) => {
      f.dialog = { ...f.dialog, assignment_id: args.p_request_id, assignee_user_id: f.actor, assignee_name: 'Сергей' };
      return ++count === 1 ? { data: null, error: new Error('network result unknown') } :
        { data: { assignment_id: args.p_request_id, created: false }, error: null };
    });
    open(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(f.error).toHaveBeenCalled());
    await choose();
    expect(screen.getByText('Проверить результат назначения')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(f.info).toHaveBeenCalled());
    expect(f.assign).toHaveBeenCalledTimes(2);
    expect(f.assign.mock.calls[1][0]).toEqual(f.assign.mock.calls[0][0]);
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('keeps a confirmed assignment separate from a failed notification', async () => {
    f.invoke.mockRejectedValue(new Error('notification transport failed'));
    open(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(f.warning).toHaveBeenCalledWith('Назначение сохранено, доставка уведомления не подтверждена'));
    expect(f.assign).toHaveBeenCalledTimes(1); expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.error).not.toHaveBeenCalled();
  });
  it('does not assign after cancellation or without manage permission', async () => {
    open(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(f.assign).not.toHaveBeenCalled();
    cleanup(); cache.clear(); f.manage = false; open();
    expect(await screen.findByLabelText('Передать менеджеру')).toBeDisabled();
  });
});
