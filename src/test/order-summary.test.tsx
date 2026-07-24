import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrderSummary, type OrderSummaryLine } from "@/components/checkout/OrderSummary";

const base: OrderSummaryLine = {
  role: "primary",
  product_name: "Ценный бухгалтер",
  tariff_name: "Бизнес-леди 2.0",
  list_amount: 2650,
  final_amount: 2650,
};

function addon(name: string, list: number, final: number): OrderSummaryLine {
  return {
    role: "addon",
    product_name: `Ценный бухгалтер | 1 ступень 2.0 | Модуль: ${name}`,
    tariff_name: null,
    list_amount: list,
    final_amount: final,
    discount_amount: list - final,
    discount_percent: list > 0 ? Math.round(((list - final) / list) * 100) : 0,
  };
}

describe("OrderSummary", () => {
  it("renders base tariff full price with 0 addons", () => {
    render(<OrderSummary items={[base]} currency="BYN" total={2650} />);
    expect(screen.getByText(/Бизнес-леди/i)).toBeInTheDocument();
    expect(screen.getAllByText(/2 ?650/).length).toBeGreaterThan(0);
  });

  it("renders 2 addons with 50% discount badges", () => {
    const items = [base, addon("Строительство", 400, 200), addon("Общепит", 400, 200)];
    render(<OrderSummary items={items} currency="BYN" total={3050} />);
    expect(screen.getByText(/Строительство/)).toBeInTheDocument();
    expect(screen.getByText(/Общепит/)).toBeInTheDocument();
    expect(screen.getAllByText(/−?-?50%|-50%|−50%/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders 9 addons compactly without crashing", () => {
    const names = ["A","B","C","D","E","F","G","H","I"];
    const items = [base, ...names.map((n) => addon(n, 400, 200))];
    render(<OrderSummary items={items} currency="BYN" total={2650 + 9 * 200} />);
    for (const n of names) {
      expect(screen.getByText(new RegExp(n))).toBeInTheDocument();
    }
  });

  it("renders payer and payment method labels", () => {
    render(
      <OrderSummary
        items={[base]}
        currency="BYN"
        total={2650}
        payerLabel="ООО «Ромашка» · УНП 123456789"
        paymentMethodLabel="Счёт на юрлицо / ИП"
      />,
    );
    expect(screen.getByText(/Ромашка/)).toBeInTheDocument();
    expect(screen.getByText(/Счёт на юрлицо/)).toBeInTheDocument();
  });
});
