/**
 * useCorporateDraftSession — CRUD hook for corporate_draft_sessions table.
 * 
 * Provides: create, update (debounced auto-save), delete, list active, get single.
 * Includes audit logging for critical actions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useCallback, useRef } from "react";
import type {
  CorporateDraftSession,
  ProcedureMode,
  DraftSessionStatus,
} from "@/lib/corporate/corporateTypes";

const QUERY_KEY = "corporate-draft-sessions";

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

export function useCorporateDraftSession() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

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
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  // Debounced auto-save
  const autoSave = useCallback(
    (sessionId: string, patch: Record<string, unknown>) => {
      const existing = debounceTimers.current.get(sessionId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        updateMutation.mutate({ id: sessionId, patch });
        debounceTimers.current.delete(sessionId);
      }, 1500);

      debounceTimers.current.set(sessionId, timer);
    },
    [updateMutation]
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
      toast.success("Сессия отменена");
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
    deleteSession: deleteMutation.mutate,
    confirmCharterRules,
    changeProcedureMode,
    confirmPackage,
  };
}
