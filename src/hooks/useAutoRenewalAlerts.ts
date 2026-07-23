import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * PATCH 3.2: Lightweight hook for auto-renewal problem indicators in tab badges.
 * Returns counts of errors, bad cards, and no-card MIT subscriptions.
 * Uses a single lightweight query (no joins, only counts).
 */
export function useAutoRenewalAlerts() {
  return useQuery({
    queryKey: ['auto-renewal-alerts'],
    queryFn: async () => {
      // Saved-card/MIT flows are retired. Keep only genuine provider-managed
      // renewal failures; never raise "bad card" or "no saved card" prompts.
      const { data: subs, error } = await supabase
        .from('subscriptions_v2_safe')
        .select('id, meta, billing_type')
        .eq('auto_renew', true)
        .in('status', ['active', 'trial', 'past_due'])
        .limit(500);

      if (error || !subs) return { hasProblems: false, errors: 0, badCard: 0, noCard: 0 };

      let errors = 0;
      const badCard = 0;
      const noCard = 0;

      for (const sub of subs) {
        const meta = sub.meta as Record<string, any> | null;
        // Errors
        if (
          (sub as any).billing_type === 'provider_managed' &&
          (meta?.last_charge_attempt_success === false ||
            (meta?.last_charge_attempt_error != null && meta.last_charge_attempt_error !== ''))
        ) {
          errors++;
        }
      }

      return {
        hasProblems: errors > 0 || badCard > 0 || noCard > 0,
        errors,
        badCard,
        noCard,
      };
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });
}
