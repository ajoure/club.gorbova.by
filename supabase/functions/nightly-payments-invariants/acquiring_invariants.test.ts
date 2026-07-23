import { assertStringIncludes } from "jsr:@std/assert";

const invariantsSource = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const healthSource = await Deno.readTextFile(
  new URL("../nightly-system-health/index.ts", import.meta.url),
);

Deno.test("acquiring delivery and reconciliation guards remain enabled", () => {
  for (const invariant of ["INV-23", "INV-24", "INV-25"]) {
    assertStringIncludes(invariantsSource, invariant);
    assertStringIncludes(healthSource, invariant);
  }

  assertStringIncludes(invariantsSource, '.eq("provider", "bepaid")');
  assertStringIncludes(invariantsSource, '.from("payment_reconcile_queue")');
  assertStringIncludes(invariantsSource, '.from("payments_v2")');
  assertStringIncludes(invariantsSource, '.eq("status", "processing")');
});
