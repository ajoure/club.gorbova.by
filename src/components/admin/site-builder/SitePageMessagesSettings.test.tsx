import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ templates: [] as unknown[], error: false, blocks: [] as unknown[] }));
vi.mock("@/hooks/useSitePages", () => ({ useSitePage: () => ({ data: { blocks: state.blocks } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.templates, isPending: false, isError: state.error }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { SitePageMessagesSettings } from "./SitePageMessagesSettings";
const page="00000000-0000-4000-8000-000000000001",block="00000000-0000-4000-8000-000000000002";
afterEach(() => { cleanup();state.templates=[];state.error=false;state.blocks=[]; });
describe("existing page message settings", () => {
  it("opens the existing event editor scoped to a saved form, without creating or enabling a rule", () => {
    state.blocks=[{id:block,type:"form",content:{auth_mode:true,questionnaire_first:true,webinar_registration:true}}];
    render(<SitePageMessagesSettings pageId={page}/>);
    const link=screen.getByRole("link",{name:"Настроить сообщение"});
    expect(link).toHaveAttribute("href",expect.stringContaining(`automation_form=${block}`));
    expect(link).toHaveAttribute("href",expect.stringContaining(`automation_page=${page}`));
    expect(screen.getByText("Автоматические сообщения пока не настроены.")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Отправить"})).not.toBeInTheDocument();
  });
  it("shows the actual pending status and reports loading errors instead of showing a false success", () => {
    state.templates=[{id:block,name:"После регистрации",status:"recurring",approval_status:"pending_approval",channels:["email","telegram"],metadata:{site_form_condition:{block_id:block}}}];
    const view=render(<SitePageMessagesSettings pageId={page}/>);
    expect(screen.getByText("Ожидает одобрения")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Редактировать"})).toHaveAttribute("href",expect.stringContaining(`broadcast_template=${block}`));
    state.error=true;view.rerender(<SitePageMessagesSettings pageId={page}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить сообщения");
  });
});
