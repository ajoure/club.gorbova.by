import { assert } from "jsr:@std/assert@1";

const config = await Deno.readTextFile(
  new URL("../../config.toml", import.meta.url),
);
const indexSource = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const authSource = await Deno.readTextFile(
  new URL("./caller_auth.ts", import.meta.url),
);

Deno.test("grant-access owns auth before any order lookup", () => {
  const authCall = indexSource.indexOf("resolveGrantAccessCaller(req, supabase)");
  const orderLookup = indexSource.indexOf('// Load order with product/tariff info');
  assert(authCall >= 0);
  assert(orderLookup > authCall);
});

Deno.test("grant-access gateway permits secret-key calls only through custom auth", () => {
  assert(
    /\[functions\.grant-access-for-order\]\s+verify_jwt = false/m.test(config),
  );
  assert(authSource.includes('token === serviceRoleKey'));
  assert(authSource.includes('supabase.auth.getUser(token)'));
  assert(authSource.includes('enforceBranchPolicy'));
});
