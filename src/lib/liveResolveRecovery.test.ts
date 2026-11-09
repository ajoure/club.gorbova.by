import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveResolveRecovery, liveResolveState } from "./liveResolveRecovery";

afterEach(() => vi.useRealTimers());

describe("live room response states", () => {
  it("shows an ended room for an unavailable old replay instead of a page crash", () => {
    expect(liveResolveState({ status: "replay_disabled", event_status: "ended", replay_enabled: false })).toBe("ended_no_replay");
  });
  it("keeps expired login distinct from expired viewing and paid-access denial", () => {
    expect(liveResolveState({ status: "auth_required" })).toBe("auth_required");
    expect(liveResolveState({ status: "session_missing" })).toBe("session_expired");
    expect(liveResolveState({ status: "access_denied" })).toBe("access_denied");
  });
  it("never renders a player in a closed or waiting live room", () => {
    expect(liveResolveState({ status: "ok", event_type: "live_stream", room_phase: "closed" })).toBe("scheduled");
    expect(liveResolveState({ status: "ok", room_phase: "waiting" })).toBe("room_open_waiting");
    expect(liveResolveState({ status: "room_closed" })).toBe("scheduled");
  });
  it("keeps live and recorded replay playback available under existing rules", () => {
    expect(liveResolveState({ status: "ok", event_status: "live", room_phase: "live" })).toBe("live");
    expect(liveResolveState({ status: "ok", event_status: "ended", replay_enabled: true })).toBe("live");
    expect(liveResolveState({ status: "ok", resolved_source: { resolved_source_kind: "live_pending" } })).toBe("live_pending");
  });
});

describe("failed room request recovery", () => {
  it("recovers a failed request and cancels the retry series after success", async () => {
    vi.useFakeTimers();
    const fetchRoom = vi.fn().mockRejectedValueOnce(new TypeError("network unavailable")).mockResolvedValue({ status: "ok", event_status: "live" });
    let state = "loading";
    const recovery = createLiveResolveRecovery(() => { void request(); });
    async function request() {
      try { state = liveResolveState(await fetchRoom()); recovery.reset(); }
      catch { state = "error"; recovery.fail(); }
    }
    await request();
    expect(state).toBe("error");
    await vi.advanceTimersByTimeAsync(1000);
    expect(state).toBe("live");
    recovery.wake();
    await vi.runAllTimersAsync();
    expect(fetchRoom).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });
  it("bounds automatic retries and allows a new attempt when the device returns online", async () => {
    vi.useFakeTimers();
    const retry = vi.fn(() => recovery.fail());
    const recovery = createLiveResolveRecovery(retry);
    recovery.fail(); recovery.fail();
    await vi.advanceTimersByTimeAsync(1000 + 3000 + 8000 + 60000);
    expect(retry).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    recovery.wake();
    expect(retry).toHaveBeenCalledTimes(4);
    recovery.dispose();
    await vi.runAllTimersAsync();
    expect(retry).toHaveBeenCalledTimes(4);
  });
  it("cancels queued work on navigation and ignores later wake events", async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const recovery = createLiveResolveRecovery(retry);
    recovery.fail(); recovery.dispose(); recovery.wake(); recovery.fail();
    await vi.runAllTimersAsync();
    expect(retry).not.toHaveBeenCalled();
  });
});
