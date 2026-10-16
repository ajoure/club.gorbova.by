import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneInput } from "./phone-input";
afterEach(cleanup);
describe("canonical international phone", () => {
  it("updates asynchronous profile values and clears without keeping a stale number", () => {
    const onChange = vi.fn();
    const view = render(<PhoneInput value="" onChange={onChange} id="phone" />);
    view.rerender(<PhoneInput value="+48123456789" onChange={onChange} id="phone" />);
    expect(screen.getByRole("textbox")).toHaveValue("123456789");
    expect(screen.getByRole("combobox")).toHaveTextContent("+48");
    view.rerender(<PhoneInput value="" onChange={onChange} id="phone" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("accepts an international paste with 00 and blocks changes while a request is pending", () => {
    const onChange = vi.fn();
    const view = render(<PhoneInput value="" onChange={onChange} />);
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { getData: () => "0049 123 4567890" } });
    expect(onChange).toHaveBeenLastCalledWith("+491234567890");
    expect(screen.getByRole("combobox")).toHaveTextContent("+49");
    view.rerender(<PhoneInput value="+491234567890" onChange={onChange} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
  it("offers another country rather than locking the form to Belarus", () => {
    const onChange = vi.fn();render(<PhoneInput value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Польша/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "123456789" } });
    expect(onChange).toHaveBeenLastCalledWith("+48123456789");
  });
});
