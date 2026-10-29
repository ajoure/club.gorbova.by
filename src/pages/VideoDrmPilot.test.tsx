import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideoDrmPilot from "./VideoDrmPilot";

const mocks = vi.hoisted(() => ({ userId: "11111111-1111-4111-8111-111111111111", invoke: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: mocks.userId } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
let handlers: Record<string, (event: { data?: { currentTime?: number } }) => void>;
let player: ReturnType<typeof makePlayer>;
function makePlayer() {
  return { on: vi.fn((name: string, callback: (e: { data?: { currentTime?: number } }) => void) => { handlers[name] = callback; }),
    destroy: vi.fn(async () => {}), pause: vi.fn(async () => {}), getDuration: vi.fn(async () => 300),
    seekTo: vi.fn(async () => {}), getCurrentTime: vi.fn(async () => 125),
    isPaused: vi.fn(async () => true), getPlaybackRate: vi.fn(async () => 1),
    getVideoQuality: vi.fn(async () => ({ height: 360 })), setPlaylistItemOptions: vi.fn(async () => {}) };
}
beforeEach(() => {
  mocks.userId = "11111111-1111-4111-8111-111111111111";
  handlers = {}; player = makePlayer(); localStorage.clear();
  mocks.invoke.mockResolvedValue({ data: { token: "synthetic-token", expiresAt: Math.floor(Date.now() / 1000) + 60,
    renewAfterSeconds: 36, mediaKey: "synthetic-vod", mediaType: "vod", playerId: "syntheticPlayer" }, error: null });
  window.Kinescope = { IframePlayer: { create: vi.fn(async () => player),
    Events: { Loaded: "loaded", TimeUpdate: "time", Pause: "pause", Seeked: "seek" } } } as unknown as typeof window.Kinescope;
});
afterEach(() => { cleanup(); delete window.Kinescope; vi.clearAllMocks(); });

describe("pilot resume belongs to the user and asset", () => {
  it("restores once and saves the latest backward seek instead of maximum watched time", async () => {
    const key = `video-drm-pilot:${mocks.userId}:syntheticPlayer`;
    localStorage.setItem(key, "195");
    render(<VideoDrmPilot />);
    await waitFor(() => expect(handlers.loaded).toBeDefined());
    await act(async () => { handlers.loaded({}); handlers.loaded({}); });
    await waitFor(() => expect(player.seekTo).toHaveBeenCalledExactlyOnceWith(195));
    await act(async () => { handlers.time({ data: { currentTime: 125 } }); handlers.pause({}); });
    expect(localStorage.getItem(key)).toBe("125");
    expect(player.setPlaylistItemOptions).not.toHaveBeenCalled();
  });
  it("does not restore another user's position and sets encrypted-media permission", async () => {
    localStorage.setItem("video-drm-pilot:another-user:syntheticPlayer", "195");
    const view = render(<VideoDrmPilot />);
    await waitFor(() => expect(handlers.loaded).toBeDefined());
    await act(async () => { handlers.loaded({}); });
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(view.container.querySelector("iframe")?.getAttribute("allow")).toContain("encrypted-media");
  });
  it("does not overwrite saved progress if restoring the position fails", async () => {
    const key = `video-drm-pilot:${mocks.userId}:syntheticPlayer`;
    localStorage.setItem(key, "195"); player.seekTo.mockRejectedValue(new Error("synthetic failure"));
    render(<VideoDrmPilot />);
    await waitFor(() => expect(handlers.loaded).toBeDefined());
    await act(async () => { handlers.loaded({}); });
    await waitFor(() => expect(player.pause).toHaveBeenCalled());
    await act(async () => { handlers.time({ data: { currentTime: 0 } }); handlers.pause({}); });
    expect(localStorage.getItem(key)).toBe("195");
  });
});
