import { servePilot } from "./runtime.ts";
Deno.serve((request: Request) => servePilot(request, "token"));
