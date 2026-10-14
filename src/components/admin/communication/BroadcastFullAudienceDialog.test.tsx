import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BroadcastFullAudienceDialog, type FullAudienceConfirmation } from "./BroadcastFullAudienceDialog";
import { isFullBroadcastAudience } from "@/lib/broadcastConfirmation";

const confirmation: FullAudienceConfirmation = { channels: [
  { channel: "telegram", count: 120, fullAudience: true },
  { channel: "email", count: 170, fullAudience: true },
] };

describe("manual broadcast confirmation", () => {
  it("classifies club, product and bot audiences without broadening email", () => {
    expect(isFullBroadcastAudience({}, "telegram")).toBe(true);
    expect(isFullBroadcastAudience({ club_ids: ["club"] }, "telegram")).toBe(false);
    expect(isFullBroadcastAudience({ club_ids: ["club"] }, "email")).toBe(false);
    expect(isFullBroadcastAudience({ include: [{ product_id: "product" }] }, "telegram")).toBe(false);
    expect(isFullBroadcastAudience({ bot_ids: ["bot"] }, "telegram")).toBe(false);
    expect(isFullBroadcastAudience({ bot_ids: ["bot"] }, "email")).toBe(true);
    expect(isFullBroadcastAudience({ education: { lesson_id: "lesson" } }, "email")).toBe(false);
  });

  it("shows both channels and blocks incomplete confirmation", () => {
    const onConfirm = vi.fn();
    render(<BroadcastFullAudienceDialog confirmation={confirmation} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText("Telegram: 120 получателей")).toBeVisible();
    expect(screen.getByText("Email: 170 получателей")).toBeVisible();
    const button = screen.getByRole("button", { name: "Подтвердить и отправить" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Введите фразу/), { target: { value: "123456" } });
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("accepts the complete phrase once for both channels, without a native prompt", () => {
    const onConfirm = vi.fn();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<BroadcastFullAudienceDialog confirmation={confirmation} onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/Введите фразу/), { target: { value: "  отправить   всем  " } });
    const button = screen.getByRole("button", { name: "Подтвердить и отправить" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("cancels without sending and requires a new confirmation after reopening", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<BroadcastFullAudienceDialog confirmation={confirmation} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/Введите фразу/), { target: { value: "ОТПРАВИТЬ ВСЕМ" } });
    fireEvent.click(screen.getByRole("button", { name: "Вернуться к фильтрам" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    rerender(<BroadcastFullAudienceDialog confirmation={null} onCancel={onCancel} onConfirm={onConfirm} />);
    rerender(<BroadcastFullAudienceDialog confirmation={confirmation} onCancel={onCancel} onConfirm={onConfirm} />);
    expect(screen.getByRole("button", { name: "Подтвердить и отправить" })).toBeDisabled();
  });
});
