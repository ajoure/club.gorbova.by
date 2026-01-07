import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const CURRENT_POLICY_VERSION = "v2026-01-07";

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
        // Return fallback version
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
  });

  // Get user's profile consent info
  const { data: profileConsent, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["profile-consent", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("consent_version, consent_given_at, marketing_consent")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching profile consent:", error);
        return null;
      }

      return data;
    },
    enabled: !!user,
  });

  // Get user's consent history
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
    enabled: !!user,
  });

  // Check if consent update is needed
  const needsConsentUpdate = 
    !!user && 
    !!currentPolicy && 
    profileConsent !== undefined &&
    profileConsent?.consent_version !== currentPolicy.version;

  // Grant consent mutation
  const grantConsent = useMutation({
    mutationFn: async ({ source }: { source: string }) => {
      if (!user || !currentPolicy) throw new Error("User not authenticated");

      // Log consent
      const { error: logError } = await supabase.from("consent_logs").insert({
        user_id: user.id,
        email: user.email,
        consent_type: "privacy_policy",
        policy_version: currentPolicy.version,
        granted: true,
        source,
      });

      if (logError) throw logError;

      // Update profile
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
      queryClient.invalidateQueries({ queryKey: ["profile-consent", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["consent-history", user?.id] });
    },
  });

  // Revoke consent mutation
  const revokeConsent = useMutation({
    mutationFn: async ({ reason }: { reason?: string }) => {
      if (!user || !currentPolicy) throw new Error("User not authenticated");

      // Log revocation
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

      // Update profile - clear consent
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
      queryClient.invalidateQueries({ queryKey: ["profile-consent", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["consent-history", user?.id] });
    },
  });

  // Update marketing consent
  const updateMarketingConsent = useMutation({
    mutationFn: async ({ granted }: { granted: boolean }) => {
      if (!user) throw new Error("User not authenticated");

      // Log consent change
      const { error: logError } = await supabase.from("consent_logs").insert({
        user_id: user.id,
        email: user.email,
        consent_type: "marketing",
        policy_version: currentPolicy?.version || CURRENT_POLICY_VERSION,
        granted,
        source: "settings",
      });

      if (logError) throw logError;

      // Update profile
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ marketing_consent: granted })
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-consent", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["consent-history", user?.id] });
    },
  });

  return {
    currentPolicy,
    profileConsent,
    consentHistory,
    needsConsentUpdate,
    isLoading: isLoadingPolicy || isLoadingProfile || isLoadingHistory,
    grantConsent,
    revokeConsent,
    updateMarketingConsent,
    CURRENT_POLICY_VERSION,
  };
}
