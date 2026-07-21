export interface CustomerCreditReservation {
  appliedMinor: number;
  reservationId: string | null;
}

export async function reserveReferralCustomerCredit(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  chargeAmountMinor: number;
  requestedMinor: number;
  checkoutKey: string;
}): Promise<CustomerCreditReservation> {
  if (!params.userId || params.requestedMinor <= 0 || params.chargeAmountMinor <= 100) {
    return { appliedMinor: 0, reservationId: null };
  }
  const { data, error } = await params.supabase.rpc('referral_reserve_customer_credit', {
    p_user_id: params.userId,
    p_requested_minor: Math.round(params.requestedMinor),
    p_charge_amount_minor: Math.round(params.chargeAmountMinor),
    p_checkout_key: params.checkoutKey,
  });
  if (error) throw new Error(`referral_customer_credit_reserve_failed:${error.message}`);
  return {
    appliedMinor: Math.max(0, Number(data?.applied_minor ?? 0)),
    reservationId: data?.reservation_id ? String(data.reservation_id) : null,
  };
}
