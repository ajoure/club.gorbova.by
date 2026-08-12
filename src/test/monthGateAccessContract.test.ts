import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("paid-month training-content contract", () => {
  it("keeps monthly rules out of the product-entitlement bypass in both gates", () => {
    const lessonHook = readRepoFile("src/hooks/useMonthGate.ts");
    const moduleHook = readRepoFile("src/hooks/useModuleMonthGate.ts");

    expect(lessonHook).toContain("isExplicitProductBypassRule");
    expect(moduleHook).toContain("isExplicitProductBypassRule");
    expect(moduleHook).toContain(
      "if (r.tariff_id && !userTariffIds.has(r.tariff_id)) continue",
    );
    expect(lessonHook).toContain("matched rules stay locked");
    expect(moduleHook).toContain("matched rules stay locked");
  });

  it("requires the exact active tariff for every tariff-scoped bypass", () => {
    const lessonHook = readRepoFile("src/hooks/useMonthGate.ts");
    const moduleHook = readRepoFile("src/hooks/useModuleMonthGate.ts");

    const exactTariffGuard =
      "if (r.tariff_id && !userTariffIds.has(r.tariff_id)) continue";
    expect(lessonHook).toContain(exactTariffGuard);
    expect(moduleHook).toContain(exactTariffGuard);
  });
});
