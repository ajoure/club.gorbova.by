import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TicketChat } from "./TicketChat";

const mocks = vi.hoisted(() => ({ send: vi.fn(), mutate: vi.fn() }));
vi.mock("@/hooks/useTickets", () => ({
  useTicketMessages: () => ({ data: [], isLoading: false }),
  useSendMessage: () => ({ mutateAsync: mocks.send, isPending: false }),
  useMarkTicketRead: () => ({ mutate: mocks.mutate }),
  useEditTicketMessage: () => ({ mutate: mocks.mutate }),
  useDeleteTicketMessage: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator" } }) }));
vi.mock("@/hooks/useDisplayProfiles", () => ({ useDisplayProfiles: () => ({ data: new Map() }) }));
vi.mock("@/hooks/useTicketReactions", () => ({ useTicketReactions: () => ({ data: {} }), useToggleReaction: () => ({ mutate: mocks.mutate }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@/components/admin/VideoNoteRecorder", () => ({ VideoNoteRecorder: () => null }));
vi.mock("./TicketMessage", () => ({ TicketMessage: () => null }));

it("does not duplicate a pending ticket reply and retains text after failure for explicit retry", async () => {
  let reject: (error: Error) => void = () => {};
  mocks.send.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render(<TicketChat ticketId="ticket" isAdmin />);
  const editor = screen.getByPlaceholderText("Введите сообщение...");
  fireEvent.change(editor, { target: { value: "Неотправленный ответ" } });
  fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
  expect(mocks.send).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: "Enter" });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  expect(editor).toHaveValue("Неотправленный ответ");
  mocks.send.mockResolvedValue({ id: "sent" });
  await act(async () => fireEvent.keyDown(editor, { key: "Enter" }));
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(editor).toHaveValue("");
});
