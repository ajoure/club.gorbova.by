import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ ordersError: false, subscriptionsError: false }));
const payment = (id: string, paid_at: string) => ({
  id: `pay-${id}`, amount: 250, paid_at, status: 'succeeded', provider: 'bepaid',
  receipt_url: 'https://example.invalid/receipt', meta: null,
});
const orders = ['january', 'october'].map((id, index) => ({
  id, user_id: 'owner', product_id: 'club', tariff_id: 'business',
  bepaid_subscription_id: 'sbs-example', status: 'paid', final_price: 250,
  payments_v2: [payment(id, index ? '2026-10-13T06:00:00Z' : '2026-01-18T06:00:00Z')],
}));
const subscription = {
  id: 'sub', user_id: 'owner', product_id: 'club', tariff_id: 'business', order_id: 'january',
  meta: { bepaid_subscription_id: 'sbs-example' }, status: 'active', access_end_at: '2099-01-01',
  canceled_at: null, products_v2: { id: 'club', code: 'club', name: 'Club' },
  orders_v2: orders[0],
};
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === 'user-orders-v2' ? orders
      : queryKey[0] === 'user-subscriptions-v2' ? [subscription] : [],
    isLoading: false,
    isError: queryKey[0] === 'user-orders-v2' ? state.ordersError
      : queryKey[0] === 'user-subscriptions-v2' ? state.subscriptionsError : false,
  }),
}));
vi.mock('@/hooks/useTelegramLink', () => ({ useTelegramLinkStatus: () => ({ data: { status: 'active' } }) }));
vi.mock('@/components/layout/DashboardLayout', () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/purchases/SubscriptionListItem', () => ({ SubscriptionListItem: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>Open subscription</button> }));
vi.mock('@/components/purchases/OrderListItem', () => ({ OrderListItem: () => null }));
vi.mock('@/components/purchases/SubscriptionDetailSheet', () => ({
  SubscriptionDetailSheet: ({ open, lastPaidOrderId, receiptPaymentId }: {
    open: boolean; lastPaidOrderId: string | null; receiptPaymentId: string | null;
  }) => open ? <output data-testid="document-target">{JSON.stringify({ lastPaidOrderId, receiptPaymentId })}</output> : null,
}));

import Purchases from './Purchases';

describe('Purchases subscription document wiring', () => {
  beforeEach(() => { cleanup(); state.ordersError = false; state.subscriptionsError = false; });
  it('opens documents and receipt for October although the subscription creation FK is January', () => {
    render(<Purchases />);
    fireEvent.click(screen.getByText('Open subscription'));
    expect(JSON.parse(screen.getByTestId('document-target').textContent!)).toEqual({
      lastPaidOrderId: 'october', receiptPaymentId: 'pay-october',
    });
  });
  it.each(['ordersError', 'subscriptionsError'] as const)('does not fall back to January on cached-data %s', key => {
    state[key] = true;
    render(<Purchases />);
    fireEvent.click(screen.getByText('Open subscription'));
    expect(JSON.parse(screen.getByTestId('document-target').textContent!)).toEqual({
      lastPaidOrderId: null, receiptPaymentId: null,
    });
  });
});
