import { createClient } from "npm:@supabase/supabase-js@2";

const TRANSPARENT_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="),
  (character) => character.charCodeAt(0),
);

function isLikelyMachine(userAgent: string): boolean {
  return /(bot|crawler|spider|scanner|preview|prefetch|headless|googleimageproxy|facebookexternalhit|slackbot|discordbot|whatsapp)/i.test(
    userAgent,
  );
}

function safeRefererHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.slice(0, 200);
  } catch {
    return null;
  }
}

function parsePath(url: URL): { kind: "open" | "click"; token: string } | null {
  const segments = url.pathname.split("/").filter(Boolean);
  const markerIndex = segments.lastIndexOf("broadcast-track");
  if (markerIndex < 0 || segments.length < markerIndex + 3) return null;
  const kind = segments[markerIndex + 1];
  const rawToken = segments[markerIndex + 2].replace(/\.gif$/i, "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawToken)) {
    return null;
  }
  if (kind === "o") return { kind: "open", token: rawToken };
  if (kind === "c") return { kind: "click", token: rawToken };
  return null;
}

function pixelResponse(status = 200): Response {
  return new Response(TRANSPARENT_GIF, {
    status,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.byteLength),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const parsed = parsePath(new URL(request.url));
  if (!parsed) return pixelResponse(404);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return pixelResponse(503);

  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 500);
  // Link scanners commonly probe with HEAD and do not represent a person
  // opening the message. Never promote such a probe to a human click.
  const machine = request.method === "HEAD" || isLikelyMachine(userAgent);
  const eventType = parsed.kind === "open" ? "open_signal" : "click";
  const eventKey = `tracking:${eventType}:${parsed.token}:${crypto.randomUUID()}`;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("analytics_record_tracking_event", {
    _token: parsed.token,
    _event_type: eventType,
    _event_key: eventKey,
    _is_machine: machine,
    _metadata: {
      referer_host: safeRefererHost(request.headers.get("referer")),
    },
  });

  if (parsed.kind === "open") return pixelResponse(error ? 503 : 200);

  const result = (data ?? {}) as { ok?: boolean; url?: string | null };
  if (error || !result.ok || !result.url) {
    return new Response("Ссылка недоступна", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  try {
    const target = new URL(result.url);
    if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("unsafe protocol");
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Некорректная ссылка", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
});
