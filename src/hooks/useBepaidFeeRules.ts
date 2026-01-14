import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FeeRules {
  erip_percent: number;
  card_by_percent: number;
  card_foreign_percent: number;
  card_micro_percent: number;
  micro_amount_byn: number;
  fixed_per_txn: number;
}

const DEFAULT_FEE_RULES: FeeRules = {
  erip_percent: 1.0,
  card_by_percent: 2.4,
  card_foreign_percent: 2.9,
  card_micro_percent: 2.0,
  micro_amount_byn: 1.0,
  fixed_per_txn: 0,
};

export function useBepaidFeeRules() {
  return useQuery({
    queryKey: ['bepaid-fee-rules'],
    queryFn: async () => {
      const { data } = await supabase
        .from('integration_instances')
        .select('config')
        .eq('provider', 'bepaid')
        .in('status', ['active', 'connected'])
        .maybeSingle();
      
      const config = data?.config as Record<string, any> | null;
      const feeRules = config?.fee_rules as Partial<FeeRules> | undefined;
      
      return {
        ...DEFAULT_FEE_RULES,
        ...feeRules,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export type PaymentChannel = 'erip' | 'card';

export interface FeeCalculationResult {
  fee: number;
  source: 'provider' | 'fallback';
  percent: number;
}

/**
 * Calculate fee for a payment using fallback rules
 */
export function calculateFallbackFee(
  amount: number,
  currency: string,
  channel: PaymentChannel,
  issuerCountry: string | null | undefined,
  rules: FeeRules
): FeeCalculationResult {
  let percent: number;
  
  if (channel === 'erip') {
    percent = rules.erip_percent;
  } else {
    // Card payment
    // Micro payment check (amount == 1 BYN)
    if (currency === 'BYN' && amount === rules.micro_amount_byn) {
      percent = rules.card_micro_percent;
    } 
    // Foreign card check
    else if (issuerCountry && issuerCountry !== 'BY') {
      percent = rules.card_foreign_percent;
    } 
    // Default BY card rate
    else {
      percent = rules.card_by_percent;
    }
  }
  
  const fee = Math.round(amount * percent) / 100 + rules.fixed_per_txn;
  
  return {
    fee: Math.round(fee * 100) / 100, // Round to 2 decimal places
    source: 'fallback',
    percent,
  };
}

/**
 * Detect payment channel from transaction data
 */
export function detectPaymentChannel(
  paymentMethod?: string | null,
  transactionType?: string | null,
  providerResponse?: any
): PaymentChannel {
  const method = paymentMethod?.toLowerCase() || '';
  const type = transactionType?.toLowerCase() || '';
  
  // Check for ERIP
  if (method.includes('erip') || type.includes('erip')) {
    return 'erip';
  }
  
  // Check in provider response
  if (providerResponse) {
    const paymentMethodFromResponse = providerResponse.transaction?.payment_method_type?.toLowerCase() || 
                                       providerResponse.payment?.payment_method_type?.toLowerCase() ||
                                       providerResponse.payment_method?.toLowerCase() || '';
    if (paymentMethodFromResponse.includes('erip')) {
      return 'erip';
    }
  }
  
  // Default to card
  return 'card';
}

/**
 * Extract issuer country from provider response
 */
export function extractIssuerCountry(providerResponse?: any): string | null {
  if (!providerResponse) return null;
  
  return providerResponse.transaction?.card?.issuer_country ||
         providerResponse.card?.issuer_country ||
         providerResponse.issuer_country ||
         null;
}
