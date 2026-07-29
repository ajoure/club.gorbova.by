import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("no-card trial does not report success before access grant succeeds", () => {
  const grantCall = source.indexOf("const grantRes = await supabase.functions.invoke('grant-access-for-order'");
  const grantSuccess = source.indexOf("const grantSucceeded = !grantRes.error && grantRes.data?.success === true", grantCall);
  const failureResponse = source.indexOf("stage: 'grant_access_for_order'", grantSuccess);
  const successResponse = source.indexOf("isTrialNoCard: true", failureResponse);

  assert(grantCall > 0);
  assert(grantSuccess > grantCall);
  assert(failureResponse > grantSuccess);
  assert(successResponse > failureResponse);
});

Deno.test("retry repairs the original paid no-card trial instead of creating a duplicate", () => {
  const priorOrder = source.indexOf("const { data: priorTrial } = await priorQuery.maybeSingle()");
  const repairCall = source.indexOf("const repairGrant = await supabase.functions.invoke('grant-access-for-order'", priorOrder);
  const repairAudit = source.indexOf("action: 'trial.no_card.repaired_existing_access'", repairCall);
  const newOrderInsert = source.indexOf(".from('orders_v2')\n          .insert", priorOrder);

  assert(priorOrder > 0);
  assert(repairCall > priorOrder);
  assert(repairAudit > repairCall);
  assert(newOrderInsert > repairAudit);
  assertEquals(source.includes("repairedExistingTrial: true"), true);
});
