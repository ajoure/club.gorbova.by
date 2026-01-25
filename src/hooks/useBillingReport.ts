import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfDay, endOfDay, parseISO } from "date-fns";

export interface BillingSummary {
  chargeAttempts: number;
  successCount: number;
  failedCount: number;
  noCardCount: number;
  reminders7d: number;
  reminders3d: number;
  reminders1d: number;
  noCardWarnings: number;
  totalAmount: number;
  successAmount: number;
}

export interface BillingReportItem {
  id: string;
  user_id: string;
  profile_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  product_name: string | null;
  tariff_name: string | null;
  amount: number;
  currency: string;
  charge_attempts: number;
  last_charge_at: string | null;
  last_charge_error: string | null;
  status: string;
  type: "subscription" | "installment";
  notifications: {
    reminder7d: boolean;
    reminder3d: boolean;
    reminder1d: boolean;
    noCardWarning: boolean;
  };
}

export function useBillingReport(date: string) {
  // Fetch summary from audit_logs
  const summaryQuery = useQuery({
    queryKey: ["billing-report-summary", date],
    queryFn: async () => {
      const dayStart = startOfDay(parseISO(date)).toISOString();
      const dayEnd = endOfDay(parseISO(date)).toISOString();

      // Get charge cron results
      const { data: chargeLogs } = await supabase
        .from("audit_logs")
        .select("meta")
        .eq("action", "subscription.charge_cron_completed")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .order("created_at", { ascending: false })
        .limit(5);

      // Get reminder cron results
      const { data: reminderLogs } = await supabase
        .from("audit_logs")
        .select("meta")
        .eq("action", "subscription.reminders_cron_completed")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .order("created_at", { ascending: false })
        .limit(5);

      // Aggregate charge stats
      let chargeAttempts = 0;
      let successCount = 0;
      let failedCount = 0;
      let noCardCount = 0;
      let totalAmount = 0;
      let successAmount = 0;

      if (chargeLogs) {
        for (const log of chargeLogs) {
          const meta = log.meta as Record<string, unknown> | null;
          if (meta) {
            chargeAttempts += (meta.total_processed as number) || 0;
            successCount += (meta.success_count as number) || 0;
            failedCount += (meta.failed_count as number) || 0;
            noCardCount += (meta.no_card_count as number) || 0;
            totalAmount += (meta.total_amount as number) || 0;
            successAmount += (meta.success_amount as number) || 0;
          }
        }
      }

      // Aggregate reminder stats
      let reminders7d = 0;
      let reminders3d = 0;
      let reminders1d = 0;
      let noCardWarnings = 0;

      if (reminderLogs) {
        for (const log of reminderLogs) {
          const meta = log.meta as Record<string, unknown> | null;
          if (meta) {
            reminders7d += (meta.reminders_7d_sent as number) || 0;
            reminders3d += (meta.reminders_3d_sent as number) || 0;
            reminders1d += (meta.reminders_1d_sent as number) || 0;
            noCardWarnings += (meta.no_card_warnings_sent as number) || 0;
          }
        }
      }

      return {
        chargeAttempts,
        successCount,
        failedCount,
        noCardCount,
        reminders7d,
        reminders3d,
        reminders1d,
        noCardWarnings,
        totalAmount,
        successAmount,
      } as BillingSummary;
    },
  });

  // Fetch detailed data from subscriptions_v2
  const detailsQuery = useQuery({
    queryKey: ["billing-report-details", date],
    queryFn: async () => {
      const dayStart = startOfDay(parseISO(date)).toISOString();
      const dayEnd = endOfDay(parseISO(date)).toISOString();

      // Get subscriptions with charge attempts today
      const { data: subscriptions, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          id,
          user_id,
          profile_id,
          status,
          charge_attempts,
          meta,
          tariff_id,
          tariffs (
            name,
            products_v2 (
              name
            )
          )
        `)
        .gt("charge_attempts", 0)
        .in("status", ["active", "trial", "past_due", "canceled"]);

      if (error) throw error;

      // Filter to those with charge attempt today
      const todaySubscriptions = (subscriptions || []).filter((sub) => {
        const meta = sub.meta as Record<string, unknown> | null;
        const lastAttempt = meta?.last_charge_attempt_at as string | undefined;
        if (!lastAttempt) return false;
        return lastAttempt >= dayStart && lastAttempt <= dayEnd;
      });

      // Get profiles for these users
      const userIds = [...new Set(todaySubscriptions.map((s) => s.user_id).filter(Boolean))];
      const profileIds = [...new Set(todaySubscriptions.map((s) => s.profile_id).filter(Boolean))];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email, phone")
        .or(`user_id.in.(${userIds.join(",")}),id.in.(${profileIds.join(",")})`);

      const profileMap = new Map<string, { full_name: string | null; email: string | null; phone: string | null; profile_id: string }>();
      profiles?.forEach((p) => {
        if (p.user_id) profileMap.set(p.user_id, { full_name: p.full_name, email: p.email, phone: p.phone, profile_id: p.id });
        profileMap.set(p.id, { full_name: p.full_name, email: p.email, phone: p.phone, profile_id: p.id });
      });

      // Get notifications for these users today
      const { data: notifications } = await supabase
        .from("telegram_logs")
        .select("user_id, event_type")
        .in("user_id", userIds)
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .in("event_type", [
          "subscription_reminder_7d",
          "subscription_reminder_3d",
          "subscription_reminder_1d",
          "subscription_no_card_warning",
        ]);

      // Build notification map
      const notificationMap = new Map<string, Set<string>>();
      notifications?.forEach((n) => {
        if (!n.user_id) return;
        if (!notificationMap.has(n.user_id)) {
          notificationMap.set(n.user_id, new Set());
        }
        if (n.event_type) {
          notificationMap.get(n.user_id)!.add(n.event_type);
        }
      });

      // Build report items
      const items: BillingReportItem[] = todaySubscriptions.map((sub) => {
        const profile = profileMap.get(sub.user_id || "") || profileMap.get(sub.profile_id || "");
        const meta = sub.meta as Record<string, unknown> | null;
        const tariff = sub.tariffs as { name: string; products_v2: { name: string } | null } | null;
        const userNotifications = notificationMap.get(sub.user_id || "") || new Set();
        const lastChargeError = (meta?.last_charge_error as string) || null;
        const chargeAmount = (meta?.last_charge_amount as number) || 0;

        return {
          id: sub.id,
          user_id: sub.user_id || "",
          profile_id: sub.profile_id || profile?.profile_id || null,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          phone: profile?.phone || null,
          product_name: tariff?.products_v2?.name || null,
          tariff_name: tariff?.name || null,
          amount: chargeAmount,
          currency: "BYN",
          charge_attempts: sub.charge_attempts || 0,
          last_charge_at: (meta?.last_charge_attempt_at as string) || null,
          last_charge_error: lastChargeError,
          status: sub.status || "",
          type: "subscription" as const,
          notifications: {
            reminder7d: userNotifications.has("subscription_reminder_7d"),
            reminder3d: userNotifications.has("subscription_reminder_3d"),
            reminder1d: userNotifications.has("subscription_reminder_1d"),
            noCardWarning: userNotifications.has("subscription_no_card_warning"),
          },
        };
      });

      return items;
    },
  });

  return {
    summary: summaryQuery.data || {
      chargeAttempts: 0,
      successCount: 0,
      failedCount: 0,
      noCardCount: 0,
      reminders7d: 0,
      reminders3d: 0,
      reminders1d: 0,
      noCardWarnings: 0,
      totalAmount: 0,
      successAmount: 0,
    },
    details: detailsQuery.data || [],
    isLoading: summaryQuery.isLoading || detailsQuery.isLoading,
    error: summaryQuery.error || detailsQuery.error,
    refetch: () => {
      summaryQuery.refetch();
      detailsQuery.refetch();
    },
  };
}
