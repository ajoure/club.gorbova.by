import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveEventRoomBlocks } from "./LiveEventRoomBlocks";
import { LiveEventRoomBlocksEditor } from "@/components/admin/live/LiveEventRoomBlocksEditor";

type Block = {
  id: string;
  live_event_id: string;
  block_type: string;
  position: string;
  display_scope: string;
  sort_order: number;
  is_active: boolean;
  config: Record<string, string>;
};

const server = vi.hoisted(() => ({
  blocks: [] as Block[],
  reads: [] as { filters: Record<string, unknown> }[],
  updates: [] as Record<string, unknown>[],
  updateError: null as null | { message: string },
  changes: [] as (() => void)[],
  statuses: [] as ((status: string) => void)[],
  removeChannel: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    if (table !== "live_event_room_blocks") throw new Error(`Unexpected table: ${table}`);
    const filters: Record<string, unknown> = {};
    let update: Record<string, unknown> | undefined;
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters[column] = value; return query; },
      order: async () => {
        server.reads.push({ filters: { ...filters } });
        return {
          data: server.blocks
            .filter((block) => Object.entries(filters).every(([key, value]) => block[key as keyof Block] === value))
            .map((block) => ({ ...block, config: { ...block.config } })),
          error: null,
        };
      },
      update: (values: Record<string, unknown>) => { update = values; return query; },
      single: async () => {
        server.updates.push({ ...filters, ...update });
        if (server.updateError) return { data: null, error: server.updateError };
        const block = server.blocks.find((row) => row.id === filters.id);
        if (!block) return { data: null, error: { message: "Expected one updated block, received zero" } };
        Object.assign(block, update);
        // A hidden row fails the viewer's SELECT policy: no realtime event.
        return { data: { id: block.id }, error: null };
      },
    };
    return query;
  },
  channel: () => {
    const channel = {
      on: (_type: string, _filter: unknown, callback: () => void) => { server.changes.push(callback); return channel; },
      subscribe: (callback: (status: string) => void) => { server.statuses.push(callback); return channel; },
    };
    return channel;
  },
  removeChannel: server.removeChannel,
} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("sonner", () => ({ toast: { error: server.toastError, success: vi.fn() } }));

const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } } });
  clients.push(client);
  const Provider = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { Provider, client };
}
function block(overrides: Partial<Block> = {}): Block {
  return {
    id: "synthetic-block", live_event_id: "synthetic-live", block_type: "button",
    position: "under_video", display_scope: "always", sort_order: 1, is_active: true,
    config: { text: "Synthetic offer", target_url: "https://example.com/offer" }, ...overrides,
  };
}
const viewer = <LiveEventRoomBlocks liveEventId="synthetic-live" displayContext="live" position="under_video" />;
async function settle(ms = 25) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  server.blocks = [block()]; server.reads = []; server.updates = [];
  server.updateError = null; server.changes = []; server.statuses = [];
  vi.clearAllMocks();
  focusManager.setFocused(true); onlineManager.setOnline(true);
});
afterEach(() => {
  cleanup(); clients.splice(0).forEach((client) => client.clear());
  focusManager.setFocused(undefined); onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("live room block visibility", () => {
  it("removes a hidden block without a realtime event or remounting the player", async () => {
    const { Provider } = wrapper();
    render(<><iframe title="Existing player" />{viewer}</>, { wrapper: Provider });
    await settle();
    const player = screen.getByTitle("Existing player");
    expect(screen.getByRole("button", { name: "Synthetic offer" })).toBeInTheDocument();

    server.blocks[0].is_active = false;
    await settle(5_000);

    expect(screen.queryByRole("button", { name: "Synthetic offer" })).not.toBeInTheDocument();
    expect(screen.getByTitle("Existing player")).toBe(player);
    expect(server.updates).toHaveLength(0);
    expect(server.reads.every(({ filters }) => filters.is_active === true)).toBe(true);
  });

  it("discovers newly shown blocks from an empty list and removes deleted ones", async () => {
    server.blocks = [];
    const { Provider } = wrapper();
    render(viewer, { wrapper: Provider });
    await settle();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    server.blocks = [block(), block({ id: "other-position", position: "sidebar" }), block({ id: "other-event", live_event_id: "other-live" })];
    await settle(5_000);
    expect(screen.getAllByRole("button", { name: "Synthetic offer" })).toHaveLength(1);
    server.blocks = [];
    await settle(5_000);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shares one polling read across under-video and sidebar placements", async () => {
    server.blocks = [block(), block({ id: "sidebar", position: "sidebar", config: { text: "Sidebar offer", target_url: "https://example.com/sidebar" } })];
    const { Provider } = wrapper();
    render(<>{viewer}<LiveEventRoomBlocks liveEventId="synthetic-live" displayContext="live" position="sidebar" /></>, { wrapper: Provider });
    await settle();
    expect(server.reads).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Synthetic offer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sidebar offer" })).toBeInTheDocument();
    await settle(5_000);
    expect(server.reads).toHaveLength(2);
    server.blocks[0].position = "sidebar";
    await settle(5_000);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(server.reads).toHaveLength(3);
  });

  it("refetches immediately when realtime is restored and on later changes", async () => {
    const { Provider } = wrapper();
    render(viewer, { wrapper: Provider });
    await settle();
    server.blocks[0].is_active = false;
    await act(async () => { server.statuses[0]("SUBSCRIBED"); });
    await settle();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    server.blocks[0].is_active = true;
    await act(async () => { server.changes[0](); });
    await settle();
    expect(screen.getByRole("button", { name: "Synthetic offer" })).toBeInTheDocument();
  });

  it("recovers on focus and network reconnect despite disabled application defaults", async () => {
    const { Provider } = wrapper();
    render(viewer, { wrapper: Provider });
    await settle();
    server.blocks[0].is_active = false;
    await act(async () => { focusManager.setFocused(false); });
    const reads = server.reads.length;
    await settle(5_000);
    expect(server.reads).toHaveLength(reads);
    await act(async () => { focusManager.setFocused(true); });
    await settle();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    server.blocks[0].is_active = true;
    await act(async () => { onlineManager.setOnline(false); onlineManager.setOnline(true); });
    await settle();
    expect(screen.getByRole("button", { name: "Synthetic offer" })).toBeInTheDocument();
  });

  it("preserves live/replay display rules and releases polling/subscriptions on exit", async () => {
    server.blocks = [block({ display_scope: "replay_only" })];
    const { Provider } = wrapper();
    const view = render(viewer, { wrapper: Provider });
    await settle();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(<LiveEventRoomBlocks liveEventId="synthetic-live" displayContext="replay" position="under_video" />);
    expect(screen.getByRole("button", { name: "Synthetic offer" })).toBeInTheDocument();
    view.unmount();
    const reads = server.reads.length;
    await settle(10_000);
    expect(server.reads).toHaveLength(reads);
    expect(server.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("updates the editor and local preview immediately, then an independent viewer by polling", async () => {
    const admin = wrapper(); const audience = wrapper();
    render(<><LiveEventRoomBlocksEditor liveEventId="synthetic-live" />{viewer}</>, { wrapper: admin.Provider });
    render(viewer, { wrapper: audience.Provider });
    await settle();
    expect(screen.getAllByRole("button", { name: "Synthetic offer" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("switch"));
    await settle();
    expect(screen.getByRole("switch")).not.toBeChecked();
    // The separate browser still has its own cache and no hidden-row event.
    expect(screen.getAllByRole("button", { name: "Synthetic offer" })).toHaveLength(1);
    await settle(5_000);
    expect(screen.queryByRole("button", { name: "Synthetic offer" })).not.toBeInTheDocument();
    expect(server.updates).toHaveLength(1);
    expect(server.updates[0]).toMatchObject({ id: "synthetic-block", is_active: false });
  });

  it("reports a denied/zero-row update instead of claiming the block was hidden", async () => {
    server.updateError = { message: "Expected one updated block, received zero" };
    const { Provider } = wrapper();
    render(<LiveEventRoomBlocksEditor liveEventId="synthetic-live" />, { wrapper: Provider });
    await settle();
    fireEvent.click(screen.getByRole("switch"));
    await settle();
    expect(server.toastError).toHaveBeenCalledWith(expect.stringContaining(server.updateError.message));
    expect(screen.getByRole("switch")).toBeChecked();
    expect(server.blocks[0].is_active).toBe(true);
  });
});
