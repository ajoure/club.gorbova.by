import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RefundAccessActionSelector } from "./RefundDialog";
import type { RefundAccessAction } from "@/lib/refundAccessPolicy";

function SelectorHarness({ isFullRefund = true }: { isFullRefund?: boolean }) {
  const [value, setValue] = useState<RefundAccessAction>("keep");

  return (
    <>
      <RefundAccessActionSelector
        value={value}
        isFullRefund={isFullRefund}
        onValueChange={setValue}
      />
      <output data-testid="selected-refund-access-action">{value}</output>
    </>
  );
}

describe("RefundAccessActionSelector", () => {
  it("changes the action when the administrator clicks any part of an option card", () => {
    render(<SelectorHarness />);

    expect(screen.getByTestId("selected-refund-access-action").textContent).toBe("keep");

    fireEvent.click(screen.getByTestId("refund-access-action-keep_subscription"));
    expect(screen.getByTestId("selected-refund-access-action").textContent).toBe("keep_subscription");
    expect(screen.getByRole("radio", { name: /Сохранить подписку/ })).toHaveAttribute("data-state", "checked");

    fireEvent.click(screen.getByText("Сохранить доступ"));
    expect(screen.getByTestId("selected-refund-access-action").textContent).toBe("keep");
    expect(screen.getByRole("radio", { name: /Сохранить доступ/ })).toHaveAttribute("data-state", "checked");

    fireEvent.click(screen.getByText("Аннулировать доступ"));
    expect(screen.getByTestId("selected-refund-access-action").textContent).toBe("revoke");
  });

  it("keeps revoke disabled for a partial refund but leaves safe options selectable", () => {
    render(<SelectorHarness isFullRefund={false} />);

    fireEvent.click(screen.getByTestId("refund-access-action-revoke"));
    expect(screen.getByTestId("selected-refund-access-action").textContent).toBe("keep");

    fireEvent.click(screen.getByTestId("refund-access-action-reduce"));
    expect(screen.getByTestId("selected-refund-access-action").textContent).toBe("reduce");
  });
});
