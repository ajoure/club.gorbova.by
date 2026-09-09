import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealsKanbanBoard } from "./DealsKanbanBoard";
import type { BoardDeal } from "@/hooks/useDealsBoard";
import type { CrmPipelineStage } from "@/services/pipelineService";

const fixture = vi.hoisted(() => ({
  loading: true,
  canEdit: false,
  stages: [] as CrmPipelineStage[],
  deals: [] as BoardDeal[],
  move: vi.fn(),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({
  canWrite: () => fixture.canEdit, isSuperAdmin: () => false,
}) }));
vi.mock("@/hooks/usePipelineStages", () => ({ usePipelineStages: () => ({
  stages: fixture.stages, isLoading: fixture.loading,
}) }));
vi.mock("@/hooks/useDealTaskSummary", () => ({ useDealTaskSummary: () => ({ data: {} }) }));
vi.mock("./KanbanBulkActionsBar", () => ({ KanbanBulkActionsBar: () => null }));
vi.mock("@/services/pipelineService", () => ({ bulkAssignDealsToStage: vi.fn() }));
vi.mock("@/hooks/useDealsBoard", () => ({ useDealsBoard: () => ({
  deals: fixture.deals, isLoading: fixture.loading, moveDeal: fixture.move,
  groupByStage: (stages: CrmPipelineStage[]) => {
    const groups: Record<string, BoardDeal[]> = { __unassigned: [] };
    stages.forEach(stage => { groups[stage.id] = []; });
    fixture.deals.forEach(deal => { (groups[deal.pipeline_stage_id ?? ""] ?? groups.__unassigned).push(deal); });
    return groups;
  },
  getStageTotals: (deals: BoardDeal[]) => ({ count: deals.length, sum: 0, avg: 0 }),
}) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function board(pipelineId = "pipeline-a") {
  return <DealsKanbanBoard pipelineId={pipelineId} onOpenDeal={onOpenDeal} />;
}
const onOpenDeal = vi.fn();

describe("staff board runtime", () => {
  it.each([false, true])("renders loading, empty and populated board without mutations (write=%s)", canEdit => {
    fixture.loading = true;
    fixture.canEdit = canEdit;
    fixture.stages = [];
    fixture.deals = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>;
    const view = render(board(), { wrapper });
    fixture.loading = false;
    fixture.stages = [{ id: "stage-a", name: "В работе", stage_type: "open", color: "#6366f1" } as CrmPipelineStage];
    view.rerender(board());
    expect(screen.getAllByText("Нет сделок").length).toBeGreaterThan(0);
    fixture.deals = [{
      id: "deal-a", product_name: "Тестовый продукт", status: "pending", currency: "BYN",
      final_price: 0, pipeline_stage_id: "stage-a", created_at: "2026-09-09T08:00:00Z",
    } as BoardDeal];
    view.rerender(board());
    fireEvent.click(screen.getByText("Тестовый продукт"));
    expect(onOpenDeal).toHaveBeenCalledWith("deal-a");
    view.rerender(board("pipeline-b"));
    expect(fixture.move).not.toHaveBeenCalled();
  });
});
