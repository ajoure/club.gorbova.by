import { describe, expect, it } from "vitest";
import verifierSource from "../../supabase/functions/verify-inline-otp/index.ts?raw";
import migrationSource from "../../supabase/migrations/20260723114500_harden_inline_otp_attempt_consumption.sql?raw";

describe("inline OTP atomic consumption", () => {
  it("moves comparison and state updates into one serialized RPC", () => {
    expect(verifierSource).toContain('"consume_inline_otp_attempt"');
    expect(verifierSource).toContain("p_max_attempts: MAX_ATTEMPTS");
    expect(verifierSource).not.toContain(".update({ attempts:");
    expect(verifierSource).not.toContain("mark used failed");
  });

  it("locks the code row and exposes the privileged RPC only to service_role", () => {
    expect(migrationSource).toContain("FOR UPDATE;");
    expect(migrationSource).toContain("SECURITY DEFINER");
    expect(migrationSource).toContain("SET search_path = ''");
    expect(migrationSource).toContain("REVOKE EXECUTE ON FUNCTION public.consume_inline_otp_attempt(uuid, text, integer) FROM PUBLIC;");
    expect(migrationSource).toContain("GRANT EXECUTE ON FUNCTION public.consume_inline_otp_attempt(uuid, text, integer) TO service_role;");
  });
});
