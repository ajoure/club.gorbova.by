import { describe, it, expect } from "vitest";
import {
  localizeAuditAction,
  localizePaymentStatus,
  localizeAccessStatus,
  localizeCrmStatus,
  localizeReasonCode,
  localizeEntityType,
} from "../crmDisplayLabels";

describe("crmDisplayLabels", () => {
  it("localizes known audit actions", () => {
    expect(localizeAuditAction("crm.deal.stage_reassigned")).toBe("Стадия сделки изменена");
    expect(localizeAuditAction("crm_stage_applied_success")).toBe("Сделка перемещена в успешную стадию");
    expect(localizeAuditAction("crm_stage_applied_failed")).toBe("Сделка перемещена в стадию отказа");
    expect(localizeAuditAction("crm_stage_apply_skipped_manual_override")).toBe(
      "Автоматическое перемещение сделки пропущено",
    );
  });

  it("never leaks raw dotted or snake_case codes for unknown audit actions", () => {
    const samples = [
      "some.unknown.event",
      "totally_unknown_snake_case",
      "PATH_UNKNOWN.state",
      "provider.internal.foo_bar",
    ];
    for (const s of samples) {
      const label = localizeAuditAction(s);
      expect(label).not.toContain(".");
      expect(label).not.toContain("_");
      expect(label).not.toMatch(/[a-z]{4,}/i);
    }
  });

  it("localizes payment statuses including edge cases", () => {
    expect(localizePaymentStatus("paid")).toBe("Оплачено");
    expect(localizePaymentStatus("succeeded")).toBe("Оплачено");
    expect(localizePaymentStatus("failed")).toBe("Оплата не прошла");
    expect(localizePaymentStatus("canceled")).toBe("Отменено");
    expect(localizePaymentStatus("cancelled")).toBe("Отменено");
    expect(localizePaymentStatus("expired")).toBe("Истёк");
    expect(localizePaymentStatus("stale")).toBe("Требует проверки");
    expect(localizePaymentStatus("refunded")).toBe("Возврат");
    expect(localizePaymentStatus("")).toBe("Неизвестный статус");
    expect(localizePaymentStatus("random_zzz")).toBe("Неизвестный статус");
  });

  it("localizes access statuses", () => {
    expect(localizeAccessStatus("active")).toBe("Активен");
    expect(localizeAccessStatus("expired")).toBe("Доступ истёк");
    expect(localizeAccessStatus("revoked")).toBe("Отозван");
    expect(localizeAccessStatus("stale")).toBe("Требует проверки");
    expect(localizeAccessStatus("unknown_xxx")).toBe("Неизвестный статус");
  });

  it("localizes CRM statuses", () => {
    expect(localizeCrmStatus("closed_won")).toBe("Успешно");
    expect(localizeCrmStatus("closed_lost")).toBe("Отказ");
    expect(localizeCrmStatus("in_progress")).toBe("В работе");
  });

  it("localizes reason codes", () => {
    expect(localizeReasonCode("manual_stage_change")).toBe("изменена вручную");
    expect(localizeReasonCode("no_snapshot")).toBe("нет закреплённой маршрутизации");
    expect(localizeReasonCode("something_unknown_xxx")).toBe("штатная причина");
  });

  it("localizes entity types", () => {
    expect(localizeEntityType("orders_v2")).toBe("Сделка");
    expect(localizeEntityType("profile")).toBe("Клиент");
    expect(localizeEntityType("unknown")).toBe("");
  });
});
