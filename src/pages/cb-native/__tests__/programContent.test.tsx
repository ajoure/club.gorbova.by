import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PROGRAM_MODULE_COUNT, ProgramSection } from "../sections/ProgramSection";

describe("CbNative programme fidelity", () => {
  it("renders a non-empty result panel for every numbered module", () => {
    const { container } = render(<ProgramSection onCta={() => undefined} />);
    const resultPanels = [
      ...container.querySelectorAll<HTMLElement>("[data-cb-native-program-results]"),
    ];

    expect(PROGRAM_MODULE_COUNT).toBe(26);
    expect(resultPanels).toHaveLength(25);

    for (const panel of resultPanels) {
      const copy = panel.textContent?.replace("Результаты модуля:", "").trim();
      expect(copy, panel.dataset.cbNativeProgramResults).toBeTruthy();
    }
  });

  it("preserves result copy that follows visual badges in the Tilda export", () => {
    const { container } = render(<ProgramSection onCta={() => undefined} />);

    expect(container).toHaveTextContent(
      "Разберетесь в учете лизинговых операций в рублях и валюте",
    );
    expect(container).toHaveTextContent(
      "Сформируете бухгалтерскую отчётность с нуля и вручную, потому что вы молодцы!",
    );
    expect(container).toHaveTextContent(
      "Алгоритм четких действий, чтобы восстанавливать 1 год учета за 1 месяц.",
    );
  });
});
