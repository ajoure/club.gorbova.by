import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyAnalysis,
  emptyState,
} from "../../../../supabase/functions/_shared/custdev-contract";
const { mock } = vi.hoisted(() => ({ mock: { value: null as any } }));
vi.mock(
  "@/hooks/useCustdevWorkspace",
  () => ({ useCustdevWorkspace: () => mock.value }),
);
import { CustdevWorkshop } from "./CustdevWorkshop";
beforeEach(() => {
  const state = emptyState();
  state.segments = [{
    id: "s1",
    title: "Торговля",
    description: "Описание",
    decisionMaker: "Директор",
    reason: "Опыт",
    productTypeIds: [],
    questions: [{
      id: "q1",
      group: 1,
      text: "Что мешает?",
      types: ["active"],
      note: "",
      order: 1,
    }],
  }];
  state.interviews = [{
    id: "i1",
    segmentId: "s1",
    name: "Респондент",
    type: "active",
    category: null,
    portfolioRef: null,
    date: "",
    status: "completed",
    answers: [{
      id: "a1",
      questionId: "q1",
      snapshot: "Что мешает?",
      group: 1,
      text: "Теряем время",
      status: "received",
      followups: [],
    }],
  }];
  state.analyses.s1 = {
    ...emptyAnalysis(),
    sourceHash: "h1",
    quotes: [{
      id: "quote1",
      interviewId: "i1",
      questionId: "q1",
      sourceId: "a1",
      text: "Теряем время",
      category: "problem",
      excluded: false,
      manual: true,
      sourceVersion: "v",
    }],
  };
  mock.value = {
    state,
    workspace: { id: "w1", revision: 1, status: "submitted" },
    sources: {
      portfolio: [],
      products: [],
      context: {},
      lessons: [],
      warnings: [],
    },
    hashes: { s1: "h1" },
    loading: false,
    saveStatus: "saved",
    error: "",
    conflict: false,
    canEdit: false,
    isAdmin: true,
    runs: [],
    versions: [],
    historyMore: { runs: false, versions: false },
    draft: null,
    edit: vi.fn(),
    flush: vi.fn(),
    action: vi.fn(),
    reload: vi.fn(),
    getState: () => state,
    getHashes: () => ({ s1: "h1" }),
  };
});
afterEach(cleanup);
describe("custdev integrated lesson view", () => {
  it("admin can open every accordion and navigate students while edits stay disabled", () => {
    render(
      <CustdevWorkshop lessonId="l" blockId="b" ownerId="student" reviewMode />,
    );
    expect(screen.getByLabelText("Название целевого сегмента")).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Сегмент" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /2. Проведение интервью/ }),
    );
    expect(screen.getByLabelText("Карточка интервью")).not.toBeDisabled();
    expect(screen.getByLabelText("Имя или псевдоним респондента"))
      .toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /3. Анализ результатов/ }),
    );
    expect(screen.getByRole("button", { name: /Источник: Респондент/ })).not
      .toBeDisabled();
    expect(screen.getByLabelText("Сегмент анализа")).not.toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /4. Позиционирование/ }),
    );
    expect(screen.getByLabelText("Сегмент для адаптации")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /5. УТП/ }));
    expect(screen.getByLabelText("Сегмент для УТП")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Утвердить результат" })).not
      .toBeDisabled();
  });
  it("student sees save vs submit status and can add a next question using the existing block", () => {
    mock.value.canEdit = true;
    mock.value.isAdmin = false;
    mock.value.workspace.status = "draft";
    render(<CustdevWorkshop lessonId="l" blockId="b" />);
    expect(screen.getByText("Черновик")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /1. Исходная ситуация/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Вопрос" }));
    expect(mock.value.edit).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Завершить и отправить на проверку" }),
    ).toBeInTheDocument();
  });
});
it("loads earlier history pages through the same authorized endpoint", async () => {
  mock.value.historyMore = { runs: true, versions: false };
  render(<CustdevWorkshop lessonId="l" blockId="b" />);
  fireEvent.click(screen.getByText("История анализов и сдач"));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Показать более ранние версии" }),
    );
    await Promise.resolve();
  });
  expect(mock.value.action).toHaveBeenCalledWith("history", {
    runsOffset: 0,
    versionsOffset: 0,
  });
});

it("help stays available in administrator read-only review without editing the student answer", () => {
  render(
    <CustdevWorkshop lessonId="l" blockId="b" ownerId="student" reviewMode />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Подсказка: Название целевого сегмента",
    }),
  );
  expect(
    screen.getByRole("dialog", {
      name: "Подсказка: Название целевого сегмента",
    }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Название целевого сегмента")).toBeDisabled();
  expect(mock.value.edit).not.toHaveBeenCalled();
});

it("retains Russian, Belarusian, Latin, punctuation, emoji and line breaks in field edits", () => {
  mock.value.canEdit = true;
  mock.value.workspace.status = "draft";
  const { rerender } = render(<CustdevWorkshop lessonId="l" blockId="b" />);
  mock.value.edit.mockImplementation((change: any) => {
    change(mock.value.state);
    rerender(<CustdevWorkshop lessonId="l" blockId="b" />);
  });
  const title = 'ООО «Ёлка & Co» — Ўлік + Café 🚀 №7 <не HTML> "тест"';
  const description =
    "Первая строка: 100% / 50 BYN\nДругая строка — ё, ї, ў, ć, ą; #@[]{}=+!?";
  fireEvent.change(screen.getByLabelText("Название целевого сегмента"), {
    target: { value: title },
  });
  fireEvent.change(screen.getByLabelText("Подробное описание своими словами"), {
    target: { value: description },
  });
  expect(screen.getByLabelText("Название целевого сегмента")).toHaveValue(
    title,
  );
  expect(screen.getByLabelText("Подробное описание своими словами"))
    .toHaveValue(description);
  expect(mock.value.state.segments[0].title).toBe(title);
  expect(mock.value.state.segments[0].description).toBe(description);
  expect(screen.getByLabelText("Название целевого сегмента"))
    .toHaveAccessibleDescription(
      "Группа клиентов с похожими задачами и условиями работы.",
    );
});

it("archives only after explicit in-page confirmation and preserves data on Cancel", async () => {
  mock.value.canEdit = true;
  mock.value.workspace.status = "draft";
  render(<CustdevWorkshop lessonId="l" blockId="b" />);
  const nativeConfirm = vi.spyOn(window, "confirm");
  fireEvent.click(
    screen.getByRole("button", { name: "Архивировать сегмент" }),
  );
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "Интервью, анализ и УТП сохранятся",
  );
  expect(mock.value.edit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  );
  expect(mock.value.edit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Архивировать сегмент" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Подтвердить" }),
  );
  expect(mock.value.edit).toHaveBeenCalledTimes(1);
  const changed = structuredClone(mock.value.state);
  mock.value.edit.mock.calls[0][0](changed);
  expect(changed.segments[0].archived).toBe(true);
  expect(changed.interviews).toEqual(mock.value.state.interviews);
  expect(nativeConfirm).not.toHaveBeenCalled();
  nativeConfirm.mockRestore();
});

it("keeps native choices and respondent-type selection usable with guidance present", () => {
  mock.value.canEdit = true;
  mock.value.workspace.status = "draft";
  const { rerender } = render(<CustdevWorkshop lessonId="l" blockId="b" />);
  mock.value.edit.mockImplementation((change: any) => {
    change(mock.value.state);
    rerender(<CustdevWorkshop lessonId="l" blockId="b" />);
  });
  fireEvent.click(screen.getByRole("button", { name: /1. Исходная ситуация/ }));
  fireEvent.click(screen.getByLabelText("Бывший"));
  fireEvent.click(screen.getByLabelText("Потенциальный"));
  expect(mock.value.state.segments[0].questions[0].types).toEqual([
    "active",
    "former",
    "prospect",
  ]);
  fireEvent.click(
    screen.getByRole("button", { name: /2. Проведение интервью/ }),
  );
  fireEvent.change(screen.getByLabelText("Тип респондента"), {
    target: { value: "prospect" },
  });
  fireEvent.change(screen.getByLabelText("Статус интервью"), {
    target: { value: "in_progress" },
  });
  expect(screen.getByLabelText("Тип респондента")).toHaveValue("prospect");
  expect(screen.getByLabelText("Статус интервью")).toHaveValue("in_progress");
  expect(screen.getByRole("button", { name: "Подсказка: Тип респондента" }))
    .toBeEnabled();
});
