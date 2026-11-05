import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SourceBadge } from "./SourceBadge";

afterEach(cleanup);

it("shows the destination without needing hover", () => {
  render(<SourceBadge source="telegram" label="Support bot" />);
  expect(screen.getByText("TG · Support bot")).toBeVisible();
});

it("keeps the personal account name visible and the full channel identity accessible", () => {
  render(<SourceBadge source="telegram" label="Тестовый Администратор · личный Telegram" />);
  expect(screen.getByText("TG · Тестовый Администратор")).toBeVisible();
  expect(screen.getByLabelText("Telegram · Тестовый Администратор · личный Telegram")).toBeVisible();
});

it("does not invent a destination while channel identity is unavailable", () => {
  render(<SourceBadge source="telegram" />);
  expect(screen.getByText("TG · канал не определён")).toBeVisible();
});
