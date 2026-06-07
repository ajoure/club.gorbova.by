/**
 * Phase 5-C — Customer Provider Choice resolver (edge mirror).
 *
 * См. `src/utils/resolveCustomerProviderChoice.ts` — поведение идентично.
 */
export type CustomerProvider = "bepaid" | "stripe";

export interface AcquiringMeta {
  allowed_payment_providers?: CustomerProvider[];
  default_provider?: CustomerProvider;
}

export interface ProviderChoiceResolution {
  mode: "single" | "choice";
  providers: CustomerProvider[];
  defaultProvider: CustomerProvider;
}

export function resolveProviderChoice(meta?: AcquiringMeta | null): ProviderChoiceResolution {
  const allowedRaw = Array.isArray(meta?.allowed_payment_providers)
    ? meta!.allowed_payment_providers!
    : [];
  const allowed = allowedRaw.filter((p): p is CustomerProvider => p === "bepaid" || p === "stripe");

  if (allowed.length === 0) {
    return { mode: "single", providers: ["bepaid"], defaultProvider: "bepaid" };
  }
  if (allowed.length === 1) {
    return { mode: "single", providers: allowed, defaultProvider: allowed[0] };
  }
  const def: CustomerProvider =
    meta?.default_provider && allowed.includes(meta.default_provider)
      ? meta.default_provider
      : "bepaid";
  return { mode: "choice", providers: allowed, defaultProvider: def };
}

export function isValidProviderChoice(
  choice: unknown,
  resolution: ProviderChoiceResolution
): boolean {
  if (choice !== "bepaid" && choice !== "stripe") return false;
  return resolution.providers.includes(choice);
}
