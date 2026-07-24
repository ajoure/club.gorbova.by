import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { OrderSummary, type OrderSummaryLine } from "@/components/checkout/OrderSummary";

const base: OrderSummaryLine = {
  role: "primary",
  product_name: "Бизнес-леди",
  tariff_name: "1 ступень 2.0",
  list_amount: 2650,
  final_amount: 2650,
  discount_amount: 0,
  pricing_mode: "offer_price",
};

function addon(name: string, list: number, discountPct: number | null = null): OrderSummaryLine {
  const final = discountPct != null ? list * (1 - discountPct / 100) : list;
  return {
    role: "addon",
    product_name: `Ценный бухгалтер | Модуль: ${name}`,
    list_amount: list,
    final_amount: final,
    discount_amount: list - final,
    discount_percent: discountPct,
    pricing_mode: discountPct != null ? "percent_discount" : "offer_price",
  };
}

describe("OrderSummary", () => {
  it("shows primary line without discount and only base total when no addons", () => {
    render(<OrderSummary items={[base]} currency="BYN" total={2650} subtotal={2650} />);
    expect(screen.getByText("Бизнес-леди")).toBeInTheDocument();
    expect(screen.getByText("1 ступень 2.0")).toBeInTheDocument();
    // Total row + primary row both render 2 650,00
    const totalMatches = screen.getAllByText(/2\s?650,00/);
    expect(totalMatches.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/−50%/)).toBeNull();
  });

  it("renders base full price + 2 addons with 50% discount and correct total", () => {
    const items = [base, addon("Строительство", 300, 50), addon("Маркетплейсы", 400, 50)];
    const total = 2650 + 150 + 200;
    render(<OrderSummary items={items} currency="BYN" total={total} subtotal={total} />);
    expect(screen.getByText("Строительство")).toBeInTheDocument();
    expect(screen.getByText("Маркетплейсы")).toBeInTheDocument();
    const badges = screen.getAllByText("−50%");
    expect(badges).toHaveLength(2);
    // striked list prices are present
    expect(screen.getByText(/300,00/)).toBeInTheDocument();
    expect(screen.getByText(/400,00/)).toBeInTheDocument();
    // total
    expect(screen.getByText(/3\s?000,00/)).toBeInTheDocument();
  });

  it("handles 9 addons list and computes total from item finals", () => {
    const items = [base, ...Array.from({ length: 9 }).map((_, i) => addon(`M${i}`, 100, 50))];
    const total = 2650 + 9 * 50;
    render(<OrderSummary items={items} currency="BYN" total={total} />);
    const summary = screen.getByTestId("order-summary");
    // 1 primary + 9 addon rows = 10 li
    expect(within(summary).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText(/3\s?100,00/)).toBeInTheDocument();
  });

  it("shows payer + payment method labels and adjustment reason", () => {
    render(
      <OrderSummary
        items={[base]}
        currency="BYN"
        total={2385}
        subtotal={2650}
        adjustmentAmount={-265}
        adjustmentReason="персональная скидка"
        payerLabel='ООО «Тест»'
        paymentMethodLabel="Счёт на юрлицо"
      />,
    );
    expect(screen.getByText('ООО «Тест»')).toBeInTheDocument();
    expect(screen.getByText("Счёт на юрлицо")).toBeInTheDocument();
    expect(screen.getByText(/Скидка · персональная скидка/)).toBeInTheDocument();
  });
});
