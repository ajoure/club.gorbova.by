import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

export interface DiagnosticsFilters {
  from: string;
  to?: string;
  brand?: string;
  issuerBank?: string;
  issuerCountry?: string;
  clientCountry?: string;
  errorCategory?: string;
  transactionType?: "payment" | "refund" | "all";
  has3DS?: boolean | null;
}

export interface DiagnosticsStats {
  total: number;
  successful: number;
  failed: number;
  approvalRate: number;
  needs3dsCount: number;
  needs3dsRate: number;
  byCount: number;
  nonByCount: number;
  sampleSize: number;
}

export interface BankBreakdown {
  bank: string;
  country: string;
  total: number;
  successful: number;
  failed: number;
  needs3ds: number;
  approvalRate: number;
}

export interface ErrorBreakdown {
  category: string;
  label: string;
  count: number;
  percentage: number;
}

export interface DailyTrend {
  date: string;
  total: number;
  successful: number;
  failed: number;
  approvalRate: number;
}

// Error category labels in Russian
export const ERROR_CATEGORY_LABELS: Record<string, string> = {
  needs_3ds: "Требует 3DS",
  do_not_honor: "Отклонено банком",
  insufficient_funds: "Недостаточно средств",
  issuer_block: "Блокировка эмитента",
  expired_card: "Карта просрочена",
  invalid_card: "Неверные данные",
  lost_stolen: "Утеряна/украдена",
  timeout: "Таймаут/недоступность",
  unknown: "Неизвестная ошибка",
};

// Normalize error category from message
export function normalizeErrorCategory(message: string | null): string {
  if (!message) return "unknown";

  const lowerMessage = message.toLowerCase();

  // 3DS related
  if (
    lowerMessage.includes("3d secure") ||
    lowerMessage.includes("3-d secure") ||
    lowerMessage.includes("authentication") ||
    lowerMessage.includes("3ds")
  ) {
    return "needs_3ds";
  }

  // Decline codes
  if (lowerMessage.includes("51") || lowerMessage.includes("insufficient")) {
    return "insufficient_funds";
  }

  if (lowerMessage.includes("do not honor") || lowerMessage.includes("05")) {
    return "do_not_honor";
  }

  if (
    lowerMessage.includes("expired") ||
    lowerMessage.includes("33") ||
    lowerMessage.includes("54")
  ) {
    return "expired_card";
  }

  if (lowerMessage.includes("invalid") || lowerMessage.includes("14")) {
    return "invalid_card";
  }

  if (lowerMessage.includes("lost") || lowerMessage.includes("41")) {
    return "lost_stolen";
  }

  if (lowerMessage.includes("stolen") || lowerMessage.includes("43")) {
    return "lost_stolen";
  }

  if (lowerMessage.includes("timeout") || lowerMessage.includes("unavailable")) {
    return "timeout";
  }

  if (
    lowerMessage.includes("block") ||
    lowerMessage.includes("restrict") ||
    lowerMessage.includes("not permitted")
  ) {
    return "issuer_block";
  }

  return "unknown";
}

export function usePaymentDiagnostics(filters: DiagnosticsFilters) {
  const queryKey = ["payment-diagnostics", filters];

  const { data: rawData, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      let query = supabase
        .from("payment_reconcile_queue")
        .select("*")
        .gte("created_at", filters.from);

      if (filters.to) {
        query = query.lte("created_at", filters.to + "T23:59:59");
      }

      if (filters.brand && filters.brand !== "all") {
        query = query.eq("card_brand", filters.brand);
      }

      if (filters.issuerBank && filters.issuerBank !== "all") {
        query = query.eq("card_bank", filters.issuerBank);
      }

      if (filters.issuerCountry && filters.issuerCountry !== "all") {
        query = query.eq("card_bank_country", filters.issuerCountry);
      }

      if (filters.clientCountry && filters.clientCountry !== "all") {
        query = query.eq("customer_country", filters.clientCountry);
      }

      if (filters.transactionType && filters.transactionType !== "all") {
        query = query.eq("transaction_type", filters.transactionType);
      }

      if (filters.has3DS !== null && filters.has3DS !== undefined) {
        query = query.eq("three_d_secure", filters.has3DS);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Process data to calculate stats
  const processedData = useMemo(() => {
    if (!rawData || rawData.length === 0) {
      return {
        stats: {
          total: 0,
          successful: 0,
          failed: 0,
          approvalRate: 0,
          needs3dsCount: 0,
          needs3dsRate: 0,
          byCount: 0,
          nonByCount: 0,
          sampleSize: 0,
        } as DiagnosticsStats,
        bankBreakdown: [] as BankBreakdown[],
        errorBreakdown: [] as ErrorBreakdown[],
        dailyTrend: [] as DailyTrend[],
        filterOptions: {
          brands: [] as string[],
          banks: [] as string[],
          issuerCountries: [] as string[],
          clientCountries: [] as string[],
        },
      };
    }

    // Apply error_category filter after fetching (since column may not exist yet)
    let filteredData = rawData;
    if (filters.errorCategory && filters.errorCategory !== "all") {
      filteredData = rawData.filter((item) => {
        const category =
          item.error_category || normalizeErrorCategory(item.message || item.reason);
        return category === filters.errorCategory;
      });
    }

    // Calculate stats
    const total = filteredData.length;
    const successful = filteredData.filter(
      (item) => item.status_normalized === "successful" || item.status === "successful"
    ).length;
    const failed = total - successful;
    const approvalRate = total > 0 ? (successful / total) * 100 : 0;

    // 3DS analysis
    const needs3dsItems = filteredData.filter((item) => {
      const category =
        item.error_category || normalizeErrorCategory(item.message || item.reason);
      return category === "needs_3ds";
    });
    const needs3dsCount = needs3dsItems.length;
    const needs3dsRate = failed > 0 ? (needs3dsCount / failed) * 100 : 0;

    // Geo analysis (BY vs non-BY)
    const byCount = filteredData.filter(
      (item) =>
        item.customer_country === "BY" ||
        item.card_bank_country === "BY" ||
        item.client_geo_country === "BY"
    ).length;
    const nonByCount = total - byCount;

    const stats: DiagnosticsStats = {
      total,
      successful,
      failed,
      approvalRate,
      needs3dsCount,
      needs3dsRate,
      byCount,
      nonByCount,
      sampleSize: total,
    };

    // Bank breakdown
    const bankMap = new Map<string, { total: number; successful: number; failed: number; needs3ds: number; country: string }>();

    for (const item of filteredData) {
      const bank = item.card_bank || "Unknown";
      const country = item.card_bank_country || "??";
      const isSuccessful =
        item.status_normalized === "successful" || item.status === "successful";
      const category =
        item.error_category || normalizeErrorCategory(item.message || item.reason);
      const isNeeds3ds = category === "needs_3ds";

      if (!bankMap.has(bank)) {
        bankMap.set(bank, { total: 0, successful: 0, failed: 0, needs3ds: 0, country });
      }

      const bankData = bankMap.get(bank)!;
      bankData.total++;
      if (isSuccessful) {
        bankData.successful++;
      } else {
        bankData.failed++;
        if (isNeeds3ds) bankData.needs3ds++;
      }
    }

    const bankBreakdown: BankBreakdown[] = Array.from(bankMap.entries())
      .map(([bank, data]) => ({
        bank,
        country: data.country,
        total: data.total,
        successful: data.successful,
        failed: data.failed,
        needs3ds: data.needs3ds,
        approvalRate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
      }))
      .sort((a, b) => b.failed - a.failed)
      .slice(0, 20);

    // Error breakdown
    const errorMap = new Map<string, number>();
    for (const item of filteredData) {
      if (
        item.status_normalized === "successful" ||
        item.status === "successful"
      )
        continue;

      const category =
        item.error_category || normalizeErrorCategory(item.message || item.reason);
      errorMap.set(category, (errorMap.get(category) || 0) + 1);
    }

    const errorBreakdown: ErrorBreakdown[] = Array.from(errorMap.entries())
      .map(([category, count]) => ({
        category,
        label: ERROR_CATEGORY_LABELS[category] || category,
        count,
        percentage: failed > 0 ? (count / failed) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Daily trend
    const dailyMap = new Map<string, { total: number; successful: number; failed: number }>();
    for (const item of filteredData) {
      const date = item.created_at?.split("T")[0] || "unknown";
      const isSuccessful =
        item.status_normalized === "successful" || item.status === "successful";

      if (!dailyMap.has(date)) {
        dailyMap.set(date, { total: 0, successful: 0, failed: 0 });
      }

      const dayData = dailyMap.get(date)!;
      dayData.total++;
      if (isSuccessful) {
        dayData.successful++;
      } else {
        dayData.failed++;
      }
    }

    const dailyTrend: DailyTrend[] = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        total: data.total,
        successful: data.successful,
        failed: data.failed,
        approvalRate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Filter options (unique values)
    const brands = [...new Set(rawData.map((item) => item.card_brand).filter(Boolean))] as string[];
    const banks = [...new Set(rawData.map((item) => item.card_bank).filter(Boolean))] as string[];
    const issuerCountries = [...new Set(rawData.map((item) => item.card_bank_country).filter(Boolean))] as string[];
    const clientCountries = [...new Set(rawData.map((item) => item.customer_country || item.client_geo_country).filter(Boolean))] as string[];

    return {
      stats,
      bankBreakdown,
      errorBreakdown,
      dailyTrend,
      filterOptions: {
        brands: brands.sort(),
        banks: banks.sort(),
        issuerCountries: issuerCountries.sort(),
        clientCountries: clientCountries.sort(),
      },
    };
  }, [rawData, filters.errorCategory]);

  return {
    ...processedData,
    isLoading,
    error,
    refetch,
    rawData,
  };
}
