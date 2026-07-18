import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactInternalInstallments } from "./ContactInternalInstallments";
import { ContactInstallments } from "./ContactInstallments";

/**
 * Orchestration wrapper for the contact "Рассрочки" tab.
 *
 * Renders BOTH sources (new internal bepaid_finite_subscription orders
 * and legacy installment_payments) and shows a single combined
 * «Нет рассрочек» state only when both sources are loaded and both empty.
 *
 * Query keys duplicate the child components' keys on purpose — react-query
 * dedupes them, so no extra network cost.
 */

interface ContactInstallmentsTabContentProps {
  profileId?: string | null;
  userId?: string | null;
  currency?: string;
}

export function ContactInstallmentsTabContent({
  profileId,
  userId,
  currency = "BYN",
}: ContactInstallmentsTabContentProps) {
  // Internal (canonical bepaid finite subscription) — mirrors ContactInternalInstallments query key.
  const internalQuery = useQuery({
    queryKey: ["contact-internal-installments", profileId, userId],
    enabled: Boolean(profileId || userId),
    queryFn: async () => {
      const filters: Array<{ col: string; val: string }> = [];
      if (profileId) filters.push({ col: "profile_id", val: profileId });
      if (userId) filters.push({ col: "user_id", val: userId });
      if (filters.length === 0) return [] as any[];

      let query: any = supabase
        .from("orders_v2")
        .select("id, meta")
        .eq("meta->>payment_method", "internal_installment");

      if (filters.length === 1) {
        query = query.eq(filters[0].col, filters[0].val);
      } else {
        query = query.or(
          filters.map((f) => `${f.col}.eq.${f.val}`).join(","),
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).filter((row: any) => {
        const m = row?.meta?.installment?.model;
        const pm = row?.meta?.installment_progress?.model;
        return m === "bepaid_finite_subscription" || pm === "bepaid_finite_subscription";
      });
    },
  });

  // Legacy installment_payments — mirrors ContactInstallments query key.
  const legacyQuery = useQuery({
    queryKey: ["user-all-installments", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installment_payments")
        .select("id")
        .eq("user_id", userId as string);
      if (error) throw error;
      return data ?? [];
    },
  });

  const internalLoading = internalQuery.isLoading;
  const legacyLoading = userId ? legacyQuery.isLoading : false;
  const internalCount = internalQuery.data?.length ?? 0;
  const legacyCount = legacyQuery.data?.length ?? 0;

  if (internalLoading || legacyLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (internalCount === 0 && legacyCount === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Нет рассрочек</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ContactInternalInstallments profileId={profileId} userId={userId} />
      {userId && (
        <ContactInstallments userId={userId} currency={currency} hideEmptyState />
      )}
    </div>
  );
}
