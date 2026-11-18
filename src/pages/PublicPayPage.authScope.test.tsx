import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicPayPage from './PublicPayPage';

const mock = vi.hoisted(() => ({ user: { id: 'actor-a' } as any, getSession: vi.fn(), rpc: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: mock.getSession }, rpc: mock.rpc } }));
vi.mock('@/config/paymentFeatures', () => ({ SAVED_CARD_PAYMENTS_ENABLED: false }));
vi.mock('@/components/landing/LandingHeader', () => ({ LandingHeader: () => null }));
vi.mock('@/components/landing/LandingFooter', () => ({ LandingFooter: () => null }));
vi.mock('@/components/auth/InlineAuthForm', () => ({ InlineAuthForm: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('does not cache a switched account session under the earlier public-link actor key', async () => {
  let resolveOld: (value: any) => void = () => {};
  mock.user = { id: 'actor-a' };
  mock.rpc.mockResolvedValue({ data: { available_minor: 0, eligible: false }, error: null });
  mock.getSession.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ data: { session: { user: { id: 'actor-b' }, access_token: 'synthetic-b' } } });
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ product_id: 'synthetic-product', product_name: 'Test',
    payment_type: 'one_time', amount: 100, currency: 'BYN', has_target_user: true, link_user_id: 'actor-b',
    requires_identity_input: false, requires_auth: false }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/pay/test-token']}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/pay/:token" element={<PublicPayPage />} /></Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); await waitFor(() => expect(mock.getSession).toHaveBeenCalledOnce());
  await act(async () => { mock.user = { id: 'actor-b' }; view.rerender(tree()); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await act(async () => { resolveOld({ data: { session: { user: { id: 'actor-b' }, access_token: 'synthetic-b' } } }); });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer synthetic-b');
  expect(client.getQueryData(['public-pay','test-token','actor-a'])).toBeUndefined();
  expect(client.getQueryData(['public-pay','test-token','actor-b'])).toMatchObject({ link_user_id: 'actor-b' });
});
