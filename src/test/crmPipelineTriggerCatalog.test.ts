import { describe, expect, it } from "vitest";
import {
  CRM_AUTOMATION_TRIGGER_CATALOG,
} from "@/lib/crmAutomationTriggerCatalog";

describe("CRM pipeline trigger catalog", () => {
  it("exposes the current stage entry trigger as the only selectable v1 trigger", () => {
    const available = CRM_AUTOMATION_TRIGGER_CATALOG.filter(
      (trigger) => trigger.availability === "available",
    );
    expect(available).toEqual([
      expect.objectContaining({ id: "deal_entered_stage" }),
    ]);
  });

  it("documents the planned event and calendar trigger families", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG.map((trigger) => trigger.id)).toEqual(
      expect.arrayContaining([
        "deal_field_changed",
        "payment_received",
        "telegram_reply",
        "at_datetime",
        "after_event",
        "weekday",
        "month_day",
        "business_day",
      ]),
    );
  });
});
