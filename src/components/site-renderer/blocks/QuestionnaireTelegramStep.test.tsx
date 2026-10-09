import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), refetch: vi.fn(), invoke: vi.fn(), linked: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("@/hooks/useTelegramLink", () => ({
  useStartTelegramLink: () => ({ mutateAsync: mocks.start, isPending: false }),
  useTelegramLinkStatus: () => ({ data: { status: mocks.linked ? "active" : "not_linked" }, isLoading: false, isFetching: false, refetch: mocks.refetch }),
}));
import { QuestionnaireTelegramStep } from "./QuestionnaireTelegramStep";
describe("post-questionnaire support bot", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.linked=false; });
  it("uses the server link to the configured support bot and checks linking on return",async()=>{
    mocks.start.mockResolvedValue({success:true,bot_username:"gorbovabybot",deep_link:"https://t.me/gorbovabybot?start=test-token",expires_at:new Date(Date.now()+900000).toISOString()});
    render(<QuestionnaireTelegramStep pageId="page" blockId="block" />);
    fireEvent.click(screen.getByRole("button",{name:"Привязать Telegram"}));
    expect(await screen.findByRole("link",{name:"Открыть support-бота"})).toHaveAttribute("href","https://t.me/gorbovabybot?start=test-token");
    fireEvent.click(screen.getByRole("button",{name:/Я нажал/}));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it("rejects a link to another bot without losing the saved questionnaire",async()=>{
    mocks.start.mockResolvedValue({success:true,bot_username:"other",deep_link:"https://t.me/other?start=test-token",expires_at:new Date(Date.now()+900000).toISOString()});
    render(<QuestionnaireTelegramStep pageId="page" blockId="block" />);
    fireEvent.click(screen.getByRole("button",{name:"Привязать Telegram"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Анкета сохранена");
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("does not create a new token for an already linked Telegram account",()=>{
    mocks.linked=true;render(<QuestionnaireTelegramStep pageId="page" blockId="block" />);
    expect(screen.getByRole("status")).toHaveTextContent("уже привязан");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("prepares a private join request only after linking, preserving a permanent free right",async()=>{
    mocks.linked=true;
    mocks.invoke.mockResolvedValue({ data: { success:true,invite_link:"https://t.me/+private-fixture" }, error:null });
    render(<QuestionnaireTelegramStep pageId="page" blockId="block" />);
    fireEvent.click(screen.getByRole("button",{name:"Получить приглашение в канал"}));
    expect(await screen.findByRole("link",{name:"Вступить в бесплатный канал"})).toHaveAttribute("href","https://t.me/+private-fixture");
    expect(mocks.invoke).toHaveBeenCalledWith("site-form-submit",{body:{action:"bonus_channel_invite",page_id:"page",block_id:"block",fields:[]}});
    expect(screen.getByText(/доступ сохраняется навсегда/)).toBeInTheDocument();
  });
  it("rejects unsafe invitation URLs and keeps the saved form",async()=>{
    mocks.linked=true;
    mocks.invoke.mockResolvedValue({ data:{success:true,invite_link:"https://wrong.example/+private"},error:null });
    render(<QuestionnaireTelegramStep pageId="page" blockId="block" />);
    fireEvent.click(screen.getByRole("button",{name:"Получить приглашение в канал"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Анкета сохранена");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
