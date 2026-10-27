import type {
  AiResult,
  WorkspaceResponse,
} from "../../supabase/functions/_shared/custdev-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  clone,
  type CustdevState,
  emptyState,
  type Sources,
} from "../../supabase/functions/_shared/custdev-contract";

export interface CustdevWorkspace {
  id: string;
  revision: number;
  status: "draft" | "submitted" | "approved" | "changes_requested";
  review_notes: string;
  submitted_at: string | null;
  reviewed_at: string | null;
}
export interface AiRun {
  id: string;
  action: string;
  segment_id: string | null;
  target_id: string | null;
  created_at: string;
  status: string;
  result?: AiResult;
  error_code?: string;
}
export interface Version {
  id: string;
  revision: number;
  status: string;
  created_at: string;
  state?: CustdevState;
}
const blankSources: Sources = {
  portfolio: [],
  products: [],
  context: {},
  lessons: [],
  warnings: [],
};

export function useCustdevWorkspace(
  lessonId: string,
  blockId: string,
  ownerId?: string,
  reviewMode = false,
  onSaved?: () => void,
) {
  const { user } = useAuth(),
    key = `custdev:v1:${user?.id}:${ownerId ?? user?.id}:${blockId}`;
  const [state, setState] = useState<CustdevState>(emptyState),
    [workspace, setWorkspace] = useState<CustdevWorkspace | null>(null),
    [sources, setSources] = useState<Sources>(blankSources),
    [hashes, setHashes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true),
    [saveStatus, setSaveStatus] = useState("idle"),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [isAdmin, setIsAdmin] = useState(false);
  const [historyMore, setHistoryMore] = useState({
    runs: false,
    versions: false,
  });
  const [runs, setRuns] = useState<AiRun[]>([]),
    [versions, setVersions] = useState<Version[]>([]),
    [draft, setDraft] = useState<CustdevState | null>(null);
  const hashesRef = useRef(hashes);
  const live = useRef(state),
    revision = useRef(0),
    generation = useRef(0),
    dirty = useRef(0),
    saved = useRef(0),
    flight = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(),
    blocked = useRef(false),
    loaded = useRef(false);
  const api = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const { data, error: e } = await supabase.functions.invoke(
        "training-custdev",
        {
          body: {
            action,
            lessonId,
            blockId,
            ...(ownerId ? { ownerId } : {}),
            ...extra,
          },
        },
      );
      if (e || data?.error) {
        let message = data?.error;
        if (!message && e?.context instanceof Response) {
          try {
            message = (await e.context.clone().json()).error;
          } catch { /* bounded friendly fallback */ }
        }
        throw new Error(
          message ||
            "Не удалось выполнить действие. Ответы остаются в черновике",
        );
      }
      return data;
    },
    [lessonId, blockId, ownerId],
  );
  const storeDraft = useCallback(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          state: live.current,
          revision: revision.current,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch { /* server saving remains available */ }
  }, [key]);
  const accept = useCallback((data: WorkspaceResponse, update = true) => {
    revision.current = data.workspace?.revision ?? revision.current;
    setWorkspace(data.workspace ?? null);
    hashesRef.current = data.hashes ?? {};
    setHashes(hashesRef.current);
    if (update) {
      live.current = data.state;
      setState(data.state);
    }
  }, []);
  const reload = useCallback(async () => {
    const gen = ++generation.current;
    loaded.current = false;
    setCanEdit(false);
    setLoading(true);
    setError("");
    try {
      const data = await api("load");
      if (gen !== generation.current) return;
      accept(data);
      setSources(data.sources);
      setRuns(data.runs ?? []);
      setVersions(data.versions ?? []);
      setHistoryMore(data.historyMore ?? { runs: false, versions: false });
      setCanEdit(data.canEdit && !reviewMode);
      setIsAdmin(data.isAdmin);
      setConflict(false);
      blocked.current = false;
      dirty.current = 0;
      saved.current = 0;
      loaded.current = true;
      if (data.canEdit && !reviewMode) {
        try {
          const cached = JSON.parse(localStorage.getItem(key) || "null");
          setDraft(cached?.state ?? null);
        } catch {
          setDraft(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [api, accept, key, reviewMode]);
  useEffect(() => {
    void reload();
    const gen = generation.current;
    return () => {
      generation.current = gen + 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reload]);
  const persist = useCallback(async () => {
    while (flight.current) await flight.current;
    if (!loaded.current || blocked.current || dirty.current === saved.current) {
      return;
    }
    const snapshot = clone(live.current),
      tick = dirty.current,
      gen = generation.current;
    const p = (async () => {
      setSaveStatus("saving");
      try {
        const data = await api("save", {
          expectedRevision: revision.current,
          state: snapshot,
        });
        if (gen !== generation.current) return;
        accept(data, dirty.current === tick);
        saved.current = tick;
        setSaveStatus("saved");
        setError("");
        if (dirty.current === tick) {
          try {
            localStorage.removeItem(key);
          } catch { /* optional cache */ }
        } else storeDraft();
        onSaved?.();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Ошибка сохранения";
        setSaveStatus("error");
        setError(message);
        storeDraft();
        if (/конфликт|другой вкладке|версий/i.test(message)) {
          blocked.current = true;
          setConflict(true);
        }
        throw e;
      }
    })();
    flight.current = p;
    try {
      await p;
    } finally {
      if (flight.current === p) flight.current = null;
    }
  }, [api, accept, key, storeDraft, onSaved]);
  useEffect(() => {
    if (
      !canEdit || !loaded.current || blocked.current ||
      dirty.current === saved.current
    ) return;
    timer.current = setTimeout(() => {
      void persist().catch(() => {/* local draft kept */});
    }, 650);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, canEdit, persist]);
  const edit = useCallback((change: (next: CustdevState) => void) => {
    if (!canEdit || blocked.current) return;
    const next = clone(live.current);
    change(next);
    live.current = next;
    dirty.current++;
    setState(next);
    setSaveStatus("pending");
    storeDraft();
  }, [canEdit, storeDraft]);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    while (dirty.current !== saved.current && !blocked.current) await persist();
    if (blocked.current) {
      throw new Error(
        "Сначала сравните локальный черновик с серверной версией",
      );
    }
  }, [persist]);
  useEffect(() => {
    const unload = () => {
      if (dirty.current !== saved.current) storeDraft();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden" && canEdit) {
        void persist().catch(() => {/* offline draft */});
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      unload();
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [canEdit, persist, storeDraft]);
  const action = useCallback(
    async (name: string, extra: Record<string, unknown> = {}) => {
      if (canEdit) await flush();
      const tick = dirty.current;
      const data = await api(name, {
        expectedRevision: revision.current,
        ...extra,
      });
      if (data.run) {
        setRuns((previous) =>
          [data.run, ...previous.filter((r) => r.id !== data.run.id)].sort((
            a,
            b,
          ) => b.created_at.localeCompare(a.created_at))
        );
      }
      if (name === "history") {
        setRuns((previous) => [
          ...previous,
          ...(data.runs ?? []).filter((r) =>
            !previous.some((p) => p.id === r.id)
          ),
        ]);
        setVersions(
          (previous) => [
            ...previous,
            ...(data.versions ?? []).filter((v) =>
              !previous.some((p) => p.id === v.id)
            ),
          ],
        );
        setHistoryMore(data.historyMore ?? { runs: false, versions: false });
      }
      if (data.state) {
        accept(data, dirty.current === tick);
        saved.current = tick;
        if (dirty.current === tick) {
          try {
            localStorage.removeItem(key);
          } catch { /* optional */ }
        } else storeDraft();
        setSaveStatus("saved");
        onSaved?.();
      }
      return data;
    },
    [canEdit, flush, api, accept, key, onSaved, storeDraft],
  );
  const restoreDraft = () => {
    if (!draft || !canEdit) return;
    blocked.current = false;
    setConflict(false);
    const next = draft;
    setDraft(null);
    live.current = next;
    dirty.current++;
    setState(next);
    storeDraft();
  };
  const discardDraft = () => {
    try {
      localStorage.removeItem(key);
    } catch { /* optional */ }
    setDraft(null);
  };
  return {
    state,
    workspace,
    sources,
    hashes,
    loading,
    saveStatus,
    error,
    conflict,
    canEdit,
    isAdmin,
    runs,
    versions,
    historyMore,
    draft,
    edit,
    flush,
    action,
    reload,
    restoreDraft,
    discardDraft,
    getState: () => live.current,
    getHashes: () => hashesRef.current,
  };
}
