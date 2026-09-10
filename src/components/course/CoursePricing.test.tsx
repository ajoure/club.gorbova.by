import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoursePricing } from "./CoursePricing";

vi.mock("@/components/landing/AnimatedSection", () => ({
  AnimatedSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("alternative course landing future-sales terms", () => {
  it("matches the current prices, access terms and tariff-specific bonuses", () => {
    const { getByRole, container } = render(<CoursePricing />);
    for (const amount of [1790, 2190, 2990]) {
      expect(getByRole("button", { name: `Оплатить ${amount} BYN` })).toBeInTheDocument();
    }
    for (const amount of [139, 183, 249]) {
      expect(getByRole("button", { name: `Рассрочка от ${amount} BYN/мес` })).toBeInTheDocument();
    }
    for (const months of [6, 9, 12]) {
      expect(container).toHaveTextContent(`Доступ: ${months} мес после окончания курса`);
    }
    const accountant = getByRole("heading", { name: /^Бухгалтер$/ }).parentElement?.parentElement;
    expect(accountant).not.toHaveTextContent("Делегирование");
    expect(accountant).not.toHaveTextContent("Найм");
    expect(accountant).not.toHaveTextContent("Таймлайн");
    expect(container).toHaveTextContent("VIP модули: Делегирование, Найм и адаптация, Таймлайн месяца");
  });
});
