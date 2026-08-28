import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getLiveRoomPhase,
  isClosedLiveRoom,
  normalizeLiveRoomState,
} from '../../supabase/functions/_shared/live-room-gate.ts';

describe('closed live room gate', () => {
  it('fails closed for missing or invalid room state on a non-terminal live stream', () => {
    expect(isClosedLiveRoom({ event_type: 'live_stream', room_state: null, platform_status: 'scheduled' })).toBe(true);
    expect(isClosedLiveRoom({ event_type: 'live_stream', room_state: 'unexpected', platform_status: 'draft' })).toBe(true);
    expect(normalizeLiveRoomState('unexpected')).toBe('closed');
  });

  it('allows entry only after the room lifecycle has advanced', () => {
    expect(isClosedLiveRoom({ event_type: 'live_stream', room_state: 'opened' })).toBe(false);
    expect(isClosedLiveRoom({ event_type: 'live_stream', room_state: 'live' })).toBe(false);
    expect(getLiveRoomPhase('opened')).toBe('waiting');
  });

  it('does not hide recorded content or legacy terminal replays', () => {
    expect(isClosedLiveRoom({ event_type: 'recorded_webinar', room_state: 'closed' })).toBe(false);
    expect(isClosedLiveRoom({ event_type: 'live_stream', room_state: 'closed', status: 'ended' })).toBe(false);
    expect(isClosedLiveRoom({ event_type: 'live_stream', room_state: 'closed', platform_status: 'archived' })).toBe(false);
  });
});

describe('closed room integration contract', () => {
  it('guards resolver payload, client rendering and soft-join session creation', () => {
    const resolver = readFileSync('supabase/functions/live-resolve/index.ts', 'utf8');
    const heartbeat = readFileSync('supabase/functions/live-session-heartbeat/index.ts', 'utf8');
    const page = readFileSync('src/pages/LiveEvent.tsx', 'utf8');

    expect(resolver).toContain("status: 'room_closed'");
    expect(resolver).toContain('if (isClosedLiveRoom(event))');
    expect(heartbeat).toContain('if (isClosedLiveRoom(event))');
    expect(heartbeat).toContain("return jsonResponse({ status: 'room_closed' }, 403)");
    expect(page).toContain('case "room_closed"');
    expect(page).toContain('json.event_type === "live_stream" && roomPhase === "closed"');
  });
});
