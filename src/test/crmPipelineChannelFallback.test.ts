import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(
  "supabase/functions/crm-pipeline-automation-worker/index.ts",
  "utf8",
);
const telegramSender = readFileSync(
  "supabase/functions/telegram-send-notification/index.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260723105137_crm_pipeline_automation_channel_fallback_v6.sql",
  "utf8",
);

describe("CRM channel fallback", () => {
  it("runs the fallback only on the final primary attempt", () => {
    expect(worker).toContain("job.attempt_count >= 5");
    expect(worker).toContain('fallbackRule.fallback_action_type === "send_email"');
    expect(worker).toContain('fallbackRule.fallback_action_type === "send_telegram"');
    expect(worker).toContain("fallback_used: true");
  });

  it("keeps fallback Telegram behind the canonical sender guard", () => {
    expect(telegramSender).toContain("automationContext?.fallback === true");
    expect(telegramSender).toContain("automationJob.attempt_count < 5");
    expect(telegramSender).toContain(
      "automationRule?.fallback_action_type !== 'send_telegram'",
    );
  });

  it("allows only the opposite messaging channel", () => {
    expect(migration).toContain("fallback_action_type <> action_type");
    expect(migration).toContain("action_type IN ('send_email','send_telegram')");
    expect(migration).toContain("automation_fallback_email_template_not_active");
  });
});
