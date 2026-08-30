import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("invoice-act service execution term wording", () => {
  const htmlInvoiceAct = read("supabase/functions/generate-invoice-act/index.ts");
  const pdfFallback = read("supabase/functions/generate-document-pdf/index.ts");
  const registryMigration = read("supabase/migrations/20260730095142_invoice_act_execution_calendar_days.sql");
  const docxXml = execFileSync(
    "unzip",
    ["-p", "supabase/functions/generate-document-pdf/template.docx", "word/document.xml"],
    { encoding: "utf8" },
  );

  it("uses calendar days for service execution in both legacy renderers", () => {
    for (const source of [htmlInvoiceAct, pdfFallback]) {
      expect(source).toContain("дней с даты перечисления предоплаты Заказчиком.");
      expect(source).not.toContain("рабочих дней с даты перечисления предоплаты Заказчиком.");
    }
  });

  it("does not change the separate payment-term wording", () => {
    expect(htmlInvoiceAct).toContain("Срок оплаты: 3 (три) рабочих дня");
    expect(pdfFallback).toContain("Срок оплаты: ${data.paymentTerm} (${numberToWordsRu(data.paymentTerm)}) рабочих дня");
  });

  it("keeps the versioned DOCX template on calendar days", () => {
    const text = docxXml.replace(/<[^>]+>/g, "");
    expect(text).toContain("Срок оказания услуг:");
    expect(text).toMatch(/Срок оказания услуг:[\s\S]{0,400}\) дней с даты перечисления предоплаты Заказчиком\./);
    expect(text).not.toMatch(/Срок оказания услуг:[\s\S]{0,400}\) рабочих дней с даты перечисления предоплаты Заказчиком\./);
    expect(text).toContain("рабочих дня");
  });

  it("labels the canonical service-term setting in calendar days", () => {
    expect(registryMigration).toContain("'Срок оказания услуг (дней)'");
    expect(registryMigration).toContain("token_key = 'document.execution_days'");
  });
});
