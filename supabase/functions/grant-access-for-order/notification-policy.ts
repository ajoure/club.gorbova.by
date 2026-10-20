/** Staff/user body fields cannot suppress notices; only an authenticated service repair can. */
export function shouldNotifyTelegramCustomer(callerType: string, context: unknown, requested: unknown): boolean {
  return !(callerType === "service_role" && context === "historical_payment_recovery" && requested === false);
}
