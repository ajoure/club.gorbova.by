// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SalesRuntimeControls } from "./SalesRuntimeControls";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), can: true }));
vi.mock(
  "@/integrations/supabase/client",
  () => ({ supabase: { functions: { invoke: mock.invoke } } }),
);
vi.mock(
  "@/hooks/useAdminAccess",
  () => ({ useAdminAccess: () => ({ canAccessSection: () => mock.can }) }),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let client: QueryClient;
const base = {
  available: true,
  can_configure: true,
  campaign: {
    mode: "owner_test",
    trigger_phrase: "Хочу программу курса ЦБ",
    delay_min_seconds: 60,
    delay_max_seconds: 180,
  },
  conversation: { state: "READY", started: true, reason: null },
  job: { status: "queued", due_at: "2026-09-12T12:00:00Z" },
};
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <SalesRuntimeControls
        userId="user-scope"
        businessAccountId="business-scope"
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.can = true;
  mock.invoke.mockReset();
  mock.invoke.mockResolvedValue({ data: base, error: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
describe("exact-dialog sales controls", () => {
  it("shows delayed status and pauses the selected Business dialog", async () => {
    mount();
    await screen.findByText("Ответ ожидает отправки");
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("sales-runtime-control", {
        body: {
          action: "pause",
          user_id: "user-scope",
          business_account_id: "business-scope",
        },
      })
    );
  });
  it("resumes held dialogue and exposes a bounded delay setting", async () => {
    mock.invoke.mockResolvedValue({
      data: { ...base, conversation: { state: "HUMAN_HOLD" }, job: null },
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Продолжить" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("sales-runtime-control", {
        body: {
          action: "resume",
          user_id: "user-scope",
          business_account_id: "business-scope",
        },
      })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Настройки задержки автопродаж" }),
    );
    fireEvent.change(screen.getByLabelText("Минимальная задержка"), {
      target: { value: "0" },
    });
    expect(
      (screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("does not offer resume on uncertain delivery or controls without permission", async () => {
    mock.invoke.mockResolvedValue({
      data: {
        ...base,
        conversation: { state: "DELIVERY_UNKNOWN" },
        job: { status: "unknown" },
      },
    });
    mount();
    await screen.findByText("Нужно проверить доставку");
    expect(screen.queryByRole("button", { name: "Продолжить" })).toBeNull();
    cleanup();
    mock.can = false;
    mock.invoke.mockClear();
    mount();
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sales-runtime-controls")).toBeNull();
  });
});


it("AI settings use the existing owner control and preserve expected config", async () => {
 const ai={model:'google/gemini-3.1-pro-preview',max_tokens:8000,timeout_seconds:60,max_context_chars:750000,vision_enabled:true,max_image_bytes:8388608};
 mock.invoke.mockResolvedValue({data:{...base,campaign:{...base.campaign,mode:'off',ai_config:ai},conversation:{state:'HUMAN_HOLD'},job:null,ai_models:[ai.model,'google/gemini-3.8-flash']}});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Настройки задержки автопродаж'}));
 fireEvent.change(screen.getByLabelText('Модель автопродаж'),{target:{value:'google/gemini-3.8-flash'}});
 fireEvent.click(screen.getByRole('button',{name:'Сохранить настройки ИИ'}));
 await waitFor(()=>expect(mock.invoke).toHaveBeenCalledWith('sales-runtime-control',{body:{action:'ai_config',user_id:'user-scope',business_account_id:'business-scope',ai_config:{...ai,model:'google/gemini-3.8-flash'},expected_ai_config:ai}}));
});


it("owner selects consultation products through existing control without exposing campaign knowledge", async () => {
 mock.invoke.mockResolvedValue({data:{...base,campaign:{...base.campaign,mode:'off',consultation_product_ids:[]},conversation:{state:'HUMAN_HOLD'},job:null,catalog_products:[{id:'club-id',name:'Клуб'}]}});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Настройки задержки автопродаж'}));
 fireEvent.click(screen.getByLabelText('Консультировать: Клуб'));fireEvent.click(screen.getByRole('button',{name:'Сохранить продукты'}));
 await waitFor(()=>expect(mock.invoke).toHaveBeenCalledWith('sales-runtime-control',{body:{action:'knowledge_products',user_id:'user-scope',business_account_id:'business-scope',product_ids:['club-id'],expected_product_ids:[]}}));
});


it("settings open outside the composer and close without changing campaign state", async () => {
 mount();const trigger=await screen.findByRole('button',{name:'Настройки задержки автопродаж'});
 fireEvent.click(trigger);
 const dialog=await screen.findByRole('dialog',{name:'Настройки автопродаж'});
 expect(screen.getByTestId('sales-runtime-controls').contains(dialog)).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await waitFor(()=>expect(document.activeElement).toBe(trigger));
 expect(mock.invoke.mock.calls.every(([,args])=>args.body.action==='status')).toBe(true);
});
