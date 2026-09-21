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
});
