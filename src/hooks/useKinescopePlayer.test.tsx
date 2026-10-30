import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKinescopePlayer } from "./useKinescopePlayer";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
type Handler = (...args: unknown[]) => unknown;
let events: Map<string, Handler>;
let position: number;
let player: ReturnType<typeof makePlayer>;
let create: ReturnType<typeof vi.fn>;
function makePlayer() {
  return { seekTo: vi.fn(async (seconds: number) => { position = seconds; }), play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}), mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}),
    getCurrentTime: vi.fn(async () => position), getDuration: vi.fn(async () => 600),
    destroy: vi.fn(), on: vi.fn((name: string, handler: Handler) => events.set(name, handler)), off: vi.fn() };
}
beforeEach(() => {
  events = new Map(); position = 0; player = makePlayer(); create = vi.fn(async () => player);
  window.Kinescope = { IframePlayer: { create } };
  document.body.innerHTML = '<div id="fixture-player"></div>';
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
const options = { videoId: "fixture-video", containerId: "fixture-player" };
const ready = async () => waitFor(() => expect(events.has("ended")).toBe(true));

describe("current player behavior baseline (mock SDK, not browser DRM acceptance)", () => {
  it("preserves normal recording pause/play/end and forward/backward seeking", async () => {
    const onPause = vi.fn(), onPlay = vi.fn(), onEnded = vi.fn(), onTimeUpdate = vi.fn();
    const { result } = renderHook(() => useKinescopePlayer({ ...options, onPause, onPlay, onEnded, onTimeUpdate }));
    await ready();
    await act(async () => { await result.current.manualPlay(); events.get("play")?.(); });
    await act(async () => { events.get("pause")?.(); });
    expect(onPlay).toHaveBeenCalledOnce(); expect(onPause).toHaveBeenCalledOnce();
    for (const seconds of [300, 60]) {
      position = seconds;
      await act(async () => { await events.get("timeupdate")?.(); });
      expect(onTimeUpdate).toHaveBeenLastCalledWith(seconds, 600, seconds / 6);
    }
    expect(player.seekTo).not.toHaveBeenCalled();
    await act(async () => { events.get("ended")?.(); });
    expect(onEnded).toHaveBeenCalledOnce();
  });
  it("retains timecode seek and autoplay after readiness", async () => {
    const onSeekApplied = vi.fn(), onReady = vi.fn();
    renderHook(() => useKinescopePlayer({ ...options, autoplayTimecode: 240, onSeekApplied, onReady }));
    await waitFor(() => expect(onSeekApplied).toHaveBeenCalled());
    expect(onReady).toHaveBeenCalledOnce(); expect(player.seekTo).toHaveBeenCalledWith(240);
    expect(player.play).toHaveBeenCalledOnce();
  });
  it("does not recreate the player on a parent rerender with equivalent controls", async () => {
    const { rerender } = renderHook(({ query }) => useKinescopePlayer({ ...options, playerQuery: query }),
      { initialProps: { query: { controls: "true", speed: "true" } } });
    await ready(); position = 315;
    rerender({ query: { controls: "true", speed: "true" } });
    expect(create).toHaveBeenCalledOnce(); expect(player.destroy).not.toHaveBeenCalled(); expect(position).toBe(315);
  });
  it("preserves the explicit autoweb rewind restriction without applying it to recordings", async () => {
    renderHook(() => useKinescopePlayer({ ...options, preventRewind: true })); await ready();
    position = 300; await act(async () => { await events.get("timeupdate")?.(); });
    position = 60; await act(async () => { await events.get("timeupdate")?.(); });
    expect(player.seekTo).toHaveBeenLastCalledWith(300);
  });
  it("passes current player controls unchanged and does not print tokens even on SDK failure", async () => {
    const token = "synthetic-secret-for-log-test";
    create.mockRejectedValue(new Error(`fixture failure drmauthtoken=${token}`));
    const onError = vi.fn();
    renderHook(() => useKinescopePlayer({ ...options, onError,
      playerQuery: { drmauthtoken: token, controls: "true", speed: "true", pip: "true", subtitles: "true" } }));
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls) {
      const params = new URL(call[1].url).searchParams;
      expect(params.get("drmauthtoken")).toBe(token);
      for (const control of ["controls", "speed", "pip", "subtitles"]) expect(params.get(control)).toBe("true");
    }
    const logs = [console.info, console.warn, console.error].flatMap(log => vi.mocked(log).mock.calls.flat().map(String)).join("\n");
    expect(logs).not.toContain(token); expect(logs).not.toContain("kinescope.io/");
  });
  it("ignores late events and destroys player on navigation away", async () => {
    const onTimeUpdate = vi.fn();
    const { unmount } = renderHook(() => useKinescopePlayer({ ...options, onTimeUpdate })); await ready();
    unmount(); await events.get("timeupdate")?.();
    expect(player.destroy).toHaveBeenCalledOnce(); expect(onTimeUpdate).not.toHaveBeenCalled();
  });
});
