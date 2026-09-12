import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExternalDocumentFormPage from './ExternalDocumentFormPage';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ token: 'synthetic-test-link' }) }));
const form = { title: 'Тестовая анкета', allow_attachments: false, regular_fields: [], repeat_groups: {}, today: '2026-09-13' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ExternalDocumentFormPage /></QueryClientProvider>);
}
beforeEach(() => mocks.invoke.mockReset());

describe('external document form submission states', () => {
  it('shows a known validation failure and allows correcting it', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: form, error: null }).mockResolvedValueOnce({ data: null,
      error: { message: 'non-2xx', context: Response.json({ error: 'required_field_missing' }, { status: 400 }) } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Заполните все обязательные поля анкеты.');
    expect(screen.getByRole('button', { name: 'Сохранить и сформировать' })).toBeEnabled();
    expect(screen.queryByText('Документ сформирован')).not.toBeInTheDocument();
  });
  it('does not issue a second submit after an unknown network outcome', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: form, error: null }).mockRejectedValueOnce(new Error('private URL token'));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Результат формирования пока неизвестен');
    const button = screen.getByRole('button', { name: 'Сохранить и сформировать' });
    expect(button).toBeDisabled(); fireEvent.click(button);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).not.toHaveTextContent('private');
  });
  it('distinguishes partial generation from confirmed delivery', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: form, error: null }).mockResolvedValueOnce({ error: null,
      data: { success: true, document_ids: ['00000000-0000-4000-8000-000000000001'], generation_status: 'partial', delivery_complete: false } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByText('Документы сформированы частично')).toBeInTheDocument();
    expect(screen.getByText(/Отправка подтверждена не по всем каналам/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить и сформировать' })).not.toBeInTheDocument();
  });
  it('does not accept HTTP 200 without document IDs as completed', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: form, error: null }).mockResolvedValueOnce({ error: null, data: { success: true, document_ids: [] } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Результат формирования пока неизвестен');
  });
});
