import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptRunFlow } from "./PromptRunFlow";
import type { ChatScenario } from "@/hooks/useAiChat";

const bankStatementScenario: ChatScenario = {
  id: "bank-statement",
  launcher_title: "Анализ выписки",
  launcher_description: null,
  type: "file_analysis",
  input_hint: null,
  icon: null,
  launcher_order: 1,
  code: "bank_statement_analysis",
};

const actReconciliationScenario: ChatScenario = {
  id: "act-reconciliation",
  launcher_title: "Сверка актов",
  launcher_description: null,
  type: "file_analysis",
  input_hint: null,
  icon: null,
  launcher_order: 2,
  code: "act_reconciliation",
};

describe("PromptRunFlow bank statement guidance", () => {
  it("shows practical preparation requirements before a file is selected", () => {
    render(
      <PromptRunFlow
        scenario={bankStatementScenario}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Как подготовить выписку")).toBeInTheDocument();
    expect(screen.getByText(/до одного календарного месяца/)).toBeInTheDocument();
    expect(screen.getByText(/каждый — до 20 МБ/)).toBeInTheDocument();
    expect(screen.getByText(/суммарно до 5 страниц скана/)).toBeInTheDocument();
    expect(screen.getByText(/Файлы с паролем не поддерживаются/)).toBeInTheDocument();
  });

  it("rejects an oversized statement before analysis", () => {
    const { container } = render(
      <PromptRunFlow
        scenario={bankStatementScenario}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );
    const file = new File(["statement"], "statement.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Файл больше 20 МБ");
    expect(screen.getByRole("button", { name: "Анализировать" })).toBeDisabled();
  });

  it("shows only the formats accepted by the bank statement mode", () => {
    const { container } = render(
      <PromptRunFlow
        scenario={bankStatementScenario}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.getByText(/PDF, XLSX\/XLS, CSV, TXT, DOCX, JPG\/JPEG, PNG, WebP/)).toBeInTheDocument();
    const file = new File(["statement"], "statement.xml", { type: "application/xml" });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Не поддерживается формат: statement.xml");
  });

  it("rejects more than five files instead of silently truncating the selection", () => {
    const { container } = render(
      <PromptRunFlow
        scenario={bankStatementScenario}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );
    const files = Array.from({ length: 6 }, (_, index) => (
      new File([`statement-${index}`], `statement-${index}.csv`, { type: "text/csv" })
    ));

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("не более 5 файлов");
    expect(screen.getByRole("button", { name: "Анализировать" })).toBeDisabled();
  });
});

describe("PromptRunFlow act reconciliation guidance", () => {
  it("explains the required order and enables analysis only for two acts", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <PromptRunFlow
        scenario={actReconciliationScenario}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Как подготовить акты")).toBeInTheDocument();
    expect(screen.getByText(/Сначала загрузите акт вашей организации/)).toBeInTheDocument();
    expect(screen.getByText(/ровно два файла за одинаковый период/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Анализировать" })).toBeDisabled();

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["ours"], "ours.csv", { type: "text/csv" })] },
    });

    expect(screen.getByText(/1\. Ваш акт: ours\.csv/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Анализировать" })).toBeDisabled();

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["theirs"], "theirs.csv", { type: "text/csv" })] },
    });

    expect(screen.getByText(/2\. Акт контрагента: theirs\.csv/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Анализировать" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Анализировать" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("rejects a third act without removing the selected pair", () => {
    const { container } = render(
      <PromptRunFlow
        scenario={actReconciliationScenario}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );
    const input = container.querySelector('input[type="file"]')!;

    fireEvent.change(input, {
      target: {
        files: [
          new File(["ours"], "ours.csv", { type: "text/csv" }),
          new File(["theirs"], "theirs.csv", { type: "text/csv" }),
        ],
      },
    });
    fireEvent.change(input, {
      target: { files: [new File(["extra"], "extra.csv", { type: "text/csv" })] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("ровно два файла");
    expect(screen.getByText(/1\. Ваш акт: ours\.csv/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Акт контрагента: theirs\.csv/)).toBeInTheDocument();
  });
});
