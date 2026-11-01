import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TicketMessageText } from "./TicketMessageText";

afterEach(cleanup);

describe("web ticket plain-text links", () => {
  it("makes a payment address clickable and preserves paragraphs and query parameters", () => {
    const address = "https://gorbova.by/pay/example?method=subscription&currency=BYN";
    const text = `Оплатите самостоятельно.\n\n${address}\n\nПосле оплаты проверьте доступ.`;
    const { container } = render(<TicketMessageText text={text} />);
    const link = screen.getByRole("link", { name: address });
    expect(link).toHaveAttribute("href", address);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("break-all");
    expect(container.querySelector("p")?.textContent).toBe(text);
  });

  it("keeps sentence punctuation outside links and retains balanced URL parentheses", () => {
    const { container } = render(<TicketMessageText text="См. (https://example.com/a_(b)). Далее http://example.org/help, пожалуйста." />);
    const links = screen.getAllByRole("link");
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      "https://example.com/a_(b)", "http://example.org/help",
    ]);
    expect(container.textContent).toBe("См. (https://example.com/a_(b)). Далее http://example.org/help, пожалуйста.");
  });

  it("leaves unsafe protocols, invalid addresses, userinfo and HTML as plain text", () => {
    const text = '<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,test https://?bad https://name:secret@example.com/';
    const { container } = render(<TicketMessageText text={text} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(text);
  });
});
