import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import whoamiTool from "./tools/whoami";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "gorbova-mcp",
  title: "Gorbova Club MCP",
  version: "0.1.0",
  instructions:
    "MCP server for the Gorbova Club app. Use `echo` to verify connectivity and `whoami` to check the signed-in user identity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [echoTool, whoamiTool],
});
