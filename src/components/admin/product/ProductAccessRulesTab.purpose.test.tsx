import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductAccessRulesTab } from "./ProductAccessRulesTab";

const fixture = vi.hoisted(() => ({ purpose: "workspace_entry", mutate: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("./ProductLinkedTrainingsBlock", () => ({ ProductLinkedTrainingsBlock: () => null }));
vi.mock("./RetroApplyPanel", () => ({ RetroApplyPanel: () => null }));
vi.mock("./TrainingContentTreePicker", () => ({
  TrainingContentTreePicker: () => null,
  normalizeTrainingContentPayload: vi.fn(),
}));
vi.mock("@/hooks/useTrainingContentRules", () => ({ useTrainingContentTree: () => ({ data: undefined }) }));
vi.mock("@/hooks/useAccessRuleSelectors", () => ({
  useAvailableClubs: () => ({ data: [] }),
  useAvailableProducts: () => ({ data: [] }),
  useAvailableEntitlements: () => ({ data: [] }),
  useTariffDurations: () => ({ data: [] }),
  useAvailableSections: () => ({ data: [] }),
  getClubAccessLabel: () => "",
}));
vi.mock("@/hooks/useAccessRules", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/useAccessRules")>(),
  useEffectiveGrants: () => ({ data: [] }),
  useAccessRules: () => ({
    rules: [{
      id: "workspace-rule", product_id: "cb20", tariff_id: "business-lady",
      grant_target_type: "section_access", target_ref: "ai", target_label: "Нейросеть",
      conditions: { rule_purpose: fixture.purpose, source: "cb_ai_tools_workspace_entry" },
      is_active: true, priority: 29, duration_days: null,
      tariff: { id: "business-lady", name: "Бизнес-леди" },
    }],
    legacyMappings: [], isLoading: false,
    createRule: fixture.mutate, updateRule: fixture.mutate,
    deleteRule: fixture.mutate, toggleRule: fixture.mutate,
  }),
}));

function renderRules() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProductAccessRulesTab productId="cb20" tariffs={[{ id: "business-lady", name: "Бизнес-леди" }]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("access rule purposes received from the server", () => {
  beforeEach(() => { fixture.mutate.mockClear(); });

  it("renders the workspace_entry rule used by the CB20/CB21 migration", () => {
    fixture.purpose = "workspace_entry";
    const html = renderRules();
    expect(html).toContain("Нейросеть");
    expect(html).toContain("Вход в рабочее пространство");
    expect(fixture.purpose).toBe("workspace_entry");
    expect(fixture.mutate).not.toHaveBeenCalled();
  });

  it("keeps the list readable for future server purposes without rewriting them", () => {
    fixture.purpose = "future_server_purpose";
    const html = renderRules();
    expect(html).toContain("Нейросеть");
    expect(html).toContain("Другое назначение");
    expect(fixture.purpose).toBe("future_server_purpose");
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
});
