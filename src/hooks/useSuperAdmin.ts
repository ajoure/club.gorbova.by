import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSuperAdmin() {
  return useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      
      const { data, error } = await supabase
        .rpc("is_super_admin", { _user_id: user.id });
      
      if (error) {
        console.error("useSuperAdmin error:", error);
        return false;
      }
      return data === true;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
