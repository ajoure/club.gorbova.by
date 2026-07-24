import { describe, expect, it } from "vitest";
import { generateOtpCode } from "../../supabase/functions/_shared/inline-otp-crypto.ts";
import { renderInlineOtpEmail } from "../../supabase/functions/_shared/inline-otp-email-template.ts";
import requestSource from "../../supabase/functions/request-inline-otp/index.ts?raw";
import verifySource from "../../supabase/functions/verify-inline-otp/index.ts?raw";
import formSource from "../components/auth/InlineEmailOtpForm.tsx?raw";

describe("inline OTP six-digit contract", () => {
  it("generates only six numeric characters, including leading zeroes", () => {
    for (let index = 0; index < 500; index += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("sends the same six-digit code in the branded HTML and text email", () => {
    const code = "012345";
    const email = renderInlineOtpEmail({ code, ttlMinutes: 10 });

    expect(email.subject).toContain(code);
    expect(email.text).toContain(code);
    expect(email.html).toContain(code);
    expect(email.html).toContain("Вход в Gorbova Club");
    expect(email.html).toContain("font-size:36px");
  });

  it("keeps generation, server validation, and the form constrained to six digits", () => {
    expect(requestSource).toContain("const code = generateOtpCode();");
    expect(requestSource).toContain("renderInlineOtpEmail({ code, ttlMinutes: TTL_MIN })");
    expect(verifySource).toContain('replace(/\\D/g, "").slice(0, 6)');
    expect(verifySource).toContain("if (code.length !== 6)");
    expect(formSource).toContain("maxLength={6}");
    expect(formSource).toContain("<InputOTPSlot index={5} />");
  });
});
