import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { handlePilotRequest, readPilotConfig, readPilotSecrets, type PilotDependencies } from "./core.ts";

export function servePilot(req: Request, kind: "token" | "callback") {
  const config = readPilotConfig(Deno.env.get("VIDEO_DRM_PILOT_CONFIG"));
  const secrets = readPilotSecrets(Deno.env.get("VIDEO_DRM_PILOT_SIGNING_KEY"),
    Deno.env.get("VIDEO_DRM_PILOT_PROVIDER_PASSWORD"));
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dependencies: PilotDependencies = {
    now: () => Math.floor(Date.now() / 1000),
    async authenticate(token, signal) {
      if (!url || !anon) return null;
      const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal }) } });
      const { data, error } = await client.auth.getClaims(token);
      const claims = data?.claims;
      if (error || !claims || claims.role !== "authenticated" || claims.iss !== `${url}/auth/v1` ||
        claims.aud !== "authenticated" || claims.is_anonymous === true ||
        typeof claims.sub !== "string" || typeof claims.session_id !== "string" || typeof claims.exp !== "number") return null;
      return { subject: claims.sub, sessionId: claims.session_id, authExpiresAt: claims.exp };
    },
    async canWatch(viewer, media, signal) {
      if (!url || !service || !config || !config.subjects.includes(viewer.subject) || !config.media.includes(media)) return false;
      const client = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal }) } });
      const { data, error } = await client.rpc("video_pilot_session_is_live", {
        _sid: viewer.sessionId, _uid: viewer.subject,
        _max_idle_seconds: config.sessionIdleSeconds, _max_age_seconds: config.sessionMaxAgeSeconds,
        _single_session: config.singleSessionPerUser,
      });
      return !error && data === true;
    },
  };
  return handlePilotRequest(req, kind, url && anon && service ? config : null, secrets, dependencies);
}
