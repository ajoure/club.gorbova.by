import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CustdevFieldLabel } from "./CustdevGuidance";
import { getCustdevGuidance } from "./custdev-guidance";

afterEach(cleanup);

describe("custdev accessible guidance", () => {
  it("opens by click/tap without changing the field's accessible name, and closes with Escape", async () => {
    render(
      <>
        <CustdevFieldLabel
          label="Название целевого сегмента"
          htmlFor="segment"
        />
        <input id="segment" defaultValue="Магазины" />
      </>,
    );
    expect(screen.getByLabelText("Название целевого сегмента")).toHaveValue(
      "Магазины",
    );
    const trigger = screen.getByRole("button", {
      name: "Подсказка: Название целевого сегмента",
    });
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);
    const help = screen.getByRole("dialog", {
      name: "Подсказка: Название целевого сегмента",
    });
    expect(help).toHaveTextContent("Небольшие розничные магазины");
    expect(help).toHaveTextContent(
      "Категория доходности из портфеля — другое понятие",
    );
    expect(screen.getByLabelText("Название целевого сегмента")).toHaveValue(
      "Магазины",
    );
    fireEvent.keyDown(help, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("explains actual question groups, evidence limits and the real manual-review control", () => {
    expect(getCustdevGuidance("Вопрос 2.10")?.example).toContain(
      "Что произошло",
    );
    expect(getCustdevGuidance("Комментарий к вопросу 7.3")?.explanation)
      .toContain("не ответ респондента");
    expect(getCustdevGuidance("Ручная поправка повторяемости")?.explanation)
      .toContain("одним упоминанием");
    expect(getCustdevGuidance("Обоснование и ручные замечания")?.explanation)
      .toContain("Проверено мной");
    expect(getCustdevGuidance("Подтверждённое доказательство")?.inline)
      .toContain("гипотеза");
    expect(getCustdevGuidance("Мой вариант УТП")?.inline).toContain(
      "Оставить мой вариант УТП",
    );
  });
});
