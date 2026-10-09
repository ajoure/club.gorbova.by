import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { SiteFormEventSettings } from "./SiteFormEventSettings";
const query = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: { value?: string; onValueChange: (value: string) => void; children: ReactNode; disabled?: boolean }) =>
    <select value={value || ""} onChange={e => onValueChange(e.target.value)} disabled={disabled}><option value="">Выберите</option>{children}</select>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));
const pageA = "00000000-0000-4000-8000-000000000003";
const pageB = "00000000-0000-4000-8000-000000000004";
const block = "00000000-0000-4000-8000-000000000008";
describe("site form event destination", () => {
  it("allows a personal invitation after questionnaire submission, never for an incomplete reminder", () => {
    const onChange=vi.fn();
    const {rerender}=render(<SiteFormEventSettings value={{page_id:pageA,block_id:block,event:"submitted"}} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({page_id:pageA,block_id:block,event:"submitted",personal_bonus_invite:true});
    rerender(<SiteFormEventSettings value={{page_id:pageA,block_id:block,event:"email_confirmed_incomplete",delay_minutes:60}} onChange={onChange} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("allows immediate delivery or a delay after a completed questionnaire", () => {
    const onChange = vi.fn();
    render(<SiteFormEventSettings value={{ page_id: pageA, block_id: block, event: "submitted" }} onChange={onChange} />);
    const delay = screen.getByLabelText("Задержка после попадания под правило (минут)");
    expect(delay).toHaveValue(0);
    fireEvent.change(delay, { target: { value: "90" } });
    expect(onChange).toHaveBeenCalledWith({ page_id: pageA, block_id: block, event: "submitted", delay_minutes: 90 });
  });
  it("offers authenticated forms only and clears the previous form when the page changes", () => {
    query.data = [
      { id: pageA, title: "Предзапись", slug: "preregistration", blocks: [
        { id: block, type: "form", content: { title: "Анкета", auth_mode: true, questionnaire_first: true } },
        { id: "legacy", type: "form", content: { title: "Обычная форма", auth_mode: false } },
      ] },
      { id: pageB, title: "Другая страница", blocks: [] },
    ];
    const onChange = vi.fn();
    render(<SiteFormEventSettings value={{ page_id: pageA, block_id: block, event: "submitted" }} onChange={onChange} />);
    expect(screen.queryByText("Обычная форма")).toBeNull();
    expect(screen.getByRole("option", { name: "Анкета" })).toHaveValue(block);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: pageB } });
    expect(onChange).toHaveBeenCalledWith({ page_id: pageB, block_id: "", event: "submitted" });
  });
  it("shows a loading failure instead of inventing a destination", () => {
    query.data = []; query.isError = true;
    render(<SiteFormEventSettings value={{ page_id: "", block_id: "", event: "submitted" }} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить страницы");
    expect(screen.getAllByRole("combobox")[2]).toBeDisabled();
    query.isError = false;
  });
});
