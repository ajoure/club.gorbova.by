import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type SubscriptionTier = "free" | "pro" | "premium" | "webinar";

interface Subscription {
  id: string;
  tier: SubscriptionTier;
  starts_at: string;
  expires_at: string | null;
  is_active: boolean;
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    const fetchSubscription = async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching subscription:", error);
      } else {
        setSubscription(data);
      }
      setLoading(false);
    };

    fetchSubscription();
  }, [user]);

  const tierLevel = (tier: SubscriptionTier): number => {
    const levels: Record<SubscriptionTier, number> = {
      free: 0,
      webinar: 1,
      pro: 2,
      premium: 3,
    };
    return levels[tier];
  };

  const hasAccess = (requiredTier: SubscriptionTier): boolean => {
    if (!subscription) return false;
    return tierLevel(subscription.tier) >= tierLevel(requiredTier);
  };

  return {
    subscription,
    loading,
    tier: subscription?.tier || "free",
    hasAccess,
    isPro: hasAccess("pro"),
    isPremium: hasAccess("premium"),
  };
}
