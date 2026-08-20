import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposableCheckoutDialog } from "./ComposableCheckoutDialog";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

function CheckoutHarness({ onContinue }: { onContinue: ReturnType<typeof vi.fn> }) {
  const [continued, setContinued] = useState(false);
  if (continued) return <div>Обычное оформление</div>;
  return (
    <ComposableCheckoutDialog
      open
      onOpenChange={vi.fn()}
      offerId="offer-club"
      productName="Gorbova Club"
      tariffName="FULL"
      paymentMethodLabel="Оплатить 100% картой"
      onContinue={(selection) => {
        onContinue(selection);
        setContinued(true);
      }}
    />
  );
}

describe("ComposableCheckoutDialog", () => {
  it("skips the composition UI when the offer has no configured addons", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        currency: "BYN",
        subtotal: 150,
        adjustment_amount: 0,
        total: 150,
        items: [{
          role: "primary",
          product_name: "Gorbova Club",
          tariff_name: "FULL",
          list_amount: 150,
          final_amount: 150,
        }],
        available_addons: [],
        selected_addon_offer_ids: [],
      },
      error: null,
    });
    const onContinue = vi.fn();

    render(<CheckoutHarness onContinue={onContinue} />);

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledWith({
        addonOfferIds: [],
        total: 150,
        currency: "BYN",
      });
    });
    expect(screen.getByText("Обычное оформление")).toBeInTheDocument();
    expect(screen.queryByText("Для этого тарифа дополнительные модули пока не настроены.")).not.toBeInTheDocument();
  });

  it("keeps the composition UI for an offer with configured addons", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        currency: "BYN",
        subtotal: 250,
        adjustment_amount: 0,
        total: 250,
        items: [{
          role: "primary",
          product_name: "Ценный бухгалтер",
          tariff_name: "Программа",
          list_amount: 250,
          final_amount: 250,
        }],
        available_addons: [{
          addon_offer_id: "addon-1",
          addon_product_name: "Модуль",
          addon_tariff_name: "Базовый",
          list_amount: 100,
          pricing_mode: "offer_price",
          fixed_amount: null,
          discount_percent: null,
          is_required: false,
          is_default_selected: false,
        }],
        selected_addon_offer_ids: [],
      },
      error: null,
    });

    render(
      <ComposableCheckoutDialog
        open
        onOpenChange={vi.fn()}
        offerId="offer-composable"
        productName="Ценный бухгалтер"
        tariffName="Программа"
        paymentMethodLabel="Оплатить в 2 платежа"
        onContinue={vi.fn()}
      />,
    );

    expect(await screen.findByText("Соберите свою программу")).toBeInTheDocument();
    expect(await screen.findByText("Оплатить в 2 платежа")).toBeInTheDocument();
  });
});
