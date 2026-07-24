import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPaymentLinkDialog } from "./AdminPaymentLinkDialog";

const fixture = vi.hoisted(() => {
  const products = [
    { id: "product-cb", name: "Ценный бухгалтер", is_active: true },
    { id: "product-club", name: "Gorbova Club", is_active: true },
  ];
  const tariffsByProduct: Record<string, Array<Record<string, unknown>>> = {
    "product-cb": [{ id: "tariff-cb", name: "BASE", product_id: "product-cb", is_active: true }],
    "product-club": [{ id: "tariff-club", name: "FULL", product_id: "product-club", is_active: true }],
  };
  const offersByTariff: Record<string, Array<Record<string, unknown>>> = {
    "tariff-cb": [
      {
        id: "offer-cb",
        tariff_id: "tariff-cb",
        offer_type: "pay_now",
        button_label: "Оплатить CB",
        amount: 450,
        is_active: true,
        is_primary: true,
        meta: {},
      },
    ],
    "tariff-club": [
      {
        id: "offer-club",
        tariff_id: "tariff-club",
        offer_type: "pay_now",
        button_label: "Оплатить Club",
        amount: 150,
        is_active: true,
        is_primary: true,
        meta: {},
      },
    ],
  };
  return { products, tariffsByProduct, offersByTariff };
});

const invoke = vi.hoisted(() =>
  vi.fn(async (name: string) => {
    if (name === "composable-checkout-quote") {
      return {
        data: {
          success: true,
          subtotal: 150,
          total: 150,
          currency: "BYN",
          items: [],
          available_addons: [],
        },
        error: null,
      };
    }
    return { data: { success: true }, error: null };
  }),
);

vi.mock("@/hooks/useProductsV2", () => ({
  useProductsV2: () => ({ data: fixture.products, isLoading: false }),
  useTariffs: (productId?: string) => ({
    data: productId ? fixture.tariffsByProduct[productId] ?? [] : [],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useTariffOffers", () => ({
  useTariffOffers: (tariffId?: string) => ({
    data: tariffId ? fixture.offersByTariff[tariffId] ?? [] : [],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useHasRoleV2", () => ({
  useHasRoleV2: () => ({ hasRole: false, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const order = vi.fn(async () => ({ data: [], error: null }));
  const eq = vi.fn(() => ({ eq, order, maybeSingle: vi.fn(async () => ({ data: null, error: null })) }));
  const select = vi.fn(() => ({ eq, order }));
  return {
    supabase: {
      from: vi.fn(() => ({ select, eq, order })),
      functions: { invoke },
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    },
  };
});

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminPaymentLinkDialog
          open
          onOpenChange={onOpenChange}
          userId="user-1"
          userName="Марина Колейчик"
          userEmail="marina@example.com"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...result, onOpenChange };
}

async function selectByVisibleText(currentText: string, optionName: string) {
  const trigger = screen.getByText(currentText).closest("button");
  expect(trigger).toBeTruthy();
  fireEvent.pointerDown(trigger as HTMLButtonElement, { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

describe("AdminPaymentLinkDialog product selection", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it("keeps Gorbova Club selected and does not close the nested dialog", async () => {
    const { onOpenChange } = renderDialog();

    expect(screen.getByText("Выберите продукт")).toBeInTheDocument();

    await selectByVisibleText("Выберите продукт", "Gorbova Club");

    await waitFor(() => expect(screen.getByText("Gorbova Club")).toBeInTheDocument());
    expect(screen.getByText("Тариф")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("switches product by clearing dependent tariff state without clearing the new product", async () => {
    renderDialog();

    await selectByVisibleText("Выберите продукт", "Ценный бухгалтер");
    await waitFor(() => expect(screen.getByText("Ценный бухгалтер")).toBeInTheDocument());
    await selectByVisibleText("Выберите тариф", "BASE");
    await waitFor(() => expect(screen.getByText("BASE")).toBeInTheDocument());

    await selectByVisibleText("Ценный бухгалтер", "Gorbova Club");

    await waitFor(() => expect(screen.getByText("Gorbova Club")).toBeInTheDocument());
    expect(screen.getByText("Выберите тариф")).toBeInTheDocument();
    expect(screen.queryByText("BASE")).not.toBeInTheDocument();
  });
});