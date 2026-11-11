import { servePilot } from "../video-pilot-token/runtime.ts";
Deno.serve((request: Request) => servePilot(request, "callback"));
