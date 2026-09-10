import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FaqSection } from "../sections/FaqSection";

describe("future-sales FAQ", () => {
  it("matches the tariff cards and preserves historical purchase terms", () => {
    const { container } = render(<FaqSection />);
    const question = Array.from(container.querySelectorAll("details")).find((item) =>
      item.querySelector("summary")?.textContent?.includes("На какое время выдается доступ к курсу?"),
    );
    expect(question).toHaveTextContent("После окончания курса");
    expect(question).toHaveTextContent("«Бухгалтер» — 6 месяцев");
    expect(question).toHaveTextContent("«Главный бухгалтер» — 9 месяцев");
    expect(question).toHaveTextContent("«Бизнес-леди» — 12 месяцев");
    expect(question).toHaveTextContent("Для ранее оплаченных покупок сохраняются условия");
  });
});
