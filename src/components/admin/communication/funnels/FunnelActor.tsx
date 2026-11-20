import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createCapturedBearerTransport, type CapturedBearerDataTransport } from '@/integrations/supabase/client';
import { funnelDb } from './contracts';

export interface FunnelActorLease {
  actorId: string;
  client: CapturedBearerDataTransport;
  bearer: string;
  run<T>(work: () => PromiseLike<T>): Promise<T>;
}
interface ActorScope {
  actorId: string;
  generation: number;
  lease(): Promise<FunnelActorLease>;
  read<T>(work: (client: CapturedBearerDataTransport) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T>;
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
}
const ActorContext = createContext<ActorScope | null>(null);
const changed = () => Error('Аккаунт изменился. Действие остановлено; незавершённый запуск сохранён для исходного аккаунта.');
/** Remount on identity/lifecycle changes, while keeping unresolved intents with their owner. */
export function FunnelActorBoundary({ children }: { children: ReactNode }) {
  const current = useRef({ actorId: '', generation: 0, initialEpoch: 0, mounted: false });
  const [scope, setScope] = useState<{ actorId: string; generation: number } | null>(null);
  useEffect(() => {
    current.current.mounted = true;
    const accept = (actorId: string, event?: string) => {
      if (!current.current.mounted) return;
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') current.current.initialEpoch++;
      // SIGNED_IN can also mean same-session tab refocus; do not discard its draft.
      if (current.current.actorId !== actorId || event === 'SIGNED_OUT') { current.current.actorId = actorId; current.current.generation++; }
      setScope({ actorId, generation: current.current.generation });
    };
    const { data } = funnelDb.auth.onAuthStateChange((event, session) => accept(session?.user?.id || '', event));
    const generation = current.current.generation, initialEpoch = current.current.initialEpoch;
    void funnelDb.auth.getSession().then(({ data, error }) => {
      if (current.current.mounted && generation === current.current.generation && initialEpoch === current.current.initialEpoch) accept(error ? '' : data.session?.user?.id || '');
    });
    return () => { current.current.mounted = false; current.current.generation++; data.subscription.unsubscribe(); };
  }, []);
  const value = useMemo<ActorScope | null>(() => {
    if (!scope?.actorId) return null;
    const assertCurrent = () => {
      if (!current.current.mounted || current.current.actorId !== scope.actorId || current.current.generation !== scope.generation) throw changed();
    };
    const session = async () => {
      assertCurrent();
      const { data, error } = await funnelDb.auth.getSession();
      assertCurrent();
      if (error || !data.session?.access_token || data.session.user.id !== scope.actorId) {
        current.current.actorId = error ? '' : data.session?.user?.id || '';
        current.current.generation++;
        setScope({ actorId: current.current.actorId, generation: current.current.generation });
        throw changed();
      }
      return data.session;
    };
    const transports = new Map<string, CapturedBearerDataTransport>();
    const lease = async (): Promise<FunnelActorLease> => {
      const captured = await session();
      assertCurrent();
      // This transport never consults the mutable global SDK session for Authorization.
      let client = transports.get(captured.access_token);
      if (!client) client = createCapturedBearerTransport(captured.access_token);
      transports.set(captured.access_token, client);
      if (transports.size > 4) transports.delete(transports.keys().next().value!);
      return { actorId: scope.actorId, bearer: captured.access_token, client,
        async run<T>(work: () => PromiseLike<T>) {
          await session(); assertCurrent();
          try { const result = await work(); await session(); assertCurrent(); return result; }
          catch (error) { await session(); assertCurrent(); throw error; }
        },
      };
    };
    const read = async <T,>(work: (client: CapturedBearerDataTransport) => PromiseLike<{ data: unknown; error: unknown }>) => {
      const owned = await lease();
      const { data, error } = await owned.run(() => work(owned.client));
      if (error) throw error; return data as T;
    };
    return { ...scope, lease, read, rpc: <T,>(name: string, args: Record<string, unknown>) => read<T>(client => client.rpc(name, args)) };
  }, [scope?.actorId, scope?.generation]);
  if (!scope) return <p role="status">Проверяем аккаунт…</p>;
  if (!value) return <p role="alert">Войдите в аккаунт для работы с воронками.</p>;
  return <ActorContext.Provider value={value}><Fragment key={`${value.actorId}:${value.generation}`}>{children}</Fragment></ActorContext.Provider>;
}
export function useFunnelActor(): ActorScope {
  const actor = useContext(ActorContext);
  if (!actor) throw Error('Аккаунт воронки не определён.');
  return actor;
}
export async function runFunnelRpc<T>(lease: FunnelActorLease, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await lease.run(() => lease.client.rpc(name, args));
  if (error) throw error; return data as T;
}
