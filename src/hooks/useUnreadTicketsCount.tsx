import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useVisibilityPolling } from "./useVisibilityPolling";

export function useUnreadTicketsCount() {
  const visibilityInterval = useVisibilityPolling(60000);
  
  const { data: count = 0, refetch } = useQuery({
    queryKey: ["unread-tickets-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("support_tickets")
        .select("*", { count: "exact", head: true })
        .eq("has_unread_admin", true)
        .not("status", "in", '("closed","resolved")');

      if (error) return 0;
      return count || 0;
    },
    refetchInterval: visibilityInterval,
  });

  // Subscribe to realtime updates
  useEffect(() => {
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
  }, [refetch]);

  return count;
}
