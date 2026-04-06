import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * useAuthBootstrap — canonical profile bootstrap hook.
 *
 * Returns minimal profile data needed for the app shell.
 * All components that need profile data should use this instead of
 * making their own profiles queries.
 *
 * Levels:
 *   authReady   = !loading (from AuthContext — session restored)
 *   bootstrapReady = authReady && profile loaded
 *
 * Fields fetched (minimal — do NOT add telegram/consent/etc here):
 *   - id, full_name, avatar_url, consent_version, status
 */

interface BootstrapProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  consent_version: string | null;
  status: string | null;
}

export function useAuthBootstrap() {
  const { user, loading, role } = useAuth();
  const authReady = !loading;

  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ["auth-bootstrap-profile", user?.id],
    queryFn: async (): Promise<BootstrapProfile | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, consent_version, status")
        .eq("user_id", user.id)
        .single();
      if (error) {
        console.error("[useAuthBootstrap] profile fetch error:", error);
        return null;
      }
      return data as BootstrapProfile;
    },
    enabled: authReady && !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const bootstrapReady = authReady && !!user && !profileLoading;

  return {
    user,
    role,
    profile,
    authReady,
    bootstrapReady,
    profileLoading,
    profileError,
  };
}
