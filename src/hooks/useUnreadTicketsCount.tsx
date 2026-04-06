import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useVisibilityPolling } from "./useVisibilityPolling";

/**
 * Admin-side unread tickets count.
 * B3: Deferred — only starts when user is authenticated.
 */
export function useUnreadTicketsCount() {
  const { user } = useAuth();
  const visibilityInterval = useVisibilityPolling(60000);
  
  const { data: count = 0, refetch } = useQuery({
    queryKey: ["unread-tickets-count-admin"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("support_tickets")
        .select("*", { count: "exact", head: true })
        .eq("has_unread_admin", true)
        .not("status", "in", '("closed","resolved")');

      if (error) return 0;
      return count || 0;
    },
    enabled: !!user?.id,
    refetchInterval: visibilityInterval,
    staleTime: 30_000,
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("unread-tickets-count")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_tickets",
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch, user?.id]);

  return count;
}
