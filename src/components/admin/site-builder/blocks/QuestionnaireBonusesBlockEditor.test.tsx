import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { QuestionnaireBonusesBlockEditor } from "./QuestionnaireBonusesBlockEditor";
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
describe("questionnaire bonus configuration", () => {
  it("clears a stale form when selecting another page and preserves the configured business link", () => {
    query.data = [
      { id: "page-a", title: "Предзапись", blocks: [
        { id: "form-a", type: "form", content: { title: "Анкета", auth_mode: true } },
        { id: "other", type: "form", content: { title: "Обычная форма" } },
      ] }, { id: "page-b", title: "Другая страница", blocks: [] },
    ];
    const content = { source_page_id: "page-a", source_block_id: "form-a", personal_chat_url: "https://t.me/m/adminConfigured" };
    const onChange = vi.fn();
    render(<QuestionnaireBonusesBlockEditor content={content} onChange={onChange} />);
    expect(screen.getByRole("option", { name: "Анкета" })).toHaveValue("form-a");
    expect(screen.queryByRole("option", { name: "Обычная форма" })).toBeNull();
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "page-b" } });
    expect(onChange).toHaveBeenCalledWith({ ...content, source_page_id: "page-b", source_block_id: "" });
  });
  it("warns when a channel invitation is mistakenly used as the personal conversation", () => {
    query.data = [];
    render(<QuestionnaireBonusesBlockEditor content={{ personal_chat_url: "https://t.me/+not-a-business-chat" }} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Нужна ссылка Telegram Business");
    expect(screen.getAllByRole("combobox")[1]).toBeDisabled();
  });
});
