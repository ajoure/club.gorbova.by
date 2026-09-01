import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PaymentManagerDirectoryOption {
  user_id: string;
  label: string;
}

/** Least-privilege staff directory for the payments manager filter. */
export function usePaymentManagerDirectoryOptions(enabled = true) {
  return useQuery({
    queryKey: ["payment-manager-options", "v1"],
    queryFn: async (): Promise<PaymentManagerDirectoryOption[]> => {
      const { data, error } = await supabase.rpc("get_payment_manager_options_v1");
      if (error) throw error;
      return (data ?? []).map(person => ({
        user_id: person.user_id,
        label: person.label,
      }));
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
