import { afterEach, describe, expect, it, vi } from "vitest";
import { createDrmPilotController, type PilotPermit, type PilotPlayer } from "./drmPilotController";

function setup() {
  vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000);
  const player: PilotPlayer = {
    setPlaylistItemOptions: vi.fn(async () => {}), getCurrentTime: vi.fn(async () => 195),
    getDuration: vi.fn(async () => 300), isPaused: vi.fn(async () => true), getPlaybackRate: vi.fn(async () => 1.5),
    getVideoQuality: vi.fn(async () => ({ height: 360 })), seekTo: vi.fn(async () => {}),
    pause: vi.fn(async () => {}), destroy: vi.fn(async () => {}), on: vi.fn(),
  };
  const fresh = (): PilotPermit => ({ token: "synthetic-signed-token", expiresAt: Date.now() / 1000 + 60,
    renewAfterSeconds: 36, mediaKey: "synthetic-vod", mediaType: "vod", playerId: "syntheticPlayer" });
  const getPermit = vi.fn(async () => fresh());
  const createPlayer = vi.fn(async () => player);
  const onStatus = vi.fn(), onRenewed = vi.fn();
  const controller = createDrmPilotController({ getPermit, createPlayer, onStatus, onRenewed });
  return { player, fresh, getPermit, createPlayer, onStatus, onRenewed, controller };
}
afterEach(() => { vi.useRealTimers(); });
describe("isolated DRM controller renewal and cleanup", () => {
  it("updates only the DRM token, preserving the same paused player and position", async () => {
    const s = setup(); await s.controller.refresh(); await s.controller.refresh();
    expect(s.createPlayer).toHaveBeenCalledTimes(1);
    expect(s.player.setPlaylistItemOptions).toHaveBeenCalledTimes(1);
    expect(s.player.seekTo).not.toHaveBeenCalled(); expect(s.player.pause).not.toHaveBeenCalled();
    expect(s.onRenewed).toHaveBeenCalledWith({ time: 195, paused: true, speed: 1.5, quality: { height: 360 } },
      { time: 195, paused: true, speed: 1.5, quality: { height: 360 } });
    await s.controller.close(); expect(s.player.destroy).toHaveBeenCalledTimes(1);
  });
  it("renews while paused, cancels old expiry and does not re-create the iframe", async () => {
    const s = setup(); await s.controller.refresh(); await vi.advanceTimersByTimeAsync(61000);
    expect(s.getPermit).toHaveBeenCalledTimes(2); expect(s.createPlayer).toHaveBeenCalledTimes(1);
    expect(s.player.pause).not.toHaveBeenCalled(); await s.controller.close();
  });
  it("coalesces simultaneous wake/manual/timer renewals into one request", async () => {
    const s = setup(); await s.controller.refresh();
    let resolve!: (p: PilotPermit) => void;
    s.getPermit.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const one = s.controller.refresh(), two = s.controller.refresh();
    expect(one).toBe(two); resolve(s.fresh()); await one;
    expect(s.getPermit).toHaveBeenCalledTimes(2); await s.controller.close();
  });
  it("pauses on expiry even when renewal hangs; no open iframe fallback", async () => {
    const s = setup(); await s.controller.refresh();
    s.getPermit.mockImplementationOnce(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(61000);
    expect(s.onStatus).toHaveBeenLastCalledWith("expired");
    expect(s.player.pause).toHaveBeenCalled(); expect(s.createPlayer).toHaveBeenCalledTimes(1);
    await s.controller.close();
  });
  it("rejects unexpected asset swaps and failed refresh without playing or seeking", async () => {
    const s = setup(); await s.controller.refresh();
    s.getPermit.mockResolvedValueOnce({ ...s.fresh(), playerId: "anotherPlayer" });
    await s.controller.refresh(); expect(s.onStatus).toHaveBeenLastCalledWith("denied");
    expect(s.player.setPlaylistItemOptions).not.toHaveBeenCalled(); expect(s.player.seekTo).not.toHaveBeenCalled();
    await s.controller.close();
  });
  it("does not resurrect a closed controller after a delayed initial permit", async () => {
    const s = setup(); let resolve!: (p: PilotPermit) => void;
    s.getPermit.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const request = s.controller.refresh(); await s.controller.close(); resolve(s.fresh()); await request;
    expect(s.createPlayer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120000); expect(s.getPermit).toHaveBeenCalledTimes(1);
  });
});
