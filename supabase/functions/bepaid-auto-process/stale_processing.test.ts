import { assertStringIncludes } from "jsr:@std/assert";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("batch retries only stale processing queue rows", () => {
  assertStringIncludes(source, "status.eq.processing");
  assertStringIncludes(source, "updated_at.lt.");
  assertStringIncludes(source, "2 * 60 * 60 * 1000");
});
