import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { CONSENT_POLICY_VERSION, CONSENT_POLICY_EFFECTIVE_DATE } from "@/lib/legalVersions";

interface PolicyVersion {
  id: string;
  version: string;
  effective_date: string;
  summary: string | null;
  is_current: boolean;
  created_at: string;
}

interface ConsentLog {
  id: string;
  user_id: string | null;
  email: string | null;
  consent_type: string;
  policy_version: string;
  granted: boolean;
  source: string;
  created_at: string;
}

export function useConsent() {
  const { user } = useAuth();
  const { profile, bootstrapReady } = useAuthBootstrap();
  const queryClient = useQueryClient();

  // Get current policy version
  const { data: currentPolicy, isLoading: isLoadingPolicy } = useQuery({
    queryKey: ["current-policy"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("privacy_policy_versions")
        .select("*")
        .eq("is_current", true)
        .maybeSingle();

      if (error) {
        console.error("Error fetching current policy:", error);
        return {
          id: "fallback",
          version: CURRENT_POLICY_VERSION,
          effective_date: "2026-01-07",
          summary: null,
          is_current: true,
          created_at: new Date().toISOString(),
        } as PolicyVersion;
      }

      return data as PolicyVersion | null;
    },
    staleTime: 5 * 60 * 1000,
  });

  // B1: Use bootstrap profile for consent data instead of separate profiles query
  const profileConsent = profile
    ? {
        consent_version: profile.consent_version,
        consent_given_at: profile.consent_given_at,
        marketing_consent: profile.marketing_consent,
      }
    : undefined;

  // B3: Deferred consent history — not blocking shell
  const { data: consentHistory, isLoading: isLoadingHistory } = useQuery({
    queryKey: ["consent-history", user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("consent_logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching consent history:", error);
        return [];
      }

      return data as ConsentLog[];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Check if consent update is needed — uses bootstrap profile
  const needsConsentUpdate =
    !!user &&
    bootstrapReady &&
    !!currentPolicy &&
    profileConsent !== undefined &&
    profileConsent.consent_version !== currentPolicy.version;

  // Grant consent mutation
  const grantConsent = useMutation({
    mutationFn: async ({ source }: { source: string }) => {
      if (!user || !currentPolicy) throw new Error("User not authenticated");

      const { error: logError } = await supabase.from("consent_logs").insert({
        user_id: user.id,
        email: user.email,
        consent_type: "privacy_policy",
        policy_version: currentPolicy.version,
        granted: true,
        source,
      });

      if (logError) throw logError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          consent_version: currentPolicy.version,
          consent_given_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-bootstrap-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["consent-history", user?.id] });
    },
  });

  // Revoke consent mutation
  const revokeConsent = useMutation({
    mutationFn: async ({ reason }: { reason?: string }) => {
      if (!user || !currentPolicy) throw new Error("User not authenticated");

      const { error: logError } = await supabase.from("consent_logs").insert({
        user_id: user.id,
        email: user.email,
        consent_type: "privacy_policy",
        policy_version: currentPolicy.version,
        granted: false,
        source: "settings",
        meta: reason ? { reason } : {},
      });

      if (logError) throw logError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          consent_version: null,
          consent_given_at: null,
        })
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-bootstrap-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["consent-history", user?.id] });
    },
  });

  // Update marketing consent
  const updateMarketingConsent = useMutation({
    mutationFn: async ({ granted }: { granted: boolean }) => {
      if (!user) throw new Error("User not authenticated");

      const { error: logError } = await supabase.from("consent_logs").insert({
        user_id: user.id,
        email: user.email,
        consent_type: "marketing",
        policy_version: currentPolicy?.version || CURRENT_POLICY_VERSION,
        granted,
        source: "settings",
      });

      if (logError) throw logError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ marketing_consent: granted })
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-bootstrap-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["consent-history", user?.id] });
    },
  });

  return {
    currentPolicy,
    profileConsent,
    consentHistory,
    needsConsentUpdate,
    // B4: isLoading does NOT include consent_logs — shell not blocked by history
    isLoading: isLoadingPolicy,
    grantConsent,
    revokeConsent,
    updateMarketingConsent,
    CURRENT_POLICY_VERSION,
  };
}
