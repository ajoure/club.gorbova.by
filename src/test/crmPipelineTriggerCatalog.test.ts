import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

describe("CRM pipeline trigger catalog", () => {
  it("exposes only triggers that have a database event contract and worker support", () => {
    const available = CRM_AUTOMATION_TRIGGER_CATALOG.filter(
      (trigger) => trigger.availability === "available",
    );
    expect(available).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deal_entered_stage" }),
        expect.objectContaining({ id: "deal_left_stage" }),
        expect.objectContaining({ id: "deal_created" }),
        expect.objectContaining({ id: "payment_received" }),
        expect.objectContaining({ id: "deal_field_changed" }),
        expect.objectContaining({ id: "at_datetime", requiresSchedule: true }),
        expect.objectContaining({ id: "after_event", requiresSchedule: true }),
        expect.objectContaining({ id: "weekday", requiresSchedule: true }),
        expect.objectContaining({ id: "month_day", requiresSchedule: true }),
      ]),
    );
    expect(available).toHaveLength(9);
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
