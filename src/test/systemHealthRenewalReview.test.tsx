import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { OwnerProblemCard } from "@/components/admin/system-health/owner/OwnerProblemCard";

afterEach(cleanup);
describe("provider renewal operator outcomes", () => {
  it("keeps business declines and local-state mismatches visible as manual review", () => {
    render(<MemoryRouter><OwnerProblemCard code="INV-P0-1-R" count={2} /></MemoryRouter>);
    expect(screen.getByText("нужна ручная проверка")).toBeInTheDocument();
    expect(screen.getByText("Подписок для проверки: 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скопировать описание" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Автопродления/ })).toHaveAttribute("href", "/admin/payments/auto-renewals");
    expect(screen.queryByText("требует исправления")).not.toBeInTheDocument();
  });
  it("preserves the actionable critical renewal card", () => {
    render(<MemoryRouter><OwnerProblemCard code="INV-P0-1" count={1} /></MemoryRouter>);
    expect(screen.getByText("требует исправления")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скопировать PATCH для Lovable" })).toBeInTheDocument();
  });
  it("keeps the diagnose branch before persistence and never adds a provider writer", () => {
    const source = readFileSync("supabase/functions/system-health-full-check/index.ts", "utf8");
    const diagnose = source.indexOf('body.action === "diagnose_renewals"');
    expect(diagnose).toBeGreaterThan(source.indexOf("if (!authorized)"));
    expect(diagnose).toBeLessThan(source.indexOf('// STEP 1: Read function list'));
    const provider = readFileSync("supabase/functions/system-health-full-check/renewal-check.ts", "utf8");
    expect(provider).not.toMatch(/\.(?:insert|update|upsert|delete|invoke)\(/);
    expect(provider).not.toMatch(/method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/);
  });
});
