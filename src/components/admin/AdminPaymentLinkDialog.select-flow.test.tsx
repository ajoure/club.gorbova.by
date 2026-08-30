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
    { id: "product-cb-20", name: "Ценный бухгалтер | 1 ступень 2.0 | 20 поток", is_active: false },
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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "staff-1" } }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));

vi.mock("@/hooks/useStaffOptions", () => ({
  useStaffOptions: () => ({
    data: [{ user_id: "staff-1", label: "Тестовый менеджер", email: null }],
  }),
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

function selectNativeByValue(accessibleName: string, value: string) {
  const field = screen.getByRole("combobox", { name: accessibleName }).parentElement?.querySelector("select");
  expect(field).toBeTruthy();
  fireEvent.change(field as HTMLSelectElement, { target: { value } });
}

function selectProductByName(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Продукт" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("AdminPaymentLinkDialog product selection", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it("keeps Gorbova Club selected and does not close the nested dialog", async () => {
    const { onOpenChange } = renderDialog();

    expect(screen.getByText("Выберите продукт")).toBeInTheDocument();

    selectProductByName("Gorbova Club");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Продукт" })).toHaveTextContent("Gorbova Club"));
    expect(screen.getByText("Тариф")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("switches product by clearing dependent tariff state without clearing the new product", async () => {
    renderDialog();

    selectProductByName("Ценный бухгалтер");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Продукт" })).toHaveTextContent("Ценный бухгалтер"));
    selectNativeByValue("Тариф", "tariff-cb");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Тариф" })).toHaveTextContent("BASE"));

    selectProductByName("Gorbova Club");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Продукт" })).toHaveTextContent("Gorbova Club"));
    expect(screen.getByText("Выберите тариф")).toBeInTheDocument();
    expect(screen.queryByText("BASE")).not.toBeInTheDocument();
  });

  it("finds inactive products by any words in the name", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("combobox", { name: "Продукт" }));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ценный бухгалтер",
      "Ценный бухгалтер | 1 ступень 2.0 | 20 потокНеактивен",
      "Gorbova Club",
    ]);

    fireEvent.change(screen.getByRole("textbox", { name: "Поиск продукта" }), {
      target: { value: "20 поток" },
    });

    expect(screen.getByRole("option", { name: "Ценный бухгалтер | 1 ступень 2.0 | 20 поток Неактивен" })).toBeInTheDocument();
    expect(screen.getByText("Неактивен")).toBeInTheDocument();
  });

  it("renders the scrollable product list inline instead of in a clipped portal", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("combobox", { name: "Продукт" }));

    const dialog = screen
      .getByRole("combobox", { name: "Продукт" })
      .closest('[role="dialog"]');
    const picker = screen.getByTestId("admin-payment-product-picker");
    const scrollArea = screen.getByTestId("admin-payment-product-scroll-area");
    const productList = screen.getByRole("listbox", { name: "Список продуктов" });
    expect(dialog).toBeTruthy();
    expect(dialog).toContainElement(picker);
    expect(dialog).toContainElement(productList);
    expect(picker).toContainElement(productList);
    expect(picker).toContainElement(scrollArea);
    expect(scrollArea).toContainElement(productList);
    expect(scrollArea).toHaveClass("relative", "overflow-hidden");
    expect(scrollArea).toHaveClass("h-[min(18rem,calc(100dvh-14rem))]");
    expect(
      document.body.querySelector("[data-radix-popper-content-wrapper]"),
    ).toBeNull();
  });
});
