import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramSenderNotice } from "./TelegramSenderNotice";

afterEach(cleanup);

describe("Telegram sender recovery", () => {
  it("retries loading without submitting the message form or clearing its draft", () => {
    const retry = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}>
      <input aria-label="Draft" defaultValue="Unsent draft" />
      <TelegramSenderNotice loading={false} failed onRetry={retry} />
    </form>);
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить отправителя");
    fireEvent.click(screen.getByRole("button", { name: "Обновить отправителей" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Draft")).toHaveValue("Unsent draft");
  });

  it("prevents duplicate reloads and distinguishes an empty result from an error", () => {
    const retry = vi.fn();
    const { rerender } = render(<TelegramSenderNotice loading failed={false} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button"));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Загружаем отправителя");
    rerender(<TelegramSenderNotice loading={false} failed={false} onRetry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Нет доступного отправителя");
    expect(screen.getByRole("button")).toBeEnabled();
  });
});
