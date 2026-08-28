export type LiveRoomState = 'closed' | 'opened' | 'live' | 'completed';
export type LiveRoomPhase = 'closed' | 'waiting' | 'live' | 'completed';

interface LiveRoomGateEvent {
  event_type?: string | null;
  room_state?: string | null;
  platform_status?: string | null;
  status?: string | null;
}

export function normalizeLiveRoomState(value: unknown): LiveRoomState {
  if (value === 'opened' || value === 'live' || value === 'completed') {
    return value;
  }
  return 'closed';
}

export function getLiveRoomPhase(roomState: LiveRoomState): LiveRoomPhase {
  switch (roomState) {
    case 'opened': return 'waiting';
    case 'live': return 'live';
    case 'completed': return 'completed';
    default: return 'closed';
  }
}

/**
 * A scheduled live stream must not expose the room until the explicit
 * open_room lifecycle transition. Terminal events stay outside this gate so
 * legacy replays are not accidentally hidden when an old row has no state.
 */
export function isClosedLiveRoom(event: LiveRoomGateEvent): boolean {
  if (event.event_type !== 'live_stream') return false;

  const terminal = event.platform_status === 'ended'
    || event.platform_status === 'archived'
    || event.status === 'ended';

  return !terminal && normalizeLiveRoomState(event.room_state) === 'closed';
}
