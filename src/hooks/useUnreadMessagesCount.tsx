import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useVisibilityPolling } from "./useVisibilityPolling";

export function useUnreadMessagesCount() {
  const visibilityInterval = useVisibilityPolling(60000);
  
  const { data: count = 0, refetch } = useQuery({
    queryKey: ["unread-messages-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("telegram_messages")
        .select("*", { count: "exact", head: true })
        .eq("direction", "incoming")
        .eq("is_read", false);

      if (error) return 0;
      return count || 0;
    },
    refetchInterval: visibilityInterval, // Pause when tab hidden
  });

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("unread-count")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "telegram_messages",
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
