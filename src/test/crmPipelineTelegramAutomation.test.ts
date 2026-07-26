import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = `${process.cwd()}/`;
const sender = readFileSync(
  `${root}supabase/functions/telegram-send-notification/index.ts`,
  "utf8",
);
const worker = readFileSync(
  `${root}supabase/functions/crm-pipeline-automation-worker/index.ts`,
  "utf8",
);

describe("CRM pipeline Telegram automation guards", () => {
  it("keeps CRM messages service-only and bound to a running job", () => {
    expect(sender).toContain("'crm_pipeline_automation'");
    expect(sender).toContain("crm_pipeline_automation is service-only");
    expect(sender).toContain("automationJob?.status !== 'running'");
    expect(sender).toContain("automationRule?.action_type !== 'send_telegram'");
    expect(sender).toContain("automationDeal?.user_id !== user_id");
  });

  it("uses a job-scoped idempotency key and mirrors successful messages", () => {
    expect(sender).toContain("requestedIdempotencyKey !== `crm-pipeline:${jobId}`");
    expect(sender).toContain("(keyboard || isCrmAutomation)");
    expect(worker).toContain("const idempotencyKey = `crm-pipeline:${job.id}`");
    expect(worker).toContain('message_type: "crm_pipeline_automation"');
  });
});
