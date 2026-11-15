import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProgress } from '@/hooks/useUserProgress';
import { supabase } from '@/integrations/supabase/client';
import { SequentialFormBlock, type SequentialFormContent } from '@/components/admin/lesson-editor/blocks/SequentialFormBlock';

type Answers = Record<string, string>;
type Draft = { answers: Answers; completed: boolean; unreadable?: boolean; status: 'idle' | 'saving' | 'saved' | 'error' };
type Store = {
  ready: boolean; failed: boolean; unavailable: boolean; isSubmitting: (id: string) => boolean; retry: () => void;
  draft: (id: string) => Draft;
  edit: (id: string, answers: Answers) => void;
  save: (id: string, answers: Answers, completed: boolean) => Promise<boolean>;
};
const Context = createContext<Store | null>(null);
const empty = (): Draft => ({ answers: {}, completed: false, status: 'idle' });

/** Scope ownership stays ABOVE the renderer's video/timecode remount key. */
export function StandardSequentialFormProvider({ lessonId, children }: { lessonId: string; children: ReactNode }) {
  const { user } = useAuth();
  return <ScopedProvider key={JSON.stringify([user?.id || null, lessonId])} userId={user?.id} lessonId={lessonId}>{children}</ScopedProvider>;
}
function ScopedProvider({ userId, lessonId, children }: { userId?: string; lessonId: string; children: ReactNode }) {
  const { progress, loadState, refetch } = useUserProgress(lessonId);
  const drafts = useRef(new Map<string, Draft>());
  const queues = useRef(new Map<string, Promise<boolean>>());
  const submitting = useRef(new Map<string, Promise<boolean>>());
  const alive = useRef(true);
  const [, render] = useState(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const notify = () => { if (alive.current) render(v => v + 1); };
  const ready = !!userId && !!lessonId && loadState === 'ready';
  const draft = (id: string) => {
    let value = drafts.current.get(id);
    if (!value) {
      const response = progress?.blockProgress[id]?.response;
      // The existing progress reader also supports legacy flat answer maps.
      const wrapped = !!response && Object.prototype.hasOwnProperty.call(response, 'answers');
      const raw = wrapped ? response.answers : response;
      const isAnswerObject = !!raw && typeof raw === 'object' && !Array.isArray(raw);
      const entries = isAnswerObject ? Object.entries(raw).filter(([key]) => wrapped || (key !== 'completed' && key !== 'type')) : [];
      const unreadable = (wrapped || raw !== undefined) && (!isAnswerObject || entries.some(([, value]) => typeof value !== 'string'));
      const answers = unreadable ? {} : Object.fromEntries(entries) as Answers;
      value = { ...empty(), answers, unreadable, completed: response?.completed === true };
      // Never turn an unreadable saved response into an editable empty draft.
      // Keep failed hydration uncached so a subsequent successful read can retry.
      if (ready && !unreadable) drafts.current.set(id, value);
    }
    return value;
  };
  const edit = (id: string, answers: Answers) => {
    if (!ready || draft(id).unreadable || draft(id).completed || submitting.current.has(id)) return;
    drafts.current.set(id, { ...draft(id), answers: { ...answers }, status: 'idle' });
    notify();
  };
  const save = (id: string, answers: Answers, completed: boolean): Promise<boolean> => {
    if (!ready || !alive.current || draft(id).unreadable) return Promise.resolve(false);
    if (submitting.current.has(id)) return submitting.current.get(id)!;
    if (draft(id).completed) return Promise.resolve(true);
    const snapshot = { answers: { ...answers }, completed };
    const previous = queues.current.get(id) || Promise.resolve(true);
    const task = previous.catch(() => false).then(async () => {
      if (!alive.current) return false;
      // A callback queued before completion must not reopen a confirmed form.
      if (draft(id).completed) return true;
      drafts.current.set(id, { ...draft(id), status: 'saving' }); notify();
      try {
        const { error } = await supabase.from('user_lesson_progress').upsert({
          user_id: userId!, lesson_id: lessonId, block_id: id, response: snapshot,
          is_correct: null, score: 0, max_score: 0,
        }, { onConflict: 'user_id,lesson_id,block_id' });
        if (error) throw error;
        const { data, error: readError } = await supabase.from('user_lesson_progress').select('response')
          .eq('user_id', userId!).eq('lesson_id', lessonId).eq('block_id', id).maybeSingle();
        const response = data?.response;
        if (readError || !response || typeof response !== 'object' || Array.isArray(response)) throw new Error('save_not_confirmed');
        const savedAnswers = response.answers;
        if (!savedAnswers || typeof savedAnswers !== 'object' || Array.isArray(savedAnswers)
          || Object.keys(savedAnswers).length !== Object.keys(snapshot.answers).length
          || Object.entries(snapshot.answers).some(([key, value]) => savedAnswers[key] !== value)
          || response.completed !== completed) throw new Error('save_not_confirmed');
        if (!alive.current) return false;
        // Keep newer keystrokes; an earlier blur completion never hydrates them.
        const unchanged = Object.keys(draft(id).answers).length === Object.keys(snapshot.answers).length
          && Object.entries(snapshot.answers).every(([key, value]) => draft(id).answers[key] === value);
        drafts.current.set(id, { ...draft(id), completed: (completed && unchanged) || draft(id).completed, status: unchanged ? 'saved' : 'idle' });
        notify(); return !completed || unchanged;
      } catch {
        if (alive.current) { drafts.current.set(id, { ...draft(id), status: 'error' }); notify(); }
        return false;
      }
    });
    queues.current.set(id, task);
    if (completed) {
      submitting.current.set(id, task); notify();
      void task.finally(() => { if (submitting.current.get(id) === task) { submitting.current.delete(id); notify(); } });
    }
    return task;
  };
  return <Context.Provider value={{ ready, unavailable: loadState === 'unavailable', isSubmitting: id => submitting.current.has(id), failed: loadState === 'error', retry: () => { void refetch(); }, draft, edit, save }}>{children}</Context.Provider>;
}

export function StandardSequentialForm({ blockId, content }: { blockId: string; content: SequentialFormContent }) {
  const store = useContext(Context);
  if (!store || store.unavailable) return <div role="status">Анкета сейчас недоступна. Войдите в аккаунт и откройте урок снова.</div>;
  if (!store.ready) return <div role={store?.failed ? 'alert' : 'status'}>
    {store?.failed ? <>Не удалось загрузить ответы. <button onClick={store.retry}>Попробовать снова</button></> : 'Загрузка ответов…'}
  </div>;
  const current = store.draft(blockId);
  if (current.unreadable) return <div role="alert">
    Не удалось загрузить сохранённые ответы. <button onClick={store.retry}>Попробовать снова</button>
  </div>;
  return <SequentialFormBlock content={content} onChange={() => {}} isEditing={false}
    answers={current.answers} isCompleted={current.completed} submissionPending={store.isSubmitting(blockId)}
    onDraftChange={answers => store.edit(blockId, answers)}
    onAnswersChange={answers => { void store.save(blockId, answers, false); }}
    onSubmit={answers => store.save(blockId, answers, true)}
    onRetrySave={() => { void store.save(blockId, store.draft(blockId).answers, false); }} saveStatus={current.status} />;
}
