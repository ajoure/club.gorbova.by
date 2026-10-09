import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), refetch: vi.fn(), linked: false }));
vi.mock("@/hooks/useTelegramLink", () => ({
  useStartTelegramLink: () => ({ mutateAsync: mocks.start, isPending: false }),
  useTelegramLinkStatus: () => ({ data: { status: mocks.linked ? "active" : "not_linked" }, isLoading: false, isFetching: false, refetch: mocks.refetch }),
}));
import { QuestionnaireTelegramStep } from "./QuestionnaireTelegramStep";
describe("post-questionnaire support bot", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.linked=false; });
  it("uses the server link to the configured support bot and checks linking on return",async()=>{
    mocks.start.mockResolvedValue({success:true,bot_username:"gorbovabybot",deep_link:"https://t.me/gorbovabybot?start=test-token",expires_at:new Date(Date.now()+900000).toISOString()});
    render(<QuestionnaireTelegramStep />);
    fireEvent.click(screen.getByRole("button",{name:"Привязать Telegram"}));
    expect(await screen.findByRole("link",{name:"Открыть support-бота"})).toHaveAttribute("href","https://t.me/gorbovabybot?start=test-token");
    fireEvent.click(screen.getByRole("button",{name:/Я нажал/}));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it("rejects a link to another bot without losing the saved questionnaire",async()=>{
    mocks.start.mockResolvedValue({success:true,bot_username:"other",deep_link:"https://t.me/other?start=test-token",expires_at:new Date(Date.now()+900000).toISOString()});
    render(<QuestionnaireTelegramStep />);
    fireEvent.click(screen.getByRole("button",{name:"Привязать Telegram"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Анкета сохранена");
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("does not create a new token for an already linked Telegram account",()=>{
    mocks.linked=true;render(<QuestionnaireTelegramStep />);
    expect(screen.getByRole("status")).toHaveTextContent("уже привязан");
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
