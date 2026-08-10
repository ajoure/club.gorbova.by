import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("normal fulfillment and idempotent replay both sync the Club bonus source", () => {
  const calls = source.match(/syncConfiguredClubBonusSource\(supabase/g) || [];
  assertEquals(calls.length, 2);
  assert(source.includes("results.club_bonus_source = clubBonusSource"));
  assert(source.includes("club_bonus_source: clubBonusSource"));
});

Deno.test("Club bonus source sync is not nested under Telegram delivery", () => {
  const normalSync = source.lastIndexOf("const clubBonusSource = await syncConfiguredClubBonusSource");
  const telegramBranch = source.indexOf("if (grantTelegram)", normalSync);
  assert(normalSync > 0);
  assert(telegramBranch > normalSync);
});
