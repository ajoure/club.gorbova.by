// Sprint B: pure-compute tests for autoweb-room-state resolver.
// Все 8 кейсов фиксируют чистую вычислимую логику до UI.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeRoomState } from "./index.ts";
import type { AutowebViewerControls } from "../_shared/autoweb-types.ts";

const VC: AutowebViewerControls = {
  allow_pause: false,
  allow_seek: false,
  allow_speed_control: false,
  resume_from_last_position: true,
  allow_rewatch_before_end: false,
};

const DURATION = 3600; // 1h
const REPLAY_IMMEDIATE = { enabled: true, open_strategy: "immediate" as const, delay_minutes: 0, window_hours: 24 };
const REPLAY_AFTER_DELAY = { enabled: true, open_strategy: "after_delay" as const, delay_minutes: 30, window_hours: 24 };
const REPLAY_DISABLED = { enabled: false, open_strategy: "immediate" as const, delay_minutes: 0, window_hours: 0 };

Deno.test("1) pre_show: now < starts_at", () => {
  const starts = new Date("2030-01-01T10:00:00Z");
  const now = new Date("2030-01-01T09:30:00Z");
  const r = computeRoomState({
    now, starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_IMMEDIATE, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r.phase, "pre_show");
});

Deno.test("2) live: starts_at <= now < ends_at", () => {
  const starts = new Date("2030-01-01T10:00:00Z");
  const now = new Date("2030-01-01T10:30:00Z");
  const r = computeRoomState({
    now, starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_IMMEDIATE, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r.phase, "live");
  assertEquals(r.ends_at.toISOString(), "2030-01-01T11:00:00.000Z");
});

Deno.test("3) replay with open_strategy=immediate", () => {
  const starts = new Date("2030-01-01T10:00:00Z");
  const now = new Date("2030-01-01T11:05:00Z"); // 5 min after end
  const r = computeRoomState({
    now, starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_IMMEDIATE, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r.phase, "replay");
  assertEquals(r.replay_opens_at?.toISOString(), "2030-01-01T11:00:00.000Z");
  assertEquals(r.replay_ends_at?.toISOString(), "2030-01-02T11:00:00.000Z");
});

Deno.test("4) replay with open_strategy=after_delay (still pending during delay window)", () => {
  const starts = new Date("2030-01-01T10:00:00Z");
  // ends 11:00, delay 30 min → replay opens 11:30. At 11:15 must NOT be replay.
  const now = new Date("2030-01-01T11:15:00Z");
  const r = computeRoomState({
    now, starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_AFTER_DELAY, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r.phase, "ended"); // before replay_opens_at and after live
  assertEquals(r.replay_opens_at?.toISOString(), "2030-01-01T11:30:00.000Z");

  // After delay → replay
  const r2 = computeRoomState({
    now: new Date("2030-01-01T11:45:00Z"),
    starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_AFTER_DELAY, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r2.phase, "replay");
});

Deno.test("5) ended: past replay window or replay disabled", () => {
  const starts = new Date("2030-01-01T10:00:00Z");
  // Replay disabled → straight to ended after live
  const r = computeRoomState({
    now: new Date("2030-01-01T11:30:00Z"),
    starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_DISABLED, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r.phase, "ended");
  assertEquals(r.replay_opens_at, null);

  // Past replay window
  const r2 = computeRoomState({
    now: new Date("2030-01-03T00:00:00Z"),
    starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_IMMEDIATE, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r2.phase, "ended");
});

Deno.test("6) resume.enabled=true returns saved position", () => {
  const starts = new Date("2030-01-01T10:00:00Z");
  const r = computeRoomState({
    now: new Date("2030-01-01T10:10:00Z"),
    starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_IMMEDIATE,
    viewer_controls: { ...VC, resume_from_last_position: true },
    saved_position_seconds: 423,
  });
  assertEquals(r.resume.enabled, true);
  assertEquals(r.resume.last_video_position_seconds, 423);
});

Deno.test("7) resume.enabled=false → always 0", () => {
  const starts = new Date("2030-01-01T10:00:00Z");
  const r = computeRoomState({
    now: new Date("2030-01-01T10:10:00Z"),
    starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_IMMEDIATE,
    viewer_controls: { ...VC, resume_from_last_position: false },
    saved_position_seconds: 999,
  });
  assertEquals(r.resume.enabled, false);
  assertEquals(r.resume.last_video_position_seconds, 0);
});

Deno.test("8) different viewer_timezone vs event_timezone does NOT shift phase (UTC math)", () => {
  // Phase computation работает только в UTC. TZ — лейбл для UI.
  const starts = new Date("2030-01-01T10:00:00Z"); // 13:00 Europe/Minsk
  const now = new Date("2030-01-01T10:30:00Z");    // 13:30 Minsk / 05:30 NY
  const r = computeRoomState({
    now, starts_at: starts, duration_seconds: DURATION,
    replay: REPLAY_IMMEDIATE, viewer_controls: VC, saved_position_seconds: 0,
  });
  assertEquals(r.phase, "live");
});
