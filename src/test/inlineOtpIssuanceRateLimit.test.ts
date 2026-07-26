import { describe, expect, it } from "vitest";
import requestSource from "../../supabase/functions/request-inline-otp/index.ts?raw";
import migrationSource from "../../supabase/migrations/20260723121505_harden_inline_otp_issuance_rate_limits.sql?raw";

describe("inline OTP issuance rate limits", () => {
  it("moves rate-limit reservation into one database RPC", () => {
    expect(requestSource).toContain('"issue_inline_otp_code"');
    expect(requestSource).toContain("p_ttl_seconds: TTL_MIN * 60");
    expect(requestSource).not.toContain('.from("inline_otp_codes").insert(');
    expect(requestSource).not.toContain("emailHourCount");
    expect(requestSource).not.toContain("ipHourCount");
  });

  it("serializes the e-mail and IP checks without granting a public RPC", () => {
    expect(migrationSource).toContain("pg_advisory_xact_lock");
    expect(migrationSource).toContain("'inline_otp:email:' || p_email");
    expect(migrationSource).toContain("'inline_otp:ip:' || p_ip");
    expect(migrationSource).toContain("WHERE ip = p_ip::inet");
    expect(migrationSource).toContain("p_meta, p_ip::inet,");
    expect(migrationSource).toContain("UPDATE public.inline_otp_codes");
    expect(migrationSource).toContain("INSERT INTO public.inline_otp_codes");
    expect(migrationSource).toContain("SECURITY INVOKER");
    expect(migrationSource).toContain("SET search_path = ''");
    expect(migrationSource).toContain("REVOKE EXECUTE ON FUNCTION public.issue_inline_otp_code");
    expect(migrationSource).toContain("TO service_role;");
  });
});
