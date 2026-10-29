import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TelegramUrlButtonEditor } from "./TelegramUrlButtonEditor";
import type { TelegramUrlButton } from "../../../../supabase/functions/telegram-admin-chat/messageFormat";

afterEach(cleanup);

function ComposerButtons() {
  const [buttons, setButtons] = useState<TelegramUrlButton[]>([]);
  return <TelegramUrlButtonEditor value={buttons} onChange={setButtons} />;
}

describe("operator URL button editor", () => {
  it("adds independently labelled clickable buttons and removes a selected button", () => {
    render(<ComposerButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Кнопка со ссылкой" }));
    fireEvent.change(screen.getByLabelText("Название кнопки 1"), { target: { value: "Открыть урок" } });
    fireEvent.change(screen.getByLabelText("Ссылка кнопки 1"), { target: { value: "https://gorbova.by/library/course" } });
    expect(screen.getByRole("link", { name: "Открыть урок" })).toHaveAttribute("href", "https://gorbova.by/library/course");
    fireEvent.click(screen.getByRole("button", { name: "Кнопка со ссылкой" }));
    fireEvent.change(screen.getByLabelText("Название кнопки 2"), { target: { value: "Материалы" } });
    fireEvent.change(screen.getByLabelText("Ссылка кнопки 2"), { target: { value: "https://gorbova.by/library/materials" } });
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Удалить кнопку 1" }));
    expect(screen.queryByRole("link", { name: "Открыть урок" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Материалы" })).toBeInTheDocument();
  });

  it("shows invalid addresses without exposing an executable preview", () => {
    render(<ComposerButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Кнопка со ссылкой" }));
    fireEvent.change(screen.getByLabelText("Название кнопки 1"), { target: { value: "Урок" } });
    fireEvent.change(screen.getByLabelText("Ссылка кнопки 1"), { target: { value: "javascript:alert(1)" } });
    expect(screen.getByRole("alert")).toHaveTextContent("HTTPS");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
