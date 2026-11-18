import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GlobalPaymentHandler } from './GlobalPaymentHandler';

const mock = vi.hoisted(() => ({ user: { id: 'owned-user' }, row: null as any, from: vi.fn(), eq: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mock.from } }));
beforeEach(() => {
  mock.row = { id: 'owned-order', status: 'partial', order_number: 'ZG27-TEST', final_price: 890, currency: 'BYN',
    created_at: '2026-11-18T12:00:00Z', is_trial: false, trial_end_at: null,
    meta: { zg27_installment: {}, zg27_mandate_state: 'mandate_verified' },
    products_v2: { name: 'Закрой год 2027' }, tariffs: { name: 'Повторное участие', access_days: 60, trial_days: null },
    purchase_snapshot: { course_access: { kind: 'fixed_exclusive_end', timezone: 'Europe/Minsk', end_exclusive: '2027-04-30T21:00:00.000Z' } },
    payments_v2: [{ status: 'succeeded' }] };
  mock.eq.mockReset(); mock.from.mockReset().mockImplementation((table: string) => {
    expect(table).toBe('orders_v2');
    const q: any = { select: () => q, eq: (...args: any[]) => { mock.eq(...args); return q; },
      order: () => q, limit: () => q, maybeSingle: async () => ({ data: mock.row, error: null }) };
    return q;
  });
});
afterEach(cleanup);
function view(search = 'status=success&order=owned-order') {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/purchases?${search}`]}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><GlobalPaymentHandler /></MemoryRouter></QueryClientProvider>);
}
describe('actual hosted return and mandatory subscription confirmation', () => {
  it('canonical status=success opens processing and never treats receipt alone as an active subscription', async () => {
    view(); await waitFor(() => expect(mock.from).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Проверяем оплату...' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Оплата подтверждена!' })).not.toBeInTheDocument();
    expect(mock.eq).toHaveBeenCalledWith('user_id', 'owned-user'); expect(mock.eq).toHaveBeenCalledWith('id','owned-order');
  });
  it('ready subscription confirms exact end date and closes without reopening from status alias', async () => {
    mock.row.meta.zg27_mandate_state = 'ready'; view();
    expect(await screen.findByRole('heading', { name: 'Оплата подтверждена!' })).toBeInTheDocument();
    expect(screen.getByText(/30 апреля 2027/)).toBeInTheDocument();
    expect(screen.getByText('Всего по заказу:')).toBeInTheDocument();
    expect(screen.getByText(/После последнего платежа списания прекращаются/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('received payment without required mandate shows setup failure and no access or second-charge promise', async () => {
    mock.row.meta.zg27_mandate_state = 'setup_failed'; view();
    expect(await screen.findByRole('heading', { name: 'Подписка не подтверждена' })).toBeInTheDocument();
    expect(screen.getByText(/Не оплачивайте первый взнос повторно/)).toBeInTheDocument();
    expect(screen.queryByText('Полный доступ')).not.toBeInTheDocument();
  });
  it('canonical decline status enters failure without treating it as a successful receipt', async () => {
    view('status=decline&order=owned-order');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Оплата подтверждена!' })).not.toBeInTheDocument();
    expect(screen.getByText(/Если деньги уже списались, не оплачивайте повторно/)).toBeInTheDocument();
    expect(screen.queryByText(/Доступ не выдан/)).not.toBeInTheDocument();
    expect(mock.from).not.toHaveBeenCalled();
  });
});
