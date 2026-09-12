import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientPackageUsage } from './ClientPackageUsage';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getUser: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke }, auth: { getUser: mocks.getUser } } }));
vi.mock('@/hooks/useAiEntities', () => ({ useAiEntities: () => ({ allEntities: [], isLoading: false }) }));
vi.mock('@/hooks/useRequisitesV2', () => ({ useRequisitesV2: () => ({ legalEntities: [], isLoading: false }) }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ClientPackageUsage packageTemplateId="synthetic-package" packageName="Тестовый пакет" packageDescription={null} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});

it('distinguishes failed discovery from a disabled form and retries only the read', async () => {
  let reads = 0;
  mocks.invoke.mockImplementation(async (_name, { body }) => {
    if (body.action === 'owner_history') return { data: { submissions: [] }, error: null };
    reads += 1;
    return reads === 1
      ? { data: null, error: { context: Response.json({ error: 'private backend detail' }, { status: 500 }) } }
      : { data: { forms: [] }, error: null };
  });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить доступные анкеты');
  expect(screen.queryByText(/администратор ещё не включил/)).not.toBeInTheDocument();
  expect(screen.queryByText(/private backend/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(await screen.findByText(/администратор ещё не включил/)).toBeInTheDocument();
  await waitFor(() => expect(reads).toBe(2));
  expect(mocks.invoke.mock.calls.every(([, options]) => ['owner_forms', 'owner_history'].includes(options.body.action))).toBe(true);
});

it('shows disabled only after a successful empty form response', async () => {
  mocks.invoke.mockImplementation(async (_name, { body }) => ({ data: body.action === 'owner_forms' ? { forms: [] } : { submissions: [] }, error: null }));
  mount();
  expect(await screen.findByText(/администратор ещё не включил/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
