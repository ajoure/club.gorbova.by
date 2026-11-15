import { act, fireEvent, render, screen, waitFor, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLessonBlockEditor from '@/pages/admin/AdminLessonBlockEditor';
import { SiteQuestionnaireBlock } from '@/components/site-renderer/blocks/SiteQuestionnaireBlock';
import { StandardSequentialFormProvider, StandardSequentialForm } from './StandardSequentialForm';
import { useUserProgress } from '@/hooks/useUserProgress';
import { SequentialFormBlock } from '@/components/admin/lesson-editor/blocks/SequentialFormBlock';
const mock = vi.hoisted(() => ({ user: 'actor-a' as string | undefined, rows: new Map<string, unknown>(),
  writes: [] as any[], failLoad: false, failWrite: false, failReadback: false,
  holdWrite: null as null | Promise<void>, holdLoad: null as null | Promise<void>, invoke: vi.fn(), success: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user ? { id: mock.user } : null }) }));
vi.mock('sonner', () => ({ toast: { success: mock.success, error: vi.fn() } }));
vi.mock('@/components/ui/SafeHtml', () => ({ SafeHtml: ({ html }: { html: string }) => <span>{html}</span> }));
vi.mock('@/components/ui/RichTextarea', () => ({ RichTextarea: () => null }));
vi.mock('@/components/admin/lesson-editor/blocks/uploadToTrainingAssets', () => ({ deleteTrainingAssetReferences: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: mock.invoke },
  from: (table: string) => ({
    select: () => {
      const filters: Record<string, string> = {};
      const query: any = { eq: (key: string, value: string) => { filters[key] = value; return query; },
        maybeSingle: async () => table === 'training_lessons' ? { data: { id: 'lesson-a', training_modules: { slug: '__site_questionnaires__' } }, error: null } : ({ data: mock.failReadback ? null : { response: mock.rows.get(`${filters.user_id}/${filters.lesson_id}/${filters.block_id}`) }, error: mock.failReadback ? Error('readback') : null }),
        then: async (resolve: (v: unknown) => void) => {
          const actor = filters.user_id, lesson = filters.lesson_id;
          const rows = [...mock.rows].filter(([key]) => key.startsWith(`${actor}/${lesson}/`))
            .map(([key, response]) => ({ id: key, block_id: key.split('/')[2], response, attempts: 37, started_at: '2001-01-01T00:00:00Z' }));
          const failed = mock.failLoad;
          if (mock.holdLoad) await mock.holdLoad;
          resolve({ data: rows, error: failed ? Error('load') : null });
        } };
      return query;
    },
    upsert: async (row: any) => {
      mock.writes.push(structuredClone(row));
      if (mock.holdWrite) await mock.holdWrite;
      if (mock.failWrite) return { error: Error('write') };
      mock.rows.set(`${row.user_id}/${row.lesson_id}/${row.block_id}`, row.response);
      return { error: null };
    },
  }),
} }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ lessonId: 'lesson-a', moduleId: 'module-a' }), Link: ({ children }: any) => <a>{children}</a> }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: { id: 'lesson-a', title: 'Synthetic lesson' }, isLoading: false }) }));
vi.mock('@/components/layout/AdminLayout', () => ({ AdminLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/admin/lesson-editor/LessonBlockEditor', () => ({ LessonBlockEditor: () => null }));
vi.mock('@/components/admin/trainings/LessonThumbnailEditor', () => ({ LessonThumbnailEditor: () => null }));
vi.mock('@/hooks/useResetProgress', () => ({ useResetProgress: () => ({ resetProgress: vi.fn() }) }));
vi.mock('@/hooks/useLessonBlocks', () => ({ useLessonBlocks: () => ({ loading: false, refetch: async () => {}, blocks: [{ id: 'block-a', block_type: 'sequential_form', content: { steps: [{ id: 'q', title: 'Question', description: 'Describe', inputType: 'text', required: true }], submitButtonText: 'Save form' } }] }) }));
const content = { title: 'Synthetic form', steps: [{ id: 'q', title: 'Question', description: 'Describe', inputType: 'text' as const, required: true }], submitButtonText: 'Save form' };
function Tree({ nonce = '0', lesson = 'lesson-a', two = false }: { nonce?: string; lesson?: string; two?: boolean }) {
  return <StandardSequentialFormProvider lessonId={lesson}><section key={nonce}>
    <StandardSequentialForm blockId="block-a" content={content} />
    {two && <StandardSequentialForm blockId="block-b" content={content} />}
  </section></StandardSequentialFormProvider>;
}
const input = () => screen.getAllByPlaceholderText('Ваш ответ...')[0];
async function ready() { await waitFor(() => expect(screen.getAllByPlaceholderText('Ваш ответ...').length).toBeGreaterThan(0)); }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
afterEach(cleanup);
beforeEach(() => { mock.user = 'actor-a'; mock.rows.clear(); mock.writes = []; mock.failLoad = false; mock.failWrite = false; mock.failReadback = false; mock.holdWrite = null; mock.holdLoad = null; mock.invoke.mockReset(); mock.success.mockReset(); });

describe('standard form persistence', () => {
  it('hydrates legacy flat answers without treating metadata as answers', async () => {
    mock.rows.set('actor-a/lesson-a/block-a', { q: 'legacy answer', completed: false, type: 'sequential_form' });
    render(<Tree />); await ready();
    expect(input()).toHaveValue('legacy answer'); expect(mock.writes).toHaveLength(0);
    fireEvent.change(input(), { target: { value: 'updated answer' } }); fireEvent.blur(input());
    await waitFor(() => expect(mock.rows.get('actor-a/lesson-a/block-a')).toEqual({ answers: { q: 'updated answer' }, completed: false }));
  });
  it('hydrates completed legacy flat responses as completed', async () => {
    mock.rows.set('actor-a/lesson-a/block-a', { q: 'legacy completed', completed: true });
    render(<Tree />); await ready();
    expect(input()).toHaveValue('legacy completed'); expect(input()).toBeDisabled();
    expect(screen.getByText('Ответы сохранены')).toBeInTheDocument(); expect(mock.writes).toHaveLength(0);
  });
  it('blocks malformed stored answers without empty overwrite and can retry the read', async () => {
    mock.rows.set('actor-a/lesson-a/block-a', { answers: { q: 42 }, completed: false });
    render(<Tree />); await screen.findByRole('alert');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(mock.writes).toHaveLength(0);
    mock.rows.set('actor-a/lesson-a/block-a', { answers: { q: 'recovered read' }, completed: false });
    fireEvent.click(screen.getByText('Попробовать снова')); await ready();
    expect(input()).toHaveValue('recovered read'); expect(mock.writes).toHaveLength(0);
  });
  it('saves draft, hydrates on real reload, submits without AI or grades', async () => {
    const view = render(<Tree />); await ready();
    fireEvent.change(input(), { target: { value: 'answer' } }); fireEvent.blur(input());
    await waitFor(() => expect(mock.rows.size).toBe(1));
    view.unmount(); render(<Tree />); await ready(); expect(input()).toHaveValue('answer');
    fireEvent.click(screen.getByText('Save form'));
    await waitFor(() => expect(input()).toBeDisabled());
    expect(mock.writes.at(-1)).toMatchObject({ response: { answers: { q: 'answer' }, completed: true }, is_correct: null, score: 0, max_score: 0 });
    expect(mock.writes.at(-1)).not.toHaveProperty('completed_at');
    expect(mock.invoke).not.toHaveBeenCalled(); expect(mock.success).not.toHaveBeenCalled();
    cleanup(); render(<Tree />); await ready(); expect(input()).toHaveValue('answer'); expect(input()).toBeDisabled();
  });
  it('keeps unblurred draft across renderer timecode remount and isolates blocks', async () => {
    const view = render(<Tree two />); await ready();
    fireEvent.change(input(), { target: { value: 'private draft' } });
    view.rerender(<Tree nonce="timecode-2" two />); await ready();
    expect(input()).toHaveValue('private draft'); expect(screen.getAllByPlaceholderText('Ваш ответ...')[1]).toHaveValue('');
    expect(mock.writes).toHaveLength(0);
  });
  it('blocks on initial read error, retry loads instead of writing empty answers', async () => {
    mock.failLoad = true; render(<Tree />);
    await screen.findByRole('alert'); expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(mock.writes).toHaveLength(0);
    mock.failLoad = false; fireEvent.click(screen.getByText('Попробовать снова')); await ready(); expect(mock.writes).toHaveLength(0);
  });
  it('retains dirty answers after failed submit and confirms only successful retry', async () => {
    mock.failWrite = true; render(<Tree />); await ready();
    fireEvent.change(input(), { target: { value: 'retain' } }); fireEvent.click(screen.getByText('Save form'));
    await screen.findByRole('alert'); expect(input()).toHaveValue('retain'); expect(input()).not.toBeDisabled();
    mock.failWrite = false; fireEvent.click(screen.getByText('Save form')); await waitFor(() => expect(input()).toBeDisabled());
  });
  it('does not lock after failed readback', async () => {
    mock.failReadback = true; render(<Tree />); await ready(); fireEvent.change(input(), { target: { value: 'retain' } });
    fireEvent.click(screen.getByText('Save form')); await screen.findByRole('alert'); expect(input()).not.toBeDisabled();
  });
  it('orders a slow blur before final snapshot and deduplicates final double click', async () => {
    const gate = deferred(); mock.holdWrite = gate.promise; render(<Tree />); await ready();
    fireEvent.change(input(), { target: { value: 'old' } }); fireEvent.blur(input());
    await waitFor(() => expect(mock.writes).toHaveLength(1));
    fireEvent.change(input(), { target: { value: 'final' } });
    const submit = screen.getByText('Save form'); fireEvent.click(submit); fireEvent.click(submit);
    expect(mock.writes).toHaveLength(1);
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(input()).toBeDisabled());
    expect(mock.writes).toHaveLength(2); expect(mock.writes[1].response).toEqual({ answers: { q: 'final' }, completed: true });
    expect(input()).toHaveValue('final');
  });
  it('persists clearing a previously saved value but does not write on initial mount', async () => {
    mock.rows.set('actor-a/lesson-a/block-a', { answers: { q: 'old' }, completed: false }); render(<Tree />); await ready();
    expect(mock.writes).toHaveLength(0); fireEvent.change(input(), { target: { value: '' } }); fireEvent.blur(input());
    await waitFor(() => expect(mock.writes).toHaveLength(1)); expect(mock.writes[0].response.answers).toEqual({ q: '' });
  });
  it.each(['actor', 'lesson'])('ignores delayed old %s reads and private drafts', async kind => {
    const gate = deferred(); mock.holdLoad = gate.promise;
    mock.rows.set('actor-a/lesson-a/block-a', { answers: { q: 'old private answer' } });
    const view = render(<Tree />);
    await act(async () => {});
    if (kind === 'actor') mock.user = 'actor-b';
    mock.holdLoad = null;
    view.rerender(<Tree lesson={kind === 'lesson' ? 'lesson-b' : 'lesson-a'} />); await ready();
    await act(async () => { gate.resolve(); }); expect(input()).toHaveValue(''); expect(mock.writes).toHaveLength(0);
  });
  it('retains newer dirty input after an earlier blur finishes and across remount', async () => {
    const gate = deferred(); mock.holdWrite = gate.promise;
    const view = render(<Tree />); await ready();
    fireEvent.change(input(), { target: { value: 'old blur' } }); fireEvent.blur(input());
    await waitFor(() => expect(mock.writes).toHaveLength(1));
    fireEvent.change(input(), { target: { value: 'new dirty' } });
    await act(async () => { gate.resolve(); });
    view.rerender(<Tree nonce="seek-after-blur" />); await ready();
    expect(input()).toHaveValue('new dirty'); expect(input()).not.toBeDisabled();
  });
  it('cancels queued old-scope saves after actor changes without writing new actor data', async () => {
    const gate = deferred(); mock.holdWrite = gate.promise;
    const view = render(<Tree />); await ready();
    fireEvent.change(input(), { target: { value: 'old' } }); fireEvent.blur(input());
    await waitFor(() => expect(mock.writes).toHaveLength(1));
    fireEvent.change(input(), { target: { value: 'queued' } }); fireEvent.blur(input());
    mock.user = 'actor-b'; mock.holdWrite = null; view.rerender(<Tree />); await ready();
    await act(async () => { gate.resolve(); });
    expect(input()).toHaveValue(''); expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0].user_id).toBe('actor-a');
  });
  it('guards delayed useUserProgress reads even without a keyed component remount', async () => {
    const gate = deferred(); mock.holdLoad = gate.promise;
    mock.rows.set('actor-a/lesson-a/block-a', { answers: { q: 'private' } });
    const hook = renderHook(({ lesson }) => useUserProgress(lesson), { initialProps: { lesson: 'lesson-a' } });
    await act(async () => {});
    mock.user = 'actor-b'; mock.holdLoad = null; hook.rerender({ lesson: 'lesson-b' });
    await waitFor(() => expect(hook.result.current.loadState).toBe('ready'));
    await act(async () => { gate.resolve(); });
    expect(hook.result.current.progress?.lessonId).toBe('lesson-b');
    expect(hook.result.current.progress?.blockProgress).toEqual({});
  });
  it('slow final survives renderer remount and late blur without reopening persisted completion', async () => {
    const gate = deferred(); mock.holdWrite = gate.promise;
    const view = render(<Tree />); await ready();
    fireEvent.change(input(), { target: { value: 'final answer' } });
    fireEvent.click(screen.getByText('Save form')); await waitFor(() => expect(mock.writes).toHaveLength(1));
    view.rerender(<Tree nonce="seek-during-final" />); await ready();
    expect(input()).toHaveValue('final answer'); expect(input()).toBeDisabled();
    fireEvent.blur(input()); // late callback after the submitting component remounted
    await act(async () => { gate.resolve(); });
    await screen.findByText('Ответы сохранены');
    expect(mock.writes).toHaveLength(1);
    expect(mock.rows.get('actor-a/lesson-a/block-a')).toEqual({ answers: { q: 'final answer' }, completed: true });
    cleanup(); render(<Tree />); await ready(); expect(input()).toBeDisabled();
    expect(screen.getByText('Ответы сохранены')).toBeInTheDocument();
  });
  it('offers explicit retry after failed autosave clearing a required field', async () => {
    mock.rows.set('actor-a/lesson-a/block-a', { answers: { q: 'old' }, completed: false });
    mock.failWrite = true; render(<Tree />); await ready();
    fireEvent.change(input(), { target: { value: '' } }); fireEvent.blur(input());
    await screen.findByRole('alert'); expect(screen.getByText('Save form')).toBeDisabled();
    mock.failWrite = false; fireEvent.click(screen.getByText('Повторить сохранение'));
    await waitFor(() => expect(mock.rows.get('actor-a/lesson-a/block-a')).toEqual({ answers: { q: '' }, completed: false }));
    expect(input()).toHaveValue(''); expect(input()).not.toBeDisabled(); expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('missing provider shows unavailable instead of an eternal loading state', () => {
    render(<StandardSequentialForm blockId="block-a" content={content} />);
    expect(screen.getByText(/Анкета сейчас недоступна/)).toBeInTheDocument();
    expect(screen.queryByText('Загрузка ответов…')).not.toBeInTheDocument(); expect(mock.writes).toHaveLength(0);
  });
  it('scope masks getter and prior attempt metadata while a new actor read is pending', async () => {
    mock.rows.set('actor-a/lesson-a/block-a', { answers: { q: 'old private' } });
    const hook = renderHook(() => useUserProgress('lesson-a'));
    await waitFor(() => expect(hook.result.current.loadState).toBe('ready'));
    expect(hook.result.current.getBlockProgress('block-a')?.attempts).toBe(37);
    const gate = deferred(); mock.holdLoad = gate.promise; mock.user = 'actor-b'; hook.rerender();
    expect(hook.result.current.getBlockProgress('block-a')).toBeNull();
    await act(async () => { void hook.result.current.saveBlockResponse('block-a', { answers: {} }, null, 0, 0); });
    await waitFor(() => expect(mock.writes).toHaveLength(1));
    expect(mock.writes[0].attempts).toBe(1); expect(mock.writes[0].started_at).not.toBe('2001-01-01T00:00:00Z');
    await act(async () => { gate.resolve(); });
  });
  it.each(['actor', 'lesson'])('does not write without %s', async kind => {
    if (kind === 'actor') mock.user = undefined;
    render(<Tree lesson={kind === 'lesson' ? '' : 'lesson-a'} />); await act(async () => {});
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(mock.writes).toHaveLength(0);
    expect(screen.getByText(/Анкета сейчас недоступна/)).toBeInTheDocument();
  });
});

describe('optional submit keeps legacy Kvest behavior', () => {
  it('manual false and rejection retain input and allow retry without AI/preview', async () => {
    const submit = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(Error('failed')).mockResolvedValue(true);
    render(<SequentialFormBlock content={content} onChange={() => {}} isEditing={false} onSubmit={submit} />);
    fireEvent.change(input(), { target: { value: 'manual' } });
    fireEvent.click(screen.getByText('Save form')); await screen.findByRole('alert'); expect(input()).toHaveValue('manual');
    fireEvent.click(screen.getByText('Save form')); await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText('Save form')); await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    expect(mock.invoke).not.toHaveBeenCalled(); expect(mock.success).not.toHaveBeenCalled();
  });
  it('default Kvest still invokes AI and original completion callback', async () => {
    mock.invoke.mockResolvedValue({ data: { summary: 'Summary' }, error: null }); const complete = vi.fn();
    render(<SequentialFormBlock content={content} onChange={() => {}} isEditing={false} onComplete={complete} />);
    fireEvent.change(input(), { target: { value: 'Kvest' } }); fireEvent.click(screen.getByText('Save form'));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce()); expect(mock.invoke).toHaveBeenCalledOnce();
  });
  it('retains the default Kvest completion wording', () => {
    render(<SequentialFormBlock content={content} onChange={() => {}} isEditing={false} isCompleted />);
    expect(screen.getByText('Формула сформирована')).toBeInTheDocument();
    expect(screen.queryByText('Ответы сохранены')).not.toBeInTheDocument();
  });
});


describe('real caller integration boundaries', () => {
  it('admin explicitly previews without saving, AI or completion success', async () => {
    render(<AdminLessonBlockEditor />);
    fireEvent.click(screen.getByText('Просмотр'));
    await screen.findByText('Предпросмотр: ответы не сохраняются');
    fireEvent.change(input(), { target: { value: 'admin preview' } }); fireEvent.blur(input());
    const submit = screen.getByText('Save form'); expect(submit).toBeDisabled(); fireEvent.click(submit);
    expect(mock.writes).toHaveLength(0); expect(mock.invoke).not.toHaveBeenCalled(); expect(mock.success).not.toHaveBeenCalled();
  });
  it('site questionnaire saves and reloads through its real scoped provider and renderer', async () => {
    const view = render(<SiteQuestionnaireBlock content={{ lessonId: 'lesson-a' }} />); await ready();
    fireEvent.change(input(), { target: { value: 'site answer' } }); fireEvent.blur(input());
    await waitFor(() => expect(mock.rows.get('actor-a/lesson-a/block-a')).toEqual({ answers: { q: 'site answer' }, completed: false }));
    view.unmount(); render(<SiteQuestionnaireBlock content={{ lessonId: 'lesson-a' }} />); await ready();
    expect(input()).toHaveValue('site answer'); expect(mock.invoke).not.toHaveBeenCalled();
  });
  it.each(['anonymous', 'missing-lesson'])('site questionnaire unavailable for %s never writes', async kind => {
    if (kind === 'anonymous') mock.user = undefined;
    render(<SiteQuestionnaireBlock content={{ lessonId: kind === 'missing-lesson' ? '' : 'lesson-a' }} />);
    await act(async () => {});
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mock.writes).toHaveLength(0); expect(mock.invoke).not.toHaveBeenCalled();
  });

});
