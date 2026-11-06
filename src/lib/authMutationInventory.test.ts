import { describe, expect, it } from "vitest";
import { inspectAuthSource, inspectRuntime } from "../../scripts/verify-auth-mutation-ingress.mjs";

describe("auth mutation ingress AST gate", () => {
  // Full-source AST scan needs an integration-test budget; the corpus cases keep the default timeout.
  it("gates every current runtime source file in the normal CI unit suite", () => {
    expect(inspectRuntime(process.cwd()).findings).toEqual([]);
  }, 30_000);
  it.each([
    "supabase.auth.signOut()",
    "supabase.auth['signOut']()",
    "supabase.auth[method]()",
    "const logout = supabase.auth.signOut; logout()",
    "const alias = supabase.auth; alias.signOut()",
    "const { signOut } = supabase.auth; signOut()",
    "supabase.auth.admin.signOut(token, 'local')",
    "import { createClient as other } from '@supabase/supabase-js'; other(url, key)",
    "import * as sdk from '@/integrations/supabase/client'; sdk.supabase.auth.signOut()",
    "const {supabase:sdk}=await import('@/integrations/supabase/client'); sdk.auth.signOut()",
    "(await import('@/integrations/supabase/client')).supabase.auth.signOut()",
    "import {supabase as sdk} from '@/integrations/supabase/client.ts'; sdk.auth.signOut()",
    "export {supabase as relay} from '@/integrations/supabase/client'",
    "const {supabase:sdk}=require('@/integrations/supabase/client'); sdk.auth.signOut()",
    "import sdk = require('@/integrations/supabase/client'); sdk.supabase.auth.signOut()",
  ])("rejects direct/computed/detached/escaped SDK mutation: %s", source => {
    expect(inspectAuthSource("src/example.ts", source).length).toBeGreaterThan(0);
  });
  it("permits normal explicit facade and read-only calls", () => {
    expect(inspectAuthSource("src/example.ts", "authMutations.signOut(); supabase.auth.getUser(); supabase.auth.onAuthStateChange(callback);")).toEqual([]);
    expect(inspectAuthSource("src/pages/self-development/QuestLesson.tsx", "(await import('@/integrations/supabase/client')).supabase.auth.getSession()")).toEqual([]);
    expect(inspectAuthSource("src/pages/self-development/QuestLesson.tsx", "const raw=(await import('@/integrations/supabase/client')).supabase; raw.auth.signOut()")).not.toEqual([]);
  });
  it("does not whitelist controller/client signOut by filename", () => {
    expect(inspectAuthSource("src/lib/adminReturn.ts", "supabase.auth.signOut({scope:'global'})")).not.toEqual([]);
  });
  it("only permits exact-local public admin revoke inside an actual lease wrapper", () => {
    expect(inspectAuthSource("src/lib/authMutationFacade.ts", "runOwnedAuthMutation(lease, () => auth.admin.signOut(jwt, 'local'))")).toEqual([]);
    expect(inspectAuthSource("src/lib/authMutationFacade.ts", "auth.admin.signOut(jwt, 'local')")).not.toEqual([]);
    expect(inspectAuthSource("src/lib/authMutationFacade.ts", "runOwnedAuthMutation(lease, () => auth.admin.signOut(jwt, 'global'))")).not.toEqual([]);
  });
  it("recognizes the imported SDK alias and rejects destructuring beside approved OAuth namespace", () => {
    expect(inspectAuthSource("src/example.ts", "import {supabase as sdk} from '@/integrations/supabase/client'; sdk.auth.signOut()")).not.toEqual([]);
    const header = "type OAuthNs = {getAuthorizationDetails:()=>void; approveAuthorization:()=>void; denyAuthorization:()=>void};";
    const getter = "function getOAuth(): OAuthNs { const authAny = (supabase.auth as unknown as {oauth?:OAuthNs}); return authAny.oauth; }";
    expect(inspectAuthSource("src/pages/OAuthConsent.tsx", header + getter)).toEqual([]);
    for (const extra of ["supabase.auth.signOut()", "const a = supabase.auth; a.signOut()", "const {signOut}=supabase.auth;signOut()", "getOAuth()['signOut']()", "getOAuth()['sign'+'Out']()", "const ns=getOAuth(); ns[method]()"])
      expect(inspectAuthSource("src/pages/OAuthConsent.tsx", header + getter + extra)).not.toEqual([]);
    expect(inspectAuthSource("src/pages/OAuthConsent.tsx", header + "function getOAuth(): OAuthNs { const stolen = supabase.auth; return stolen; }")).not.toEqual([]);
  });
});
