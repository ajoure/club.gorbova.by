import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("nightly reconcile includes only live independent bonus sources", () => {
  assert(source.includes(".from('entitlement_sources')"));
  assert(source.includes(".eq('source_type', 'bonus')"));
  assert(
    source.includes(
      ".eq('meta->>origin', 'upsert_club_bonus_entitlement_source')",
    ),
  );
  assert(source.includes(".eq('status', 'active')"));
  assert(source.includes(".gt('expires_at', nowIso)"));
});

Deno.test("bonus source window stays separate from subscriptions", () => {
  const subscriptionBranches =
    source.match(/sourceSubscription: s\.source_kind === 'subscription'/g) ||
    [];
  const entitlementBranches = source.match(
    /sourceEntitlementSource: s\.source_kind === 'entitlement_source'/g,
  ) || [];
  assertEquals(subscriptionBranches.length, 1);
  assertEquals(entitlementBranches.length, 1);
  assert(source.includes("entitlement_sources_processed"));
});
