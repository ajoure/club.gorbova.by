import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

type FeedbackTicketResult = {
  success: boolean;
  ticket_id?: string;
  ticket_number?: string;
  existing?: boolean;
  error?: string;
  error_code?: string;
};

type GetOrCreateFeedbackParams = {
  studentUserId: string;
  lessonId: string;
  blockId?: string | null;
  moduleId?: string | null;
  subject?: string;
  description?: string;
};

function getSafeTicketNumber(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  // Some RPCs return { ticket_number: "..." } or { value: "..." }
  const obj = raw as any;
  const candidate =
    (typeof obj?.ticket_number === "string" && obj.ticket_number) ||
    (typeof obj?.value === "string" && obj.value) ||
    null;

  return candidate && candidate.trim() ? candidate.trim() : null;
}

/**
 * P4.1: Fallback direct INSERT with full guard conditions.
 * Used when RPC fails due to RLS/SECURITY DEFINER issues.
 */
async function fallbackDirectInsert(
  params: GetOrCreateFeedbackParams
): Promise<FeedbackTicketResult> {
  // Guard 1: Check for existing ticket (same conditions as RPC)
  const existingQuery = supabase
    .from("ticket_training_context")
    .select("ticket_id, support_tickets!inner(id, user_id, category)")
    .eq("lesson_id", params.lessonId)
    .eq("support_tickets.user_id", params.studentUserId)
    .eq("support_tickets.category", "training_feedback");

  if (params.blockId) {
    existingQuery.eq("block_id", params.blockId);
  } else {
    existingQuery.is("block_id", null);
  }

  const { data: existingRows, error: existingErr } = await existingQuery.limit(1);

  if (existingErr) {
    console.error("[fallbackDirectInsert] Existing check failed:", existingErr);
    return { success: false, error: "Internal error", error_code: "database_error" };
  }

  if (existingRows && existingRows.length > 0) {
    return {
      success: true,
      ticket_id: existingRows[0].ticket_id,
      existing: true,
    };
  }

  // Guard 2: Get student profile_id
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", params.studentUserId)
    .single();

  if (profileErr || !profile) {
    return { success: false, error: "Student profile not found", error_code: "profile_not_found" };
  }

  // Guard 3: Generate ticket_number via atomic RPC
  const { data: tnRaw, error: numError } = await supabase.rpc("generate_ticket_number_atomic");
  const safeTicketNumber = getSafeTicketNumber(tnRaw);

  if (numError || !safeTicketNumber) {
    console.error("[fallbackDirectInsert] Invalid ticket number format:", {
      numError,
      tnRaw,
    });
    return { success: false, error: "Internal error", error_code: "database_error" };
  }

  // Guard 4: INSERT support_ticket
  const { data: newTicket, error: ticketError } = await supabase
    .from("support_tickets")
    .insert({
      user_id: params.studentUserId,
      profile_id: profile.id,
      subject: params.subject || "Обратная связь по уроку",
      description: params.description || "Обратная связь преподавателя",
      category: "training_feedback",
      ticket_number: safeTicketNumber,
      status: "open",
      priority: "normal",
      has_unread_admin: false,
      has_unread_user: true,
    })
    .select("id")
    .single();

  if (ticketError || !newTicket) {
    console.error("[fallbackDirectInsert] Failed to insert ticket:", ticketError);
    return { success: false, error: "Internal error", error_code: "database_error" };
  }

  // Guard 5: INSERT ticket_training_context
  const { error: ctxError } = await supabase.from("ticket_training_context").insert({
    ticket_id: newTicket.id,
    lesson_id: params.lessonId,
    block_id: params.blockId || null,
    module_id: params.moduleId || null,
  });

  if (ctxError) {
    console.error("[fallbackDirectInsert] Failed to insert context:", ctxError);
    return { success: false, error: "Internal error", error_code: "database_error" };
  }

  // Guard 6: Sanity check — re-read to confirm
  const { data: verifyTicket, error: verifyErr } = await supabase
    .from("support_tickets")
    .select("id, ticket_number")
    .eq("id", newTicket.id)
    .single();

  if (verifyErr || !verifyTicket) {
    console.error("[fallbackDirectInsert] Sanity check failed:", verifyErr);
    return { success: false, error: "Internal error", error_code: "database_error" };
  }

  return {
    success: true,
    ticket_id: verifyTicket.id,
    ticket_number: verifyTicket.ticket_number,
    existing: false,
  };
}

export function useGetOrCreateFeedbackTicket() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: GetOrCreateFeedbackParams): Promise<FeedbackTicketResult> => {
      // P4.1: Safe test hook — force fallback path via localStorage flag
      if (
        typeof window !== "undefined" &&
        window.localStorage?.getItem("FORCE_FEEDBACK_FALLBACK") === "1"
      ) {
        console.warn("[useGetOrCreateFeedbackTicket] FORCED FALLBACK via localStorage flag");
        return await fallbackDirectInsert(params);
      }

      // --- Primary path: RPC ---
      const { data: rpcResult, error: rpcError } = await supabase.rpc("create_feedback_ticket", {
        p_student_user_id: params.studentUserId,
        p_lesson_id: params.lessonId,
        p_block_id: params.blockId || null,
        p_module_id: params.moduleId || null,
        p_subject: params.subject || "Обратная связь по уроку",
        p_description: params.description || "Обратная связь преподавателя",
      });

      if (!rpcError && rpcResult) {
        const result = rpcResult as unknown as FeedbackTicketResult;

        if (result.success) return result;

        // If RPC returned structured error that's NOT database_error, propagate it
        if (result.error_code && result.error_code !== "database_error") {
          return result;
        }

        // Fall through to fallback for database_error
        console.warn("[useGetOrCreateFeedbackTicket] RPC database_error, trying fallback");
      } else if (rpcError) {
        console.warn("[useGetOrCreateFeedbackTicket] RPC call failed, trying fallback:", rpcError.message);
      }

      // --- P4.1: Fallback direct INSERT with guard conditions ---
      return await fallbackDirectInsert(params);
    },

    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["student-feedback-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["lesson-feedback-threads"] });
        queryClient.invalidateQueries({ queryKey: ["unread-feedback-count"] });
        queryClient.invalidateQueries({ queryKey: ["user-tickets"] });
      }
    },

    onError: (error: Error) => {
      console.error("[useGetOrCreateFeedbackTicket] Error:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось создать тред обратной связи",
        variant: "destructive",
      });
    },
  });
}

/**
 * P4: Student feedback tickets list (category='training_feedback')
 * P2 fix: own realtime subscription to invalidate feedback + badge queries.
 */
export function useStudentFeedbackTickets(status?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["student-feedback-tickets", user?.id, status],
    queryFn: async () => {
      let q = supabase
        .from("support_tickets")
        .select("*")
        .eq("user_id", user!.id)
        .eq("category", "training_feedback")
        .order("updated_at", { ascending: false });

      if (status === "open") {
        q = q.in("status", ["open", "in_progress", "waiting_user"]);
      } else if (status === "closed") {
        q = q.in("status", ["resolved", "closed"]);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // P2: Realtime subscription for feedback tab (invalidate own queries + badge)
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`student-feedback-rt-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_tickets",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["student-feedback-tickets", user.id] });
          queryClient.invalidateQueries({ queryKey: ["unread-feedback-count", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  return query;
}

/**
 * P4: Unread feedback count for student badge
 * P2 fix: realtime invalidate for immediate badge updates.
 */
export function useUnreadFeedbackCount() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["unread-feedback-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("support_tickets")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("category", "training_feedback")
        .eq("has_unread_user", true);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user?.id,
    refetchInterval: 30000,
  });

  // P2: Realtime subscription for badge (keeps badge fresh even if tab not mounted)
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`unread-feedback-rt-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "support_tickets",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["unread-feedback-count", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  return query;
}

/**
 * P4: Check existing feedback threads for a lesson/student
 */
export function useLessonFeedbackThreads(lessonId: string | undefined, studentUserId: string | undefined) {
  return useQuery({
    queryKey: ["lesson-feedback-threads", lessonId, studentUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_training_context")
        .select("ticket_id, block_id, lesson_id, support_tickets!inner(id, status, category, has_unread_admin)")
        .eq("lesson_id", lessonId!)
        .eq("support_tickets.user_id", studentUserId!)
        .eq("support_tickets.category", "training_feedback");

      if (error) throw error;
      return data;
    },
    enabled: !!lessonId && !!studentUserId,
  });
}

/**
 * Batch fetch unread feedback count per lesson_id for current user.
 * Single query — no N+1. Used by lesson lists (BusinessTrainingContent, LibraryModule).
 * Returns Map<lesson_id, unread_count>.
 *
 * Anti-spam: no toast on initial load or refetch — only used for badge rendering.
 */
export function useUnreadFeedbackByLesson(lessonIds: string[]) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["unread-feedback-by-lesson", user?.id, lessonIds.join(",")],
    queryFn: async () => {
      if (!lessonIds.length) return new Map<string, number>();

      const { data, error } = await supabase
        .from("ticket_training_context")
        .select("lesson_id, support_tickets!inner(id, has_unread_user, category, user_id)")
        .in("lesson_id", lessonIds)
        .eq("support_tickets.user_id", user!.id)
        .eq("support_tickets.category", "training_feedback")
        .eq("support_tickets.has_unread_user", true);

      if (error) throw error;

      const map = new Map<string, number>();
      data?.forEach((row: any) => {
        const lid = row.lesson_id;
        map.set(lid, (map.get(lid) || 0) + 1);
      });
      return map;
    },
    enabled: !!user?.id && lessonIds.length > 0,
    staleTime: 15000,
  });

  // Realtime invalidation (per-lesson isolation via user_id filter)
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`feedback-by-lesson-rt-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "support_tickets",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["unread-feedback-by-lesson", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  return query;
}
