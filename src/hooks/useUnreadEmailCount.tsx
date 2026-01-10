import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export function useUnreadEmailCount() {
  const { data: count = 0, refetch } = useQuery({
    queryKey: ["unread-email-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("email_inbox")
        .select("*", { count: "exact", head: true })
        .eq("is_read", false)
        .eq("is_archived", false);

      if (error) return 0;
      return count || 0;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("unread-email-count")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "email_inbox",
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

  return { data: count, refetch };
}
