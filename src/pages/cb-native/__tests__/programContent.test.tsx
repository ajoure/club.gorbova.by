import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PROGRAM_COLLAPSED_ITEM_COUNT,
  PROGRAM_MODULE_COUNT,
  ProgramSection,
} from "../sections/ProgramSection";

describe("CbNative programme fidelity", () => {
  it("renders a non-empty result panel for every numbered module", () => {
    const { container } = render(<ProgramSection onCta={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /смотреть всю программу/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /смотреть всю программу/i }));

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

  it("starts collapsed and expands the programme in place instead of linking to tariffs", () => {
    const { container } = render(<ProgramSection onCta={() => undefined} />);
    const button = screen.getByRole("button", { name: /смотреть всю программу/i });

    expect(
      container.querySelectorAll("[data-cb-native-program-module], [data-cb-native-program-callout]"),
    ).toHaveLength(PROGRAM_COLLAPSED_ITEM_COUNT);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("data-cb-native-anchor-target");

    fireEvent.click(button);

    expect(
      container.querySelectorAll("[data-cb-native-program-module], [data-cb-native-program-callout]"),
    ).toHaveLength(PROGRAM_MODULE_COUNT + 3);
    expect(screen.getByRole("button", { name: /свернуть/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
