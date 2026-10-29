// Only used by the isolated pilot page, never by production video consumers.
export interface PilotPermit {
  token: string;
  expiresAt: number;
  renewAfterSeconds: number;
  mediaKey: string;
  mediaType: "vod" | "live";
  playerId: string;
}
export interface PilotPlayer {
  setPlaylistItemOptions(options: { drm: { auth: { token: string } } }): Promise<void>;
  getCurrentTime(): Promise<number>;
  getDuration(): Promise<number>;
  isPaused(): Promise<boolean>;
  getPlaybackRate(): Promise<number>;
  getVideoQuality(): Promise<unknown>;
  seekTo(seconds: number): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void> | void;
  on(event: string, callback: (event: { data?: { currentTime?: number } }) => void): void;
}
export interface PilotSnapshot { time: number; paused: boolean; speed: number; quality: unknown }
interface Options {
  getPermit: () => Promise<PilotPermit>;
  createPlayer: (permit: PilotPermit) => Promise<PilotPlayer>;
  onStatus: (status: "loading" | "ready" | "renewing" | "denied" | "expired" | "closed") => void;
  onRenewed?: (before: PilotSnapshot, after: PilotSnapshot) => void;
  now?: () => number;
}

export function createDrmPilotController(options: Options) {
  const now = options.now ?? Date.now;
  let player: PilotPlayer | undefined;
  let identity: string | undefined;
  let closed = false;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let deadline = 0;
  let generation = 0;
  const snapshot = async (p: PilotPlayer): Promise<PilotSnapshot> => {
    const [time, paused, speed, quality] = await Promise.all([
      p.getCurrentTime(), p.isPaused(), p.getPlaybackRate(), p.getVideoQuality(),
    ]);
    return { time, paused, speed, quality };
  };
  function validate(p: PilotPermit) {
    if (!p || typeof p.token !== "string" || !p.token || p.token.length > 8192 ||
      !Number.isSafeInteger(p.expiresAt) || p.expiresAt * 1000 <= now() ||
      p.expiresAt * 1000 - now() > 301000 || !Number.isFinite(p.renewAfterSeconds) || p.renewAfterSeconds <= 0 ||
      p.renewAfterSeconds * 1000 >= p.expiresAt * 1000 - now() ||
      typeof p.mediaKey !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(p.mediaKey) ||
      typeof p.playerId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(p.playerId) ||
      (p.mediaType !== "vod" && p.mediaType !== "live")) throw new Error("pilot_denied");
    const next = `${p.mediaKey}:${p.mediaType}:${p.playerId}`;
    if (identity && identity !== next) throw new Error("pilot_media_changed");
    return next;
  }
  async function deny(status: "expired" | "denied") {
    if (closed) return;
    options.onStatus(status);
    try { await player?.pause(); } catch { /* no exception payload logging */ }
  }
  function schedule(p: PilotPermit) {
    clearTimeout(renewal); clearTimeout(expiry);
    deadline = p.expiresAt * 1000;
    const expectedGeneration = ++generation;
    renewal = setTimeout(() => { void refresh(); }, p.renewAfterSeconds * 1000);
    expiry = setTimeout(() => {
      if (generation === expectedGeneration) void deny("expired");
    }, Math.max(0, deadline - now()));
  }
  async function update() {
    if (closed) return;
    options.onStatus(player ? "renewing" : "loading");
    try {
      const permit = await options.getPermit();
      if (closed) return;
      const nextIdentity = validate(permit);
      if (!player) {
        const created = await options.createPlayer(permit);
        if (closed) { await created.destroy(); return; }
        player = created;
        identity = nextIdentity;
      } else {
        const before = await snapshot(player);
        if (closed) return;
        await player.setPlaylistItemOptions({ drm: { auth: { token: permit.token } } });
        if (closed) return;
        const after = await snapshot(player);
        if (closed) return;
        options.onRenewed?.(before, after);
      }
      if (closed) return;
      // A slow provider update cannot extend an expired permit.
      validate(permit);
      schedule(permit);
      options.onStatus("ready");
    } catch {
      // No iframe fallback, direct URL, token, or raw provider error is exposed.
      await deny(deadline && deadline <= now() ? "expired" : "denied");
    }
  }
  function refresh(): Promise<void> {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    pending = update().finally(() => { pending = undefined; });
    return pending;
  }
  return {
    refresh,
    getPlayer: () => player,
    async close() {
      if (closed) return;
      closed = true; ++generation;
      clearTimeout(renewal); clearTimeout(expiry);
      try { await player?.destroy(); } catch { /* no token-bearing exceptions */ }
      options.onStatus("closed");
    },
  };
}
