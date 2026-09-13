import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExternalDocumentFormPage from './ExternalDocumentFormPage';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), submit: vi.fn(), status: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ token: 'synthetic-test-link' }) }));
const form = { title: 'Тестовая анкета', allow_attachments: false, regular_fields: [], repeat_groups: {}, today: '2026-09-13' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ExternalDocumentFormPage /></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear();
  mocks.submit.mockReset(); mocks.status.mockReset(); mocks.invoke.mockReset();
  mocks.status.mockResolvedValue({ data: { found: false }, error: null });
  mocks.invoke.mockImplementation((_name, options) => {
    if (options.body.action === 'read') return Promise.resolve({ data: form, error: null });
    if (options.body.action === 'submission_status') return mocks.status(options.body);
    if (options.body.action === 'submit') return mocks.submit(options.body);
    throw new Error('Unexpected action');
  });
});

describe('external document form submission states', () => {
  it('restores a pending attempt after reload without submitting again', async () => {
    const requestId = '00000000-0000-4000-8000-000000000007';
    localStorage.setItem('document_submission_request:synthetic-test-link', requestId);
    mocks.status.mockResolvedValue({ data: { found: true, success: false, error: 'generation_in_progress' } });
    mount();
    expect(await screen.findByText('Проверка предыдущей попытки')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить статус' }));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
    expect(mocks.status.mock.calls[0][0].request_id).toBe(requestId);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Сохранить и сформировать' })).not.toBeInTheDocument();
  });
  it('restores a completed result and starts a distinct attempt only on an explicit action', async () => {
    mocks.status.mockResolvedValueOnce({ data: { found: true, success: true, generation_status: 'generated', delivery_complete: true } });
    mount();
    expect(await screen.findByText('Документ сформирован')).toBeInTheDocument();
    const previous = mocks.status.mock.calls[0][0].request_id;
    fireEvent.click(screen.getByRole('button', { name: 'Заполнить новый отчёт' }));
    expect(await screen.findByRole('button', { name: 'Сохранить и сформировать' })).toBeEnabled();
    expect(mocks.status.mock.calls.at(-1)?.[0].request_id).not.toBe(previous);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('prevents a new submit when previous-attempt status cannot be read', async () => {
    mocks.status.mockRejectedValue(new Error('Network unavailable'));
    mount();
    expect(await screen.findByText('Проверка предыдущей попытки')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить и сформировать' })).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('shows a known validation failure and allows correcting it', async () => {
    mocks.submit.mockResolvedValueOnce({ data: null,
      error: { message: 'non-2xx', context: Response.json({ error: 'required_field_missing' }, { status: 400 }) } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Заполните все обязательные поля анкеты.');
    expect(screen.getByRole('button', { name: 'Сохранить и сформировать' })).toBeEnabled();
    expect(screen.queryByText('Документ сформирован')).not.toBeInTheDocument();
  });
  it('does not issue a second submit after an unknown network outcome', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('private URL token'));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Результат формирования пока неизвестен');
    const button = screen.getByRole('button', { name: 'Сохранить и сформировать' });
    expect(button).toBeDisabled(); fireEvent.click(button);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).not.toHaveTextContent('private');
  });
  it('distinguishes partial generation from confirmed delivery', async () => {
    mocks.submit.mockResolvedValueOnce({ error: null,
      data: { success: true, document_ids: ['00000000-0000-4000-8000-000000000001'], generation_status: 'partial', delivery_complete: false } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByText('Документы сформированы частично')).toBeInTheDocument();
    expect(screen.getByText(/Отправка подтверждена не по всем каналам/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить и сформировать' })).not.toBeInTheDocument();
  });
  it.each(['submit', 'restore'])('reports disabled delivery without claiming a send (%s)', async (mode) => {
    const data = { found: true, success: true, document_ids: ['00000000-0000-4000-8000-000000000001'], generation_status: 'generated', delivery_complete: false, delivery_skipped: true };
    if (mode === 'restore') mocks.status.mockResolvedValue({ data });
    else mocks.submit.mockResolvedValue({ data });
    mount();
    if (mode === 'submit') fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByText('Документ сформирован')).toBeInTheDocument();
    expect(screen.getByText(/Доставка по email и Telegram отключена владельцем ссылки/)).toBeInTheDocument();
    expect(screen.queryByText(/Отправка готовых документов по выбранным каналам подтверждена/)).not.toBeInTheDocument();
  });
  it('does not accept HTTP 200 without document IDs as completed', async () => {
    mocks.submit.mockResolvedValueOnce({ error: null, data: { success: true, document_ids: [] } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Сохранить и сформировать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Результат формирования пока неизвестен');
  });
});
