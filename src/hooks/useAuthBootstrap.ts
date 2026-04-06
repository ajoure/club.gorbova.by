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
 * Fields fetched (minimal — only fields that eliminate duplicate fetches):
 *   - id, full_name, avatar_url, status
 *   - consent_version, consent_given_at, marketing_consent (for useConsent)
 *   - onboarding_dismissed_at, onboarding_completed_at (for WelcomeOnboardingModal)
 */

interface BootstrapProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  status: string | null;
  consent_version: string | null;
  consent_given_at: string | null;
  marketing_consent: boolean | null;
  onboarding_dismissed_at: string | null;
  onboarding_completed_at: string | null;
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
        .select("id, full_name, avatar_url, status, consent_version, consent_given_at, marketing_consent, onboarding_dismissed_at, onboarding_completed_at")
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
