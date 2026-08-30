import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Never render raw database messages: they may contain identifiers or payloads.
export function getDealAuditErrorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/i.test(code)
    ? code
    : "REQUEST_FAILED";
}

export function useDealAuditLogs(dealId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["deal-audit", dealId],
    queryFn: async () => {
      if (!dealId) return [];
      const { data: logs, error } = await supabase
        .from("audit_logs")
        .select("*")
        .or(`entity_id.eq.${dealId},meta->>order_id.eq.${dealId},meta->>orderId.eq.${dealId}`)
        .order("created_at", { ascending: false })
        .limit(20);
      // A failed read must not masquerade as an empty, successfully loaded audit.
      if (error) throw error;

      const entries = logs || [];
      const actorIds = [...new Set(entries.map((log) => log.actor_user_id).filter(Boolean))];
      if (actorIds.length === 0) {
        return entries.map((log) => ({ ...log, actor_profile: null }));
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", actorIds);
      const profileMap = new Map(profiles?.map((profile) => [profile.user_id, profile]) || []);
      // Actor enrichment is optional. The immutable actor_label remains usable.
      return entries.map((log) => ({
        ...log,
        actor_profile: profileMap.get(log.actor_user_id) || null,
      }));
    },
    enabled: !!dealId && enabled,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
}
