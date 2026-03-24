/**
 * useCorporateDraftSession — CRUD hook for corporate_draft_sessions table.
 * 
 * Provides: create, update (debounced auto-save with flush), delete, list active, get single.
 * Includes audit logging for critical actions, save status tracking, and accumulated patch support.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useCallback, useRef, useState } from "react";
import type {
  CorporateDraftSession,
  ProcedureMode,
  DraftSessionStatus,
} from "@/lib/corporate/corporateTypes";

const QUERY_KEY = "corporate-draft-sessions";

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'dirty';

// Audit helper (non-blocking, best-effort)
async function logAudit(action: string, userId: string | undefined, meta: Record<string, unknown>) {
  try {
    await (supabase.from("audit_logs") as any).insert([{
      action,
      actor_type: "user",
      actor_user_id: userId ?? null,
      meta,
    }]);
  } catch {
    // non-blocking
  }
}

/** Statuses considered "resumable" for reopen flow */
const RESUMABLE_STATUSES: DraftSessionStatus[] = [
  'draft', 'charter_pending', 'params_pending', 'preview',
];

export function useCorporateDraftSession() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const pendingPatches = useRef<Map<string, Record<string, unknown>>>(new Map());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Resolve profileId
  const { data: profile } = useQuery({
    queryKey: ["user-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const profileId = profile?.id;

  // List active (non-cancelled) sessions
  const {
    data: sessions = [],
    isLoading: isLoadingSessions,
  } = useQuery({
    queryKey: [QUERY_KEY, "list", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("corporate_draft_sessions" as any)
        .select("*")
        .eq("profile_id", profileId)
        .neq("status", "cancelled")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CorporateDraftSession[];
    },
    enabled: !!profileId,
  });

  // Get single session
  const useSession = (sessionId: string | null) => {
    return useQuery({
      queryKey: [QUERY_KEY, "detail", sessionId],
      queryFn: async () => {
        if (!sessionId) return null;
        const { data, error } = await supabase
          .from("corporate_draft_sessions" as any)
          .select("*")
          .eq("id", sessionId)
          .single();
        if (error) throw error;
        return data as unknown as CorporateDraftSession;
      },
      enabled: !!sessionId,
    });
  };

  // Create session
  const createMutation = useMutation({
    mutationFn: async (params: {
      legalDetailsId?: string;
      reportYear: number;
    }) => {
      if (!profileId) throw new Error("Нет профиля");
      const { data, error } = await supabase
        .from("corporate_draft_sessions" as any)
        .insert({
          profile_id: profileId,
          legal_details_id: params.legalDetailsId ?? null,
          report_year: params.reportYear,
          created_by: user?.id,
          updated_by: user?.id,
        } as any)
        .select("*")
        .single();
      if (error) throw error;

      await logAudit("corporate_draft.created", user?.id, {
        session_id: (data as any).id,
        report_year: params.reportYear,
      });

      return data as unknown as CorporateDraftSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
    onError: (e: Error) => {
      toast.error("Ошибка создания сессии: " + e.message);
    },
  });

  // Update session (immediate)
  const updateMutation = useMutation({
    mutationFn: async (params: {
      id: string;
      patch: Record<string, unknown>;
      auditAction?: string;
      auditMeta?: Record<string, unknown>;
    }) => {
      setSaveStatus('saving');
      const { data, error } = await supabase
        .from("corporate_draft_sessions" as any)
        .update({
          ...params.patch,
          updated_by: user?.id,
        } as any)
        .eq("id", params.id)
        .select("*")
        .single();
      if (error) throw error;

      if (params.auditAction) {
        await logAudit(params.auditAction, user?.id, {
          session_id: params.id,
          ...params.auditMeta,
        });
      }

      return data as unknown as CorporateDraftSession;
    },
    onSuccess: () => {
      setSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Debounced auto-save with patch accumulation
  const autoSave = useCallback(
    (sessionId: string, patch: Record<string, unknown>) => {
      // Accumulate patches
      const existing = pendingPatches.current.get(sessionId) ?? {};
      // Deep merge metadata to avoid overwrite
      const merged = { ...existing };
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'metadata' && typeof value === 'object' && value !== null && typeof merged.metadata === 'object' && merged.metadata !== null) {
          merged.metadata = { ...(merged.metadata as Record<string, unknown>), ...(value as Record<string, unknown>) };
        } else {
          merged[key] = value;
        }
      }
      pendingPatches.current.set(sessionId, merged);
      setSaveStatus('dirty');

      const existingTimer = debounceTimers.current.get(sessionId);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        const accumulatedPatch = pendingPatches.current.get(sessionId);
        if (accumulatedPatch && Object.keys(accumulatedPatch).length > 0) {
          pendingPatches.current.delete(sessionId);
          updateMutation.mutate({ id: sessionId, patch: accumulatedPatch });
        }
        debounceTimers.current.delete(sessionId);
      }, 1500);

      debounceTimers.current.set(sessionId, timer);
    },
    [updateMutation]
  );

  // Flush save — immediate save of accumulated patches, returns promise
  const flushSave = useCallback(
    async (sessionId: string): Promise<void> => {
      // Cancel any pending debounce
      const existingTimer = debounceTimers.current.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        debounceTimers.current.delete(sessionId);
      }

      const accumulatedPatch = pendingPatches.current.get(sessionId);
      if (accumulatedPatch && Object.keys(accumulatedPatch).length > 0) {
        pendingPatches.current.delete(sessionId);
        await updateMutation.mutateAsync({ id: sessionId, patch: accumulatedPatch });
      }
    },
    [updateMutation]
  );

  // Check if there are pending (unsaved) patches
  const hasPendingPatches = useCallback(
    (sessionId: string | null): boolean => {
      if (!sessionId) return false;
      const patch = pendingPatches.current.get(sessionId);
      return !!patch && Object.keys(patch).length > 0;
    },
    []
  );

  // Delete (cancel) session
  const deleteMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from("corporate_draft_sessions" as any)
        .update({ status: "cancelled", updated_by: user?.id } as any)
        .eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  // Confirm charter rules (with audit)
  const confirmCharterRules = useCallback(
    async (sessionId: string, confirmedRules: Record<string, unknown>, confirmedBy: 'ai_extraction' | 'manual') => {
      await updateMutation.mutateAsync({
        id: sessionId,
        patch: {
          confirmed_charter_rules: confirmedRules,
          charter_confirmed_at: new Date().toISOString(),
          charter_confirmed_by: confirmedBy,
          charter_extraction_status: 'confirmed',
          rules_basis: confirmedBy === 'manual' ? 'law_default' : 'charter_confirmed',
          status: 'params_pending',
        },
        auditAction: 'corporate_draft.charter_confirmed',
        auditMeta: {
          confirmed_by: confirmedBy,
          rules_snapshot: confirmedRules,
        },
      });
    },
    [updateMutation]
  );

  // Change procedure mode (with audit)
  const changeProcedureMode = useCallback(
    async (sessionId: string, mode: ProcedureMode, reason?: string) => {
      await updateMutation.mutateAsync({
        id: sessionId,
        patch: {
          procedure_mode: mode,
          procedure_mode_override_reason: reason ?? null,
        },
        auditAction: 'corporate_draft.mode_changed',
        auditMeta: { new_mode: mode, reason },
      });
    },
    [updateMutation]
  );

  // Confirm package (with audit)
  const confirmPackage = useCallback(
    async (sessionId: string, manifest: unknown[]) => {
      await updateMutation.mutateAsync({
        id: sessionId,
        patch: {
          package_manifest: manifest,
          status: 'confirmed' as DraftSessionStatus,
        },
        auditAction: 'corporate_draft.package_confirmed',
        auditMeta: {
          manifest_count: manifest.length,
        },
      });
      toast.success("Пакет подтверждён");
    },
    [updateMutation]
  );

  // Find the latest resumable draft session
  const latestResumableDraft = sessions.find(
    (s) => RESUMABLE_STATUSES.includes(s.status)
  ) ?? null;

  return {
    profileId,
    sessions,
    isLoadingSessions,
    useSession,
    createSession: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updateSession: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    autoSave,
    flushSave,
    hasPendingPatches,
    saveStatus,
    setSaveStatus,
    deleteSession: deleteMutation.mutateAsync,
    confirmCharterRules,
    changeProcedureMode,
    confirmPackage,
    latestResumableDraft,
  };
}
