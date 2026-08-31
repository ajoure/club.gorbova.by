import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { format } from 'date-fns';
import { GrantAccessFromDealDialog } from './GrantAccessFromDealDialog';
import { localDateTimeValue } from '@/lib/grantAccessForm';

const state = vi.hoisted(() => ({
  admin: true, queryError: false, capability: true, response: {} as any, candidates: [] as any[], sub: {} as any, ent: {} as any,
  invoke: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn(), queries: [] as any[],
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ isAdmin: () => state.admin }) }));
vi.mock('sonner', () => ({ toast: { success: state.success, warning: state.warning, info: state.info, error: state.error } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: state.invoke },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    state.queries.push({ table, filters });
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; }, order: () => query,
      limit: async (limit: number) => { filters.limit = limit; return { data: state.candidates, error: state.queryError ? new Error('read failed') : null }; },
      maybeSingle: async () => ({ data: table === 'subscriptions_v2' ? state.sub : state.ent, error: null }),
    };
    return query;
  },
} }));

const subscriptionId = '00000000-0000-4000-8000-000000000001';
const target = new Date('2099-09-30T03:01:53.529Z');
const deal = { id: 'order', order_number: 'TEST-ACCESS', user_id: 'user', profile_id: 'profile',
  product_id: 'product', tariff_id: 'tariff', status: 'paid', created_at: '2099-08-01T03:01:53.529Z' };

beforeEach(() => {
  vi.clearAllMocks(); state.admin = true; state.queryError = false; state.capability = true; state.queries = [];
  state.candidates = [{ id: subscriptionId, product_id: 'product', tariff_id: 'tariff', status: 'active', access_end_at: '2099-09-01T03:01:53.529Z' }];
  state.sub = { ...state.candidates[0], user_id: 'user', order_id: 'parent', meta: { extended_by_orders: ['order'] }, access_end_at: target.toISOString() };
  state.ent = { id: 'ent', user_id: 'user', product_id: 'product', order_id: 'order', status: 'active', expires_at: target.toISOString() };
  state.response = { data: { success: true, results: { subscription: { id: subscriptionId }, entitlement: { id: 'ent' } } }, error: null };
  state.invoke.mockImplementation(async (_name: string, options: any) => options.method === 'GET'
    ? { data: { capabilities: { exact_existing_access_v1: state.capability } }, error: null } : state.response);
});
afterEach(cleanup);

function show(exact = true, existingSubscription?: ComponentProps<typeof GrantAccessFromDealDialog>['existingSubscription']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const props = { open: true, onOpenChange: vi.fn(), deal, tariff: { name: 'Тестовый тариф', access_days: 30 }, onSuccess: vi.fn(), initialExactEnd: exact, existingSubscription };
  const view = render(<QueryClientProvider client={client}><GrantAccessFromDealDialog {...props} /></QueryClientProvider>);
  return { ...view, props, client };
}
function chooseTarget(date = target) {
  fireEvent.change(screen.getByLabelText('Дата и время окончания'), { target: { value: localDateTimeValue(date) } });
}

describe('existing deal exact access repair dialog', () => {
  it('sends a millisecond-exact, same-order, same-subscription standard request and verifies both records', async () => {
    const { props } = show();
    expect(screen.getByLabelText('Дата и время окончания')).toHaveAttribute('step', '0.001');
    expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeDisabled();
    chooseTarget();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    expect(screen.getByText(new RegExp(target.toISOString().replace(/\./g, '\\.')))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledOnce());
    expect(state.invoke.mock.calls[0][1]).toEqual({ method: 'GET' });
    const request = state.invoke.mock.calls[1][1].body;
    expect(request).toMatchObject({ orderId: 'order', customAccessEndAt: target.toISOString(), expectedExistingSubscriptionId: subscriptionId, extendFromCurrent: true });
    expect(request.customAccessStartAt).toBe(state.candidates[0].access_end_at);
    expect(request).not.toHaveProperty('customAccessDays');
    expect(request).not.toHaveProperty('adminManualAccessEdit');
    expect(request).not.toHaveProperty('manualSubscriptionId');
    expect(state.queries).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'subscriptions_v2', filters: expect.objectContaining({ tariff_id: 'tariff', limit: 2 }) }),
      expect.objectContaining({ table: 'subscriptions_v2', filters: { id: subscriptionId } }),
      expect.objectContaining({ table: 'entitlements', filters: { id: 'ent' } }),
    ]));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
  it.each(['manager', 'ambiguous', 'read-error', 'no-existing'])('blocks %s before invocation', async kind => {
    if (kind === 'manager') state.admin = false;
    if (kind === 'ambiguous') state.candidates.push({ ...state.candidates[0], id: 'other' });
    if (kind === 'read-error') state.queryError = true;
    if (kind === 'no-existing') state.candidates = [];
    show(); chooseTarget();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it('blocks shortening in the UI', async () => {
    state.candidates[0].access_end_at = '2099-10-01T03:01:53.529Z';
    show(); chooseTarget();
    await screen.findByText('Этот режим не сокращает существующий доступ.');
    expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeDisabled();
  });
  it('can repair an expired subscription explicitly linked to this deal', async () => {
    state.candidates = [];
    const { props } = show(true, { id: subscriptionId, status: 'expired', product_id: 'product', tariff_id: 'tariff', access_end_at: '2026-08-01T12:00:00Z' });
    chooseTarget();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(state.invoke.mock.calls[1][1].body.expectedExistingSubscriptionId).toBe(subscriptionId);
  });
  it('does not use an expired linked row of another tariff', async () => {
    state.candidates = [];
    show(true, { id: subscriptionId, status: 'expired', product_id: 'product', tariff_id: 'other', access_end_at: '2026-08-01T12:00:00Z' });
    chooseTarget();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeDisabled();
  });
  it.each([{ success: true, skipped: true }, { manual_review: true, skipped: true }, {}])('does not close or show success for %j', async response => {
    state.response = { data: response, error: null };
    const { props } = show(); chooseTarget();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    await waitFor(() => expect(state.error).toHaveBeenCalled());
    expect(state.success).not.toHaveBeenCalled(); expect(props.onSuccess).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });
  it('does not claim success for an idempotent HTTP success with a short entitlement', async () => {
    state.response = { data: { success: true, already_fulfilled: true, subscription_id: subscriptionId, entitlement_id: 'ent' }, error: null };
    state.ent.expires_at = new Date(target.getTime() - 1).toISOString();
    const { props } = show(); chooseTarget();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    await waitFor(() => expect(state.error).toHaveBeenCalled());
    expect(state.success).not.toHaveBeenCalled(); expect(props.onSuccess).not.toHaveBeenCalled();
  });
  it('shows the verified server end, not the local day calculation', async () => {
    const { props } = show(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(state.success.mock.calls[0][1].description).toContain(format(target, 'dd.MM.yyyy HH:mm:ss.SSS'));
    expect(state.invoke.mock.calls[0][1].body).not.toHaveProperty('expectedExistingSubscriptionId');
  });
  it('clears a previous exact target when the dialog is reopened', async () => {
    const { props, client, rerender } = show(); chooseTarget();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    rerender(<QueryClientProvider client={client}><GrantAccessFromDealDialog {...props} open={false} /></QueryClientProvider>);
    rerender(<QueryClientProvider client={client}><GrantAccessFromDealDialog {...props} /></QueryClientProvider>);
    expect(screen.getByLabelText('Дата и время окончания')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeDisabled();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it('does not describe queued Telegram access as completed', async () => {
    state.response = { data: { success: true, results: {
      subscription: { id: subscriptionId }, entitlement: { id: 'ent' }, telegram: { queued: true },
    } }, error: null };
    show(); chooseTarget();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    await waitFor(() => expect(state.info).toHaveBeenCalledWith(expect.stringContaining('ещё обрабатывается')));
  });
  it('does not send a write to a backend without the exact guard capability', async () => {
    state.capability = false;
    show(); chooseTarget();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать доступ' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Выдать доступ' }));
    await waitFor(() => expect(state.error).toHaveBeenCalled());
    expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(state.invoke.mock.calls[0][1]).toEqual({ method: 'GET' });
    expect(state.success).not.toHaveBeenCalled();
  });
  it('keeps actions outside the scrollable mobile body and exposes the paid existing-deal entrypoint', () => {
    show();
    expect(screen.getByRole('dialog')).toHaveClass('max-h-[calc(100dvh-24px)]', 'overflow-hidden');
    expect(screen.getByLabelText('Дата и время окончания').closest('fieldset')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    expect(screen.getByRole('button', { name: 'Выдать доступ' }).parentElement).toHaveClass('shrink-0');
    const sheet = readFileSync('src/components/admin/DealDetailSheet.tsx', 'utf8');
    const accessBlock = sheet.slice(sheet.indexOf('{/* Access / Subscription */}'), sheet.indexOf('{/* Documents — единая карточка */}'));
    expect(accessBlock).toContain('subscription && !subscriptionLookupError && isAdmin() && deal.status === "paid" && deal.user_id');
    expect(accessBlock).toContain('Исправить срок доступа');
  });
});
