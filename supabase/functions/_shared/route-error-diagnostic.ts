// Allowlisted diagnostics only: no raw messages, URLs, record IDs or user agents.
const kinds = ["chunk", "render"] as const;
const reasons = ["chunk_load", "update_depth", "hook_order", "invalid_child", "invalid_date", "invalid_currency", "unknown"] as const;
const recoveries = ["not_applicable", "manual"] as const;
const names = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "ChunkLoadError", "Unknown"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FRAME = /^\/assets\/[A-Za-z0-9_-]{1,100}\.m?js(?::\d{1,7}:\d{1,7})?$/;
export interface RouteErrorDiagnostic {
  version: 1; id: string; at: string; route: "/admin/deals" | "other";
  view: "board" | "list" | "other"; build: string;
  kind: typeof kinds[number]; reason: typeof reasons[number]; recovery: typeof recoveries[number];
  error_name: typeof names[number]; react_code: number | null; frames: string[]; online: boolean;
  test_marker: "synthetic-preflight" | null;
}
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  return e?.name === "ChunkLoadError" || ["failed to fetch dynamically imported module", "importing a module script failed", "error loading dynamically imported module", "loading chunk", "unable to preload css"].some(text => message.includes(text));
}
export function makeRouteErrorDiagnostic(error: unknown, context: {
  id: string; at: string; pathname: string; search: string; build: string; online: boolean;
}): RouteErrorDiagnostic {
  const e = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : "";
  const stack = typeof e?.stack === "string" ? e.stack : "";
  const chunk = isChunkLoadError(error);
  const route = context.pathname === "/admin/deals" ? "/admin/deals" : "other";
  const view = new URLSearchParams(context.search).get("view");
  const reason = chunk ? "chunk_load" : /maximum update depth/i.test(message) ? "update_depth"
    : /rendered (more|fewer) hooks|order of hooks/i.test(message) ? "hook_order"
    : /objects are not valid as a react child/i.test(message) ? "invalid_child"
    : /invalid time value/i.test(message) ? "invalid_date"
    : /invalid currency code/i.test(message) ? "invalid_currency" : "unknown";
  const frames = [...new Set((stack + "\n" + message).match(/\/assets\/[A-Za-z0-9_-]{1,100}\.m?js(?::\d{1,7}:\d{1,7})?/g) ?? [])].slice(0, 8);
  return { version: 1, id: context.id, at: context.at, route,
    view: route === "other" ? "other" : view === "board" ? "board" : "list",
    build: ISO.test(context.build) ? context.build : "unknown",
    kind: chunk ? "chunk" : "render", reason, recovery: "not_applicable",
    error_name: names.includes(e?.name as typeof names[number]) ? e!.name as typeof names[number] : "Unknown",
    react_code: Number(message.match(/Minified React error #(\d{1,4})/)?.[1]) || null,
    frames, online: context.online, test_marker: null };
}
export function validRouteErrorDiagnostic(value: unknown): value is RouteErrorDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ["version", "id", "at", "route", "view", "build", "kind", "reason", "recovery", "error_name", "react_code", "frames", "online", "test_marker"];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) return false;
  return v.version === 1 && typeof v.id === "string" && UUID.test(v.id)
    && typeof v.at === "string" && ISO.test(v.at) && Number.isFinite(Date.parse(v.at))
    && v.route === "/admin/deals" && ["board", "list"].includes(v.view as string)
    && typeof v.build === "string" && (v.build === "unknown" || ISO.test(v.build))
    && kinds.includes(v.kind as typeof kinds[number]) && reasons.includes(v.reason as typeof reasons[number])
    && recoveries.includes(v.recovery as typeof recoveries[number]) && names.includes(v.error_name as typeof names[number])
    && (v.react_code === null || (Number.isInteger(v.react_code) && Number(v.react_code) > 0 && Number(v.react_code) < 10000))
    && Array.isArray(v.frames) && v.frames.length <= 8 && v.frames.every(f => typeof f === "string" && FRAME.test(f))
    && typeof v.online === "boolean" && (v.test_marker === null || v.test_marker === "synthetic-preflight");
}
