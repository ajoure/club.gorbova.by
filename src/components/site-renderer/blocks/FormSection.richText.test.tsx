import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, session: null }),
}));

vi.mock("@/hooks/useInlineAuth", () => ({
  useInlineAuth: () => ({}),
}));

vi.mock("@/hooks/useTelegramLink", () => ({
  useStartTelegramLink: () => ({}),
  useTelegramLinkStatus: () => ({
    data: { status: "none" },
    refetch: vi.fn(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

import { FormSection } from "./FormSection";

describe("FormSection rich-text fields", () => {
  it("renders and sanitizes the formatted title produced by RichTextarea", () => {
    render(
      <FormSection
        isPreview
        content={{
          auth_mode: true,
          title:
            '<b>Предзапись на менторство&nbsp;<span style="font-size: 0.875rem">«Налоги и проверки Беларуси»</span></b><script>alert(1)</script>',
          subtitle: "",
          fields: [],
        }}
      />,
    );

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent(
      "Предзапись на менторство «Налоги и проверки Беларуси»",
    );
    expect(heading.querySelector("b")).not.toBeNull();
    expect(heading.querySelector("span")).toHaveStyle({ fontSize: "0.875rem" });
    expect(heading).not.toHaveTextContent("<b>");
    expect(heading.querySelector("script")).toBeNull();
  });

  it("renders formatted title, subtitle, and button text in the legacy form", () => {
    render(
      <FormSection
        content={{
          auth_mode: false,
          title: "<b>Заголовок</b>",
          subtitle: "<i>Подзаголовок</i>",
          buttonText: "<strong>Отправить</strong>",
          fields: [],
        }}
      />,
    );

    expect(screen.getByRole("heading", { level: 3 }).querySelector("b")).not.toBeNull();
    expect(screen.getByText("Подзаголовок").tagName).toBe("I");
    expect(screen.getByRole("button", { name: "Отправить" }).querySelector("strong")).not.toBeNull();
  });
});
