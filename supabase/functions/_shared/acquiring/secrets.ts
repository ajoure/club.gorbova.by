// Phase 1 Stripe Integration — scoped secret resolver
// single-account-now / multi-account-ready
//
// Reads provider secrets with optional per-account scoping.
//
// Lookup order:
//   1) <KEY_NAME>_<ACCOUNT_CODE.toUpperCase()>  (e.g. STRIPE_SECRET_KEY_STRIPE_POLAND)
//   2) <KEY_NAME>                                (e.g. STRIPE_SECRET_KEY) — single-account fallback
//
// On MVP only #2 is configured. When a second account is added, the operator
// uploads STRIPE_SECRET_KEY_<NEW_ACCOUNT_CODE> WITHOUT any code change.

export function getAcquiringSecret(
  account_code: string | null | undefined,
  key_name: string,
): string {
  if (account_code) {
    const scopedKey = `${key_name}_${account_code.toUpperCase().replace(/-/g, '_')}`;
    const scoped = Deno.env.get(scopedKey);
    if (scoped) return scoped;
  }
  const global = Deno.env.get(key_name);
  if (global) return global;
  throw new Error(`secret_not_found:${key_name}:${account_code ?? '(default)'}`);
}

export function hasAcquiringSecret(
  account_code: string | null | undefined,
  key_name: string,
): boolean {
  try {
    getAcquiringSecret(account_code, key_name);
    return true;
  } catch {
    return false;
  }
}
