import {
  type ComponentProps,
  createContext,
  type InputHTMLAttributes,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { Button as UiButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { type AiRun, useCustdevWorkspace } from "@/hooks/useCustdevWorkspace";
import { exportCustdevText } from "@/lib/custdev-export";
import {
  type Analysis,
  applicableQuestions,
  CATEGORIES,
  type Category,
  CATEGORY_LABELS,
  completionIssues,
  type CustdevState,
  emptyAnalysis,
  emptyWording,
  GROUPS,
  type Interview,
  type Need,
  needScores,
  newId,
  type Quote,
  refKey,
  type RespondentType,
  type Score,
  type Segment,
  sourceAnswers,
  syncInterview,
  TYPE_LABELS,
  TYPES,
  type Usp,
  type Wording,
} from "../../../../supabase/functions/_shared/custdev-contract";

const ReadOnly = createContext(false);
function Button(
  { viewAction = false, disabled, ...props }:
    & ComponentProps<typeof UiButton>
    & { viewAction?: boolean },
) {
  const readOnly = useContext(ReadOnly);
  return (
    <UiButton {...props} disabled={disabled || (!viewAction && readOnly)} />
  );
}
function CheckInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const readOnly = useContext(ReadOnly);
  return <input {...props} disabled={props.disabled || readOnly} />;
}
function Field(
  { label, value, onChange, area = false, type = "text" }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    area?: boolean;
    type?: string;
  },
) {
  const id = useId(), readOnly = useContext(ReadOnly);
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {area
        ? (
          <Textarea
            disabled={readOnly}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-20"
          />
        )
        : (
          <Input
            disabled={readOnly}
            id={id}
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
    </div>
  );
}
function SelectField(
  { label, value, onChange, options, navigation = false }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    navigation?: boolean;
  },
) {
  const id = useId(), readOnly = useContext(ReadOnly);
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        disabled={readOnly && !navigation}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
      >
        {options.map((o) => (
          <option value={o.value} key={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
const categoryOptions = CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
}));
const typeOptions = TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));
const rowClass = "rounded-lg border p-4 space-y-3 min-w-0";
const buttonClass = "h-auto min-h-10 whitespace-normal text-left";
const statusLabels = {
  draft: "Сохранено · в работе",
  submitted: "Завершено · ожидает проверки",
  approved: "Проверено администратором",
  changes_requested: "Нужны доработки",
};

export function CustdevWorkshop(
  { lessonId, blockId, ownerId, reviewMode = false, onSaved }: {
    lessonId: string;
    blockId: string;
    ownerId?: string;
    reviewMode?: boolean;
    onSaved?: () => void;
  },
) {
  const w = useCustdevWorkspace(
    lessonId,
    blockId,
    ownerId,
    reviewMode,
    onSaved,
  );
  const [open, setOpen] = useState<string[]>(["prepare"]),
    [segmentId, setSegmentId] = useState(""),
    [interviewId, setInterviewId] = useState("");
  const [importOpen, setImportOpen] = useState(false),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<AiRun | null>(null),
    [versionText, setVersionText] = useState<string | null>(null),
    [reviewNotes, setReviewNotes] = useState("");
  const [selectedQuotes, setSelectedQuotes] = useState<string[]>([]),
    [selectedNeeds, setSelectedNeeds] = useState<string[]>([]),
    [manualSource, setManualSource] = useState(""),
    [manualText, setManualText] = useState(""),
    [manualCategory, setManualCategory] = useState<Category>("problem");
  const state = w.state,
    active = state.segments.filter((s) => !s.archived),
    sid = active.some((s) => s.id === segmentId)
      ? segmentId
      : active[0]?.id ?? "",
    segment = active.find((s) => s.id === sid);
  const analysis = state.analyses[sid] ?? emptyAnalysis(),
    currentHash = w.hashes[sid] ?? "",
    stale = !!analysis.sourceHash && analysis.sourceHash !== currentHash;
  const interviews = state.interviews.filter((i) =>
      i.segmentId === sid && !i.archived
    ),
    interview = interviews.find((i) => i.id === interviewId) ?? interviews[0];
  const answers = sourceAnswers(state, sid),
    n = interviews.filter((i) => i.status === "completed").length;
  const categories = useMemo(
    () =>
      [
        ...new Set(
          w.sources.portfolio.map((p) => p.category).filter((c): c is string =>
            !!c
          ),
        ),
      ].sort(),
    [w.sources],
  );
  const previewAnalysis = state.analyses[preview?.segment_id ?? sid] ??
    emptyAnalysis();
  const products = w.sources.products,
    productTypes = products.filter((p) => p.kind === "client_type");
  const work = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  };
  const editAnalysis = (change: (a: Analysis) => void) =>
    w.edit((s) => {
      s.analyses[sid] ??= emptyAnalysis();
      change(s.analyses[sid]);
    });
  const editSegment = (id: string, change: (s: Segment) => void) =>
    w.edit((s) => {
      const target = s.segments.find((x) => x.id === id);
      if (target) change(target);
    });
  const editInterview = (id: string, change: (i: Interview) => void) =>
    w.edit((s) => {
      const target = s.interviews.find((x) => x.id === id);
      if (target) change(target);
    });
  const ai = (action: string, targetId?: string) =>
    work(async () => {
      const data = await w.action("ai", {
        aiAction: action,
        segmentId: action === "company" ? null : sid,
        targetId: targetId ?? null,
        requestId: newId(),
      });
      if (data.run?.status === "running") {
        throw new Error(
          "Анализ ещё выполняется. Откройте сохранённую версию в истории позже",
        );
      }
      if (data.run?.status !== "succeeded") {
        throw new Error("Версия ИИ не готова; рабочие данные сохранены");
      }
      setPreview(data.run);
    });
  const addInterview = () => {
    if (!segment) return;
    const id = newId();
    w.edit((s) =>
      s.interviews.push(
        syncInterview({
          id,
          segmentId: sid,
          name: "",
          type: "active",
          category: null,
          portfolioRef: null,
          date: "",
          status: "planned",
          answers: [],
        }, segment),
      )
    );
    setInterviewId(id);
  };
  const newNeed = (quoteIds: string[], label = "Новая потребность"): Need => ({
    id: newId(),
    label,
    category: analysis.quotes.find((q) => quoteIds.includes(q.id))?.category ??
      "problem",
    quoteIds,
    aiOriginal: null,
    overrides: {},
    approvedValue: null,
    excluded: false,
    priority: false,
  });
  const updateNeed = (id: string, change: (n: Need) => void) =>
    editAnalysis((a) => {
      const target = a.needs.find((n) => n.id === id);
      if (target) {
        change(target);
        target.approvedValue = null;
      }
    });
  const updateWording = (target: string, change: (p: Wording) => void) =>
    w.edit((s) => {
      if (target === "company") change(s.company);
      else {
        s.positioning[target] ??= emptyWording();
        change(s.positioning[target]);
      }
    });
  const updateUsp = (id: string, change: (u: Usp) => void) =>
    w.edit((s) => {
      const u = s.usps.find((u) => u.id === id);
      if (u) change(u);
    });
  const showSource = (q: Quote) => {
    setInterviewId(q.interviewId);
    setOpen((prev) => [...new Set([...prev, "interviews"])]);
    requestAnimationFrame(() =>
      document.getElementById(`custdev-answer-${q.sourceId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
    );
  };
  const wording = (p: Wording, target: string) => (
    <div className="space-y-3">
      {target !== "company" && (
        <>
          <Field
            label="Основная задача"
            value={p.task}
            onChange={(v) =>
              updateWording(target, (p) => {
                p.task = v;
              })}
          />
          <Field
            label="Специализация"
            value={p.specialization}
            onChange={(v) =>
              updateWording(target, (p) => {
                p.specialization = v;
              })}
          />
          <Field
            label="Значимое отличие"
            value={p.difference}
            onChange={(v) =>
              updateWording(target, (p) => {
                p.difference = v;
              })}
          />
          <div className="space-y-1">
            <Label>Потребности для позиционирования</Label>
            {analysis.needs.filter((n) =>
              !n.excluded && n.approvedValue?.sourceHash === currentHash
            ).map((n) => (
              <label className="flex gap-2 text-sm" key={n.id}>
                <CheckInput
                  type="checkbox"
                  checked={p.needIds.includes(n.id)}
                  onChange={(e) =>
                    updateWording(target, (p) => {
                      p.needIds = e.target.checked
                        ? [...p.needIds, n.id]
                        : p.needIds.filter((id) => id !== n.id);
                    })}
                />
                {n.label}
              </label>
            ))}
          </div>
        </>
      )}
      <Field
        label="Мой вариант позиционирования"
        value={p.userText}
        area
        onChange={(v) =>
          updateWording(target, (p) => {
            p.userText = v;
          })}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          className={buttonClass}
          variant="outline"
          disabled={busy || !w.canEdit}
          onClick={() =>
            void ai(target === "company" ? "company" : "positioning")}
        >
          Помощь ИИ
        </Button>
        <Button
          className={buttonClass}
          variant="outline"
          disabled={!p.userText.trim()}
          onClick={() =>
            updateWording(target, (p) => {
              p.approvedText = p.userText;
            })}
        >
          Оставить мой вариант
        </Button>
      </div>
      {p.aiText && (
        <div className="rounded-md bg-muted/40 p-3 space-y-2">
          <p className="text-sm font-medium">Отдельный вариант ИИ</p>
          <p className="whitespace-pre-wrap text-sm">{p.aiText}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                updateWording(target, (p) => {
                  p.approvedText = p.aiText;
                })}
            >
              Принять
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                updateWording(target, (p) => {
                  p.userText = p.aiText;
                })}
            >
              Редактировать как мой
            </Button>
          </div>
        </div>
      )}
      {p.approvedText && (
        <p className="whitespace-pre-wrap border-l-2 border-primary pl-3 text-sm">
          Утверждённый текст: {p.approvedText}
        </p>
      )}
    </div>
  );
  if (w.loading) return <p role="status">Загружаем ваше задание…</p>;
  if (w.error && !w.workspace && !w.canEdit) {
    return (
      <div role="alert" className={rowClass}>
        <p>{w.error}</p>
        <Button onClick={() => void w.reload()}>Повторить загрузку</Button>
      </div>
    );
  }
  return (
    <Card className="min-w-0" data-testid="custdev-workshop">
      <CardContent className="p-4 sm:p-6 space-y-5 min-w-0">
        <header className="space-y-3">
          <h2 className="text-xl font-semibold">
            Шаг 5. Кастдев, позиционирование и УТП
          </h2>
          <p className="text-sm text-muted-foreground">
            Исследуйте реальные ответы клиентов и сформулируйте предложение. ИИ
            помогает с анализом; выбранный приоритет и итоговые формулировки
            остаются за вами.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline">
              {statusLabels[w.workspace?.status ?? "draft"]}
            </Badge>
            <span role="status" className="text-sm">
              {{
                idle: "",
                pending: "Есть изменения",
                saving: "Сохраняем…",
                saved: "Сохранено",
                error: "Ошибка сохранения — черновик остаётся в браузере",
              }[w.saveStatus]}
            </span>
            <Button
              variant="outline"
              className={buttonClass}
              onClick={() =>
                void work(async () => {
                  await w.flush();
                  await navigator.clipboard.writeText(
                    exportCustdevText(w.getState()),
                  );
                  toast.success("Ответ скопирован текстом");
                })}
            >
              Скопировать ответ
            </Button>
          </div>
          {w.workspace?.review_notes && (
            <p className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap">
              Комментарий администратора: {w.workspace.review_notes}
            </p>
          )}
          {w.error && (
            <p role="alert" className="text-sm text-destructive">{w.error}</p>
          )}
          {w.conflict && (
            <Button
              variant="outline"
              onClick={() => void w.reload()}
            >
              Загрузить серверную версию и сравнить с черновиком
            </Button>
          )}
          {w.draft && w.canEdit && (
            <div className={rowClass}>
              <p>
                В браузере сохранился локальный черновик. Сначала сравните его с
                загруженной серверной версией.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setVersionText(exportCustdevText(w.draft!))}
                >
                  Посмотреть черновик
                </Button>
                <Button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Восстановить локальный черновик поверх текущей серверной версии? Проверьте обе версии перед заменой.",
                      )
                    ) w.restoreDraft();
                  }}
                >
                  Восстановить черновик
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Отбросить локальный черновик и оставить серверную версию?",
                      )
                    ) w.discardDraft();
                  }}
                >
                  Оставить серверную версию
                </Button>
              </div>
            </div>
          )}
          {w.sources.warnings.map((warning, i) => (
            <p key={i} className="text-sm text-amber-700 dark:text-amber-400">
              {warning}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">
            Для интервью используйте псевдонимы. Перед отправкой в ИИ уберите из
            ответов адреса, документы и реквизиты. Повторный анализ сначала
            создаёт отдельную версию.
          </p>
        </header>
        <ReadOnly.Provider value={!w.canEdit || w.conflict || busy}>
          <div className="min-w-0 space-y-4">
            <Accordion
              type="multiple"
              value={open}
              onValueChange={setOpen}
              className="w-full min-w-0"
            >
              <AccordionItem value="prepare">
                <AccordionTrigger className="text-left gap-3">
                  1. Подготовка кастдева{" "}
                  <span className="text-xs text-muted-foreground">
                    Сегментов: {active.length}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Рекомендуется 1–3 целевых сегмента. Экономическая категория
                    портфеля и целевой сегмент — разные понятия.
                  </p>
                  {active.map((s) => (
                    <div key={s.id} className={rowClass}>
                      <Field
                        label="Название целевого сегмента"
                        value={s.title}
                        onChange={(v) =>
                          editSegment(s.id, (s) => {
                            s.title = v;
                          })}
                      />
                      <Field
                        label="Подробное описание своими словами"
                        value={s.description}
                        area
                        onChange={(v) =>
                          editSegment(s.id, (s) => {
                            s.description = v;
                          })}
                      />
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Field
                          label="Кто принимает решение о покупке"
                          value={s.decisionMaker}
                          onChange={(v) =>
                            editSegment(s.id, (s) => {
                              s.decisionMaker = v;
                            })}
                        />
                        <Field
                          label="Почему выбран сегмент"
                          value={s.reason}
                          onChange={(v) =>
                            editSegment(s.id, (s) => {
                              s.reason = v;
                            })}
                        />
                      </div>
                      {productTypes.length > 0 && (
                        <div className="space-y-1">
                          <Label>
                            Связанные типы продукта из Шага 3 · необязательно
                          </Label>
                          {productTypes.map((p) => (
                            <label
                              key={p.id}
                              className="flex items-start gap-2 text-sm"
                            >
                              <CheckInput
                                type="checkbox"
                                checked={s.productTypeIds.includes(p.id)}
                                onChange={(e) =>
                                  editSegment(s.id, (s) => {
                                    s.productTypeIds = e.target.checked
                                      ? [...s.productTypeIds, p.id]
                                      : s.productTypeIds.filter((id) =>
                                        id !== p.id
                                      );
                                  })}
                              />
                              {p.name}
                            </label>
                          ))}
                        </div>
                      )}
                      <Accordion type="multiple">
                        {GROUPS.map((title, g) => {
                          const questions = s.questions.filter((q) =>
                            q.group === g + 1 && !q.archived
                          ).sort((a, b) => a.order - b.order);
                          return (
                            <AccordionItem value={String(g)} key={title}>
                              <AccordionTrigger className="text-left">
                                {g + 1}. {title} · {questions.length}/10
                              </AccordionTrigger>
                              <AccordionContent className="space-y-3">
                                {questions.map((q, idx) => (
                                  <div
                                    key={q.id}
                                    className="rounded-md border p-3 space-y-3"
                                  >
                                    <Field
                                      label={`Вопрос ${g + 1}.${idx + 1}`}
                                      value={q.text}
                                      area
                                      onChange={(v) =>
                                        editSegment(s.id, (s) => {
                                          s.questions.find((x) =>
                                            x.id === q.id
                                          )!.text = v;
                                        })}
                                    />
                                    <div className="flex flex-wrap gap-3">
                                      {TYPES.map((t) => (
                                        <label
                                          key={t}
                                          className="flex items-center gap-2 text-sm"
                                        >
                                          <CheckInput
                                            type="checkbox"
                                            checked={q.types.includes(t)}
                                            onChange={(e) => {
                                              if (
                                                !e.target.checked &&
                                                q.types.length === 1
                                              ) {
                                                toast.error(
                                                  "Оставьте хотя бы один тип",
                                                );
                                                return;
                                              }
                                              editSegment(s.id, (s) => {
                                                const x = s.questions.find(
                                                  (x) => x.id === q.id,
                                                )!;
                                                x.types = e.target.checked
                                                  ? [...x.types, t]
                                                  : x.types.filter((v) =>
                                                    v !== t
                                                  );
                                              });
                                            }}
                                          />
                                          {TYPE_LABELS[t]}
                                        </label>
                                      ))}
                                    </div>
                                    <Field
                                      label={`Комментарий к вопросу ${g + 1}.${
                                        idx + 1
                                      }`}
                                      value={q.note}
                                      onChange={(v) =>
                                        editSegment(s.id, (s) => {
                                          s.questions.find((x) =>
                                            x.id === q.id
                                          )!.note = v;
                                        })}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={idx === 0}
                                        aria-label={`Поднять вопрос ${g + 1}.${
                                          idx + 1
                                        }`}
                                        onClick={() =>
                                          editSegment(s.id, (s) => {
                                            const previous = questions[idx - 1];
                                            const target = s.questions.find(
                                              (x) => x.id === q.id,
                                            )!;
                                            const other = s.questions.find(
                                              (x) => x.id === previous.id,
                                            )!;
                                            [target.order, other.order] = [
                                              other.order,
                                              target.order,
                                            ];
                                          })}
                                      >
                                        Выше
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          if (
                                            window.confirm(
                                              "Убрать вопрос из плана? Уже записанные ответы и формулировки интервью сохранятся.",
                                            )
                                          ) {
                                            editSegment(s.id, (s) => {
                                              s.questions.find((x) =>
                                                x.id === q.id
                                              )!.archived = true;
                                            });
                                          }
                                        }}
                                      >
                                        Удалить вопрос
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                                <Button
                                  variant="outline"
                                  disabled={questions.length >= 10}
                                  onClick={() =>
                                    editSegment(s.id, (s) => {
                                      s.questions.push({
                                        id: newId(),
                                        group: g + 1,
                                        text: "",
                                        types: [...TYPES],
                                        note: "",
                                        order: Math.max(
                                          0,
                                          ...s.questions.filter((q) =>
                                            q.group === g + 1
                                          ).map((q) => q.order),
                                        ) + 1,
                                      });
                                    })}
                                >
                                  + Вопрос
                                </Button>
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                      </Accordion>
                      <Button
                        variant="ghost"
                        className={buttonClass}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Архивировать сегмент вместе с его историей? Интервью, анализ и УТП сохранятся и будут доступны после восстановления.",
                            )
                          ) {
                            editSegment(s.id, (s) => {
                              s.archived = true;
                            });
                          }
                        }}
                      >
                        Архивировать сегмент
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    onClick={() => {
                      const id = newId();
                      w.edit((s) =>
                        s.segments.push({
                          id,
                          title: "",
                          description: "",
                          decisionMaker: "",
                          reason: "",
                          productTypeIds: [],
                          questions: [],
                        })
                      );
                      setSegmentId(id);
                    }}
                  >
                    + Сегмент
                  </Button>
                  {state.segments.some((s) => s.archived) && (
                    <details>
                      <summary className="cursor-pointer text-sm">
                        Архив сегментов
                      </summary>
                      {state.segments.filter((s) => s.archived).map((s) => (
                        <div
                          className="flex justify-between gap-2 py-2"
                          key={s.id}
                        >
                          <span>{s.title || "Без названия"}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              editSegment(s.id, (s) => {
                                s.archived = false;
                              })}
                          >
                            Восстановить
                          </Button>
                        </div>
                      ))}
                    </details>
                  )}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="interviews">
                <AccordionTrigger className="text-left">
                  2. Проведение интервью ·{" "}
                  {state.interviews.filter((i) => !i.archived).length}
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <SelectField
                    navigation
                    label="Целевой сегмент интервью"
                    value={sid}
                    onChange={setSegmentId}
                    options={[
                      { value: "", label: "Выберите сегмент" },
                      ...active.map((s) => ({
                        value: s.id,
                        label: s.title || "Без названия",
                      })),
                    ]}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!segment}
                      onClick={() => {
                        setSelectedClients([]);
                        setImportOpen(true);
                      }}
                    >
                      Импортировать из портфеля
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!segment}
                      onClick={addInterview}
                    >
                      + Респондент
                    </Button>
                  </div>
                  <SelectField
                    navigation
                    label="Карточка интервью"
                    value={interview?.id ?? ""}
                    onChange={setInterviewId}
                    options={[
                      { value: "", label: "Выберите интервью" },
                      ...interviews.map((i, n) => ({
                        value: i.id,
                        label: i.name || `Респондент ${n + 1}`,
                      })),
                    ]}
                  />
                  {interview && segment && (
                    <div className={rowClass}>
                      <Field
                        label="Имя или псевдоним респондента"
                        value={interview.name}
                        onChange={(v) =>
                          editInterview(interview.id, (i) => {
                            i.name = v;
                          })}
                      />
                      <div className="grid sm:grid-cols-3 gap-3">
                        <SelectField
                          label="Тип респондента"
                          value={interview.type}
                          options={typeOptions}
                          onChange={(v) =>
                            editInterview(interview.id, (i) => {
                              i.type = v as RespondentType;
                              if (!i.portfolioRef && v !== "active") {
                                i.category = null;
                              }
                              Object.assign(i, syncInterview(i, segment));
                            })}
                        />
                        <Field
                          label="Дата интервью"
                          type="date"
                          value={interview.date}
                          onChange={(v) =>
                            editInterview(interview.id, (i) => {
                              i.date = v;
                            })}
                        />
                        <SelectField
                          label="Статус интервью"
                          value={interview.status}
                          options={[
                            { value: "planned", label: "Запланировано" },
                            { value: "in_progress", label: "В процессе" },
                            { value: "completed", label: "Проведено" },
                          ]}
                          onChange={(v) =>
                            editInterview(interview.id, (i) => {
                              i.status = v as Interview["status"];
                            })}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Экономическая категория портфеля:{" "}
                        {interview.category ?? "—"}
                      </p>
                      <Accordion type="multiple">
                        {GROUPS.map((group, g) => {
                          const visible = interview.answers.filter((a) =>
                            a.group === g + 1 &&
                            (applicableQuestions(segment, interview.type).some(
                              (q) => q.id === a.questionId,
                            ) || a.status !== "not_asked" || a.text ||
                              a.followups.length)
                          );
                          return (
                            <AccordionItem key={group} value={String(g)}>
                              <AccordionTrigger>
                                {g + 1}. {group} · {visible.length}
                              </AccordionTrigger>
                              <AccordionContent className="space-y-3">
                                {visible.map((a) => (
                                  <div
                                    key={a.id}
                                    id={`custdev-answer-${a.id}`}
                                    className={rowClass}
                                  >
                                    <p className="font-medium whitespace-pre-wrap">
                                      {a.snapshot ||
                                        "Формулировка ещё не заполнена"}
                                    </p>
                                    {segment.questions.find((q) =>
                                          q.id === a.questionId
                                        )?.text !== a.snapshot && (
                                      <p className="text-xs text-muted-foreground">
                                        Историческая формулировка: план вопроса
                                        позднее изменён.
                                      </p>
                                    )}
                                    <SelectField
                                      label="Статус ответа"
                                      value={a.status}
                                      options={[{
                                        value: "not_asked",
                                        label: "Не задавался",
                                      }, {
                                        value: "unanswered",
                                        label: "Без ответа",
                                      }, {
                                        value: "received",
                                        label: "Ответ получен",
                                      }]}
                                      onChange={(v) =>
                                        editInterview(interview.id, (i) => {
                                          i.answers.find((x) => x.id === a.id)!
                                            .status = v as typeof a.status;
                                        })}
                                    />
                                    <Field
                                      label="Ответ респондента, желательно дословно"
                                      value={a.text}
                                      area
                                      onChange={(v) =>
                                        editInterview(interview.id, (i) => {
                                          const x = i.answers.find((x) =>
                                            x.id === a.id
                                          )!;
                                          x.text = v;
                                          if (v.trim()) x.status = "received";
                                        })}
                                    />
                                    {a.followups.map((f) => (
                                      <div
                                        key={f.id}
                                        id={`custdev-answer-${f.id}`}
                                        className="border-l-2 pl-3 space-y-2"
                                      >
                                        <Field
                                          label="Уточняющий вопрос"
                                          value={f.question}
                                          onChange={(v) =>
                                            editInterview(interview.id, (i) => {
                                              i.answers.find((x) =>
                                                x.id === a.id
                                              )!.followups.find((x) =>
                                                x.id === f.id
                                              )!.question = v;
                                            })}
                                        />
                                        <Field
                                          label="Ответ на уточнение"
                                          value={f.answer}
                                          area
                                          onChange={(v) =>
                                            editInterview(interview.id, (i) => {
                                              i.answers.find((x) =>
                                                x.id === a.id
                                              )!.followups.find((x) =>
                                                x.id === f.id
                                              )!.answer = v;
                                            })}
                                        />
                                      </div>
                                    ))}
                                    <Button
                                      variant="outline"
                                      onClick={() =>
                                        editInterview(interview.id, (i) => {
                                          i.answers.find((x) => x.id === a.id)!
                                            .followups.push({
                                              id: newId(),
                                              question: "",
                                              answer: "",
                                            });
                                        })}
                                    >
                                      + Уточняющий вопрос
                                    </Button>
                                  </div>
                                ))}
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                      </Accordion>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Архивировать интервью? Записанные ответы сохранятся; анализ станет неактуальным.",
                            )
                          ) {
                            editInterview(interview.id, (i) => {
                              i.archived = true;
                            });
                          }
                        }}
                      >
                        Архивировать интервью
                      </Button>
                    </div>
                  )}
                  {state.interviews.some((i) =>
                    i.segmentId === sid && i.archived
                  ) && (
                    <details>
                      <summary>Архив интервью</summary>
                      {state.interviews.filter((i) =>
                        i.segmentId === sid && i.archived
                      ).map((i) => (
                        <div
                          key={i.id}
                          className="flex flex-wrap justify-between gap-2 py-2"
                        >
                          <span>{i.name || "Без имени"}</span>
                          <Button
                            variant="outline"
                            onClick={() =>
                              editInterview(i.id, (i) => {
                                i.archived = false;
                              })}
                          >
                            Восстановить
                          </Button>
                        </div>
                      ))}
                    </details>
                  )}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="analysis">
                <AccordionTrigger className="text-left">
                  3. Анализ результатов
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <SelectField
                    navigation
                    label="Сегмент анализа"
                    value={sid}
                    onChange={(v) => {
                      setSegmentId(v);
                      setSelectedQuotes([]);
                      setSelectedNeeds([]);
                    }}
                    options={[
                      { value: "", label: "Выберите сегмент" },
                      ...active.map((s) => ({
                        value: s.id,
                        label: s.title || "Без названия",
                      })),
                    ]}
                  />
                  <p className="text-sm">
                    Проведено интервью:{" "}
                    <strong>{n}</strong>. Содержательных ответов и уточнений:
                    {" "}
                    <strong>{answers.length}</strong>.
                  </p>
                  {n < 5 && (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Меньше пяти интервью: выводы предварительные. Это
                      рекомендация, а не запрет завершения.
                    </p>
                  )}
                  {stale && (
                    <p
                      role="alert"
                      className="text-sm text-amber-700 dark:text-amber-400"
                    >
                      Анализ устарел после изменения интервью, сегмента или
                      продуктовой матрицы. Сохранённые выводы и ручные правки
                      остаются в истории.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className={buttonClass}
                      disabled={busy || !answers.length}
                      onClick={() => void ai("quotes")}
                    >
                      1. Выделить цитаты
                    </Button>
                    <Button
                      variant="outline"
                      className={buttonClass}
                      disabled={busy ||
                        !analysis.quotes.some((q) =>
                          !q.excluded && !q.historical
                        ) || stale}
                      onClick={() => void ai("needs")}
                    >
                      2. Объединить по смыслу и предложить оценки
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {analysis.quotes.map((q) => (
                      <div
                        key={q.id}
                        className={`rounded-lg border p-3 space-y-2 ${
                          q.excluded ? "opacity-60" : ""
                        }`}
                      >
                        <label className="flex gap-2">
                          <CheckInput
                            type="checkbox"
                            disabled={q.historical || q.excluded}
                            checked={selectedQuotes.includes(q.id)}
                            onChange={(e) =>
                              setSelectedQuotes(
                                e.target.checked
                                  ? [...selectedQuotes, q.id]
                                  : selectedQuotes.filter((x) => x !== q.id),
                              )}
                          />
                          <span className="whitespace-pre-wrap">
                            «{q.text}»
                          </span>
                        </label>
                        {q.rationale && (
                          <p className="text-xs text-muted-foreground">
                            Обоснование ИИ: {q.rationale}
                          </p>
                        )}
                        {q.historical && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Историческая цитата: исходный ответ изменён.
                            Сохранена для сравнения, в новый расчёт не входит.
                          </p>
                        )}
                        <SelectField
                          label="Категория цитаты"
                          value={q.category}
                          options={categoryOptions}
                          onChange={(v) =>
                            editAnalysis((a) => {
                              const x = a.quotes.find((x) => x.id === q.id)!;
                              x.category = v as Category;
                              x.categoryOverridden = true;
                            })}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            viewAction
                            variant="link"
                            onClick={() => showSource(q)}
                          >
                            Источник:{" "}
                            {state.interviews.find((i) =>
                              i.id === q.interviewId
                            )?.name || "интервью"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              editAnalysis((a) => {
                                const x = a.quotes.find((x) => x.id === q.id)!;
                                x.excluded = !x.excluded;
                                for (const n of a.needs) n.approvedValue = null;
                              })}
                          >
                            {q.excluded ? "Вернуть цитату" : "Исключить цитату"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <details className={rowClass}>
                    <summary className="cursor-pointer font-medium">
                      Добавить цитату вручную
                    </summary>
                    <SelectField
                      label="Источник дословной цитаты"
                      value={manualSource}
                      options={[
                        { value: "", label: "Выберите ответ" },
                        ...answers.map((a) => ({
                          value: a.id,
                          label: `${
                            state.interviews.find((i) => i.id === a.interviewId)
                              ?.name || "Интервью"
                          }: ${a.question.slice(0, 80)}`,
                        })),
                      ]}
                      onChange={setManualSource}
                    />
                    {manualSource && (
                      <p className="whitespace-pre-wrap text-sm">
                        {answers.find((a) => a.id === manualSource)?.text}
                      </p>
                    )}
                    <Field
                      label="Дословный фрагмент ответа"
                      value={manualText}
                      area
                      onChange={setManualText}
                    />
                    <SelectField
                      label="Категория новой цитаты"
                      value={manualCategory}
                      options={categoryOptions}
                      onChange={(v) => setManualCategory(v as Category)}
                    />
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          await w.flush();
                          const source = sourceAnswers(w.getState(), sid).find(
                            (a) => a.id === manualSource,
                          );
                          if (
                            !source || !manualText.trim() ||
                            !source.text.includes(manualText)
                          ) {
                            throw new Error(
                              "Выберите точный фрагмент исходного ответа",
                            );
                          }
                          editAnalysis((a) => {
                            a.quotes.push({
                              id: newId(),
                              interviewId: source.interviewId,
                              questionId: source.questionId,
                              sourceId: source.id,
                              text: manualText,
                              category: manualCategory,
                              excluded: false,
                              manual: true,
                              sourceVersion: "",
                            });
                            a.sourceHash = w.getHashes()[sid] ?? "";
                          });
                          setManualText("");
                        })}
                    >
                      Добавить цитату
                    </Button>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!selectedQuotes.length}
                      onClick={() => {
                        editAnalysis((a) =>
                          a.needs.push(
                            newNeed(
                              selectedQuotes.filter((id) =>
                                a.quotes.some((q) =>
                                  q.id === id && !q.excluded && !q.historical
                                )
                              ),
                            ),
                          )
                        );
                        setSelectedQuotes([]);
                      }}
                    >
                      Создать потребность из выбранных цитат
                    </Button>
                    <Button
                      variant="outline"
                      disabled={selectedNeeds.length < 2}
                      onClick={() => {
                        editAnalysis((a) => {
                          const selected = a.needs.filter((n) =>
                            selectedNeeds.includes(n.id) && !n.excluded
                          );
                          if (selected.length < 2) return;
                          const merged = newNeed([
                            ...new Set(selected.flatMap((n) => n.quoteIds)),
                          ], selected.map((n) => n.label).join(" / "));
                          selected.forEach((n) => {
                            n.excluded = true;
                            n.approvedValue = null;
                          });
                          a.needs.push(merged);
                        });
                        setSelectedNeeds([]);
                      }}
                    >
                      Объединить выбранные потребности
                    </Button>
                  </div>
                  {analysis.needs.length > 0 && (
                    <div
                      className="hidden md:block max-w-full overflow-x-auto rounded-md border"
                      aria-label="Сводная таблица оценок"
                    >
                      <table className="w-full text-sm">
                        <caption className="text-left p-3 font-medium">
                          Потребности и оценки · итог рассчитывается при четырёх
                          заполненных оценках
                        </caption>
                        <thead>
                          <tr className="border-b">
                            {[
                              "Категория",
                              "Потребность",
                              "k/N",
                              "Повторяемость",
                              "Значимость",
                              "Влияние на покупку",
                              "Соответствие продукту",
                              "Итог",
                              "Проверено",
                            ].map((t) => (
                              <th className="p-2 text-left font-medium" key={t}>
                                {t}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.needs.filter((n) => !n.excluded).map(
                            (n) => {
                              const v = needScores(state, sid, n);
                              return (
                                <tr className="border-b align-top" key={n.id}>
                                  <td className="p-2">
                                    {CATEGORY_LABELS[n.category]}
                                  </td>
                                  <td className="p-2">{n.label}</td>
                                  <td className="p-2 whitespace-nowrap">
                                    {v.k}/{v.n}
                                  </td>
                                  {[
                                    v.frequency,
                                    v.significance,
                                    v.purchaseImpact,
                                    v.productFit,
                                    v.total,
                                  ].map((score, i) => (
                                    <td className="p-2" key={i}>
                                      {score ?? "—"}
                                    </td>
                                  ))}
                                  <td className="p-2">
                                    {n.approvedValue?.sourceHash ===
                                          currentHash && !stale
                                      ? "Да"
                                      : "Нет"}
                                  </td>
                                </tr>
                              );
                            },
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {analysis.needs.map((need) => {
                    const scores = needScores(state, sid, need);
                    return (
                      <div
                        key={need.id}
                        id={`custdev-need-${need.id}`}
                        className={`${rowClass} ${
                          need.excluded ? "opacity-60" : ""
                        }`}
                      >
                        <label className="flex items-center gap-2 text-sm">
                          <CheckInput
                            type="checkbox"
                            checked={selectedNeeds.includes(need.id)}
                            onChange={(e) =>
                              setSelectedNeeds(
                                e.target.checked
                                  ? [...selectedNeeds, need.id]
                                  : selectedNeeds.filter((id) =>
                                    id !== need.id
                                  ),
                              )}
                          />Выбрать потребность для объединения
                        </label>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <SelectField
                            label="Категория потребности"
                            value={need.category}
                            options={categoryOptions}
                            onChange={(v) =>
                              updateNeed(need.id, (n) => {
                                n.category = v as Category;
                              })}
                          />
                          <Field
                            label="Потребность"
                            value={need.label}
                            onChange={(v) =>
                              updateNeed(need.id, (n) => {
                                n.label = v;
                              })}
                          />
                        </div>
                        <p className="text-sm">
                          Уникальных интервью с упоминанием:{" "}
                          <strong>{scores.k}/{scores.n}</strong>. Рассчитанная
                          повторяемость:{" "}
                          <strong>{scores.computedFrequency ?? "—"}</strong>.
                        </p>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          {([
                            ["frequency", "Ручная поправка повторяемости"],
                            ["significance", "Значимость"],
                            ["purchaseImpact", "Влияние на покупку"],
                            ["productFit", "Соответствие продукту"],
                          ] as const).map(([key, label]) => (
                            <SelectField
                              key={key}
                              label={label}
                              value={need.overrides[key] !== undefined
                                ? String(need.overrides[key] ?? "")
                                : ""}
                              options={[
                                {
                                  value: "",
                                  label: key === "frequency"
                                    ? `По расчёту: ${
                                      scores.computedFrequency ?? "—"
                                    }`
                                    : `ИИ: ${
                                      need.aiOriginal?.[key] ??
                                        "требует проверки"
                                    }`,
                                },
                                ...[1, 2, 3, 4, 5].map((v) => ({
                                  value: String(v),
                                  label: String(v),
                                })),
                              ]}
                              onChange={(v) =>
                                updateNeed(need.id, (n) => {
                                  if (v) n.overrides[key] = Number(v);
                                  else delete n.overrides[key];
                                })}
                            />
                          ))}
                        </div>
                        <p className="text-sm font-medium">
                          Итог: {scores.total === null
                            ? "— · заполнены не все оценки"
                            : `${scores.total}/20`}
                        </p>
                        {!!need.aiOriginal?.productRefs?.length && (
                          <p className="text-sm text-muted-foreground">
                            Механизмы матрицы Шага 3:{" "}
                            {need.aiOriginal.productRefs.map((id) =>
                              products.find((p) => p.id === id)?.name ??
                                "Источник изменён; проверьте матрицу"
                            ).join(", ")}
                          </p>
                        )}
                        <Field
                          label="Обоснование и ручные замечания"
                          value={need.overrides.rationale ??
                            need.aiOriginal?.rationale ?? ""}
                          area
                          onChange={(v) => updateNeed(need.id, (n) => {
                            n.overrides.rationale = v;
                          })}
                        />
                        <details>
                          <summary className="cursor-pointer text-sm">
                            Цитаты и источники этой потребности
                          </summary>
                          {analysis.quotes.filter((q) =>
                            need.quoteIds.includes(q.id)
                          ).map((q) => (
                            <div
                              key={q.id}
                              className="border-l-2 pl-3 py-2 space-y-2"
                            >
                              <p className="whitespace-pre-wrap text-sm">
                                «{q.text}» · {CATEGORY_LABELS[q.category]}
                              </p>
                              <Button
                                viewAction
                                variant="link"
                                size="sm"
                                onClick={() => showSource(q)}
                              >
                                Открыть источник
                              </Button>
                              <SelectField
                                label="Перенести цитату в потребность"
                                value={need.id}
                                options={analysis.needs.filter((n) =>
                                  !n.excluded
                                ).map((n) => ({ value: n.id, label: n.label }))}
                                onChange={(v) =>
                                  editAnalysis((a) => {
                                    for (const n of a.needs) {
                                      n.quoteIds = n.quoteIds.filter((id) =>
                                        id !== q.id
                                      );
                                      n.approvedValue = null;
                                    }
                                    a.needs.find((n) => n.id === v)?.quoteIds
                                      .push(q.id);
                                  })}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  editAnalysis((a) => {
                                    const original = a.needs.find((n) =>
                                      n.id === need.id
                                    )!;
                                    original.quoteIds = original.quoteIds
                                      .filter((id) => id !== q.id);
                                    original.approvedValue = null;
                                    a.needs.push(
                                      newNeed(
                                        [q.id],
                                        "Уточните название выделенной потребности",
                                      ),
                                    );
                                  })}
                              >
                                Выделить в отдельную потребность
                              </Button>
                            </div>
                          ))}
                        </details>
                        <div className="flex flex-wrap gap-3 items-center">
                          <label className="flex items-center gap-2 text-sm">
                            <CheckInput
                              type="checkbox"
                              checked={need.approvedValue?.sourceHash ===
                                  currentHash && !stale}
                              disabled={stale || need.excluded ||
                                !analysis.sourceHash}
                              onChange={(e) =>
                                editAnalysis((a) => {
                                  const x = a.needs.find((n) =>
                                    n.id === need.id
                                  )!;
                                  x.approvedValue = e.target.checked
                                    ? {
                                      frequency: scores.frequency,
                                      significance: scores.significance,
                                      purchaseImpact: scores.purchaseImpact,
                                      productFit: scores.productFit,
                                      rationale: scores.rationale,
                                      sourceHash: currentHash,
                                    }
                                    : null;
                                })}
                            />Проверено мной
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <CheckInput
                              type="checkbox"
                              checked={need.priority}
                              onChange={(e) => updateNeed(need.id, (n) => {
                                n.priority = e.target.checked;
                              })}
                            />Выбираю в приоритет
                          </label>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              updateNeed(need.id, (n) => {
                                n.excluded = !n.excluded;
                              })}
                          >
                            {need.excluded
                              ? "Вернуть потребность"
                              : "Исключить потребность"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    Шкалы: повторяемость — интервалы по 20%; значимость — от
                    неудобства до критичных подтверждённых последствий; влияние
                    — от второстепенного пожелания до решающего фактора;
                    соответствие продукту — от «не решаем» до существующего
                    механизма Шага 3. При нехватке данных оценка не определена.
                    Рейтинг помогает выбрать приоритет.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="positioning">
                <AccordionTrigger className="text-left">
                  4. Позиционирование ·{" "}
                  {Number(!!state.company.approvedText.trim()) +
                    active.filter((s) =>
                      state.positioning[s.id]?.approvedText.trim()
                    ).length}/{active.length + 1}
                </AccordionTrigger>
                <AccordionContent className="space-y-5">
                  <p className="text-sm text-muted-foreground">
                    Мы работаем с [аудиторией], помогая решать [задачу],
                    специализируемся на [компетенции] и отличаемся от
                    альтернатив [значимым отличием].
                  </p>
                  <div className={rowClass}>
                    <h3 className="font-semibold">
                      Общее позиционирование компании
                    </h3>
                    {wording(state.company, "company")}
                  </div>
                  <SelectField
                    navigation
                    label="Сегмент для адаптации"
                    value={sid}
                    onChange={setSegmentId}
                    options={[
                      { value: "", label: "Выберите сегмент" },
                      ...active.map((s) => ({
                        value: s.id,
                        label: s.title || "Без названия",
                      })),
                    ]}
                  />
                  {segment && (
                    <div className={rowClass}>
                      <h3 className="font-semibold">{segment.title}</h3>
                      <p className="whitespace-pre-wrap text-sm">
                        {segment.description}
                      </p>
                      {wording(state.positioning[sid] ?? emptyWording(), sid)}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="usps">
                <AccordionTrigger className="text-left">
                  5. УТП · {state.usps.length}
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Решаем [проблему], обеспечивая [результат] благодаря
                    [механизму], эффективность подтверждается [доказательством].
                    Без доказательств предложение остаётся гипотезой.
                  </p>
                  <SelectField
                    navigation
                    label="Сегмент для УТП"
                    value={sid}
                    onChange={setSegmentId}
                    options={[
                      { value: "", label: "Выберите сегмент" },
                      ...active.map((s) => ({
                        value: s.id,
                        label: s.title || "Без названия",
                      })),
                    ]}
                  />
                  {state.usps.filter((u) => u.segmentId === sid).map((u) => (
                    <div key={u.id} className={rowClass}>
                      <Field
                        label="Название УТП"
                        value={u.title}
                        onChange={(v) =>
                          updateUsp(u.id, (u) => {
                            u.title = v;
                          })}
                      />
                      <SelectField
                        label="Утверждённая потребность · необязательно"
                        value={u.needId ?? ""}
                        options={[
                          { value: "", label: "Ручная формулировка проблемы" },
                          ...analysis.needs.filter((n) =>
                            n.approvedValue?.sourceHash === currentHash &&
                            !n.excluded
                          ).map((n) => ({ value: n.id, label: n.label })),
                        ]}
                        onChange={(v) =>
                          updateUsp(u.id, (u) => {
                            u.needId = v || null;
                            if (v) {
                              u.problem = analysis.needs.find((n) =>
                                n.id === v
                              )?.label ?? u.problem;
                            }
                          })}
                      />
                      <Field
                        label="Проблема клиента"
                        value={u.problem}
                        area
                        onChange={(v) =>
                          updateUsp(u.id, (u) => {
                            u.problem = v;
                          })}
                      />
                      <Field
                        label="Желаемый результат"
                        value={u.result}
                        area
                        onChange={(v) =>
                          updateUsp(u.id, (u) => {
                            u.result = v;
                          })}
                      />
                      <Field
                        label="Конкретный механизм достижения"
                        value={u.mechanism}
                        area
                        onChange={(v) =>
                          updateUsp(u.id, (u) => {
                            u.mechanism = v;
                          })}
                      />
                      <div className="space-y-1">
                        <Label>Связанные механизмы продукта Шага 3</Label>
                        {products.map((p) => (
                          <label key={p.id} className="flex gap-2 text-sm">
                            <CheckInput
                              type="checkbox"
                              checked={u.productRefs.includes(p.id)}
                              onChange={(e) =>
                                updateUsp(u.id, (u) => {
                                  u.productRefs = e.target.checked
                                    ? [...u.productRefs, p.id]
                                    : u.productRefs.filter((id) =>
                                      id !== p.id
                                    );
                                })}
                            />
                            {p.name}
                          </label>
                        ))}
                      </div>
                      <Field
                        label="Подтверждённое доказательство"
                        value={u.evidence}
                        area
                        onChange={(v) => updateUsp(u.id, (u) => {
                          u.evidence = v;
                          if (!v.trim()) u.status = "needs_evidence";
                        })}
                      />
                      <Field
                        label="Мой вариант УТП"
                        value={u.userText}
                        area
                        onChange={(v) => updateUsp(u.id, (u) => {
                          u.userText = v;
                        })}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void ai("usp", u.id)}
                        >
                          Помощь ИИ для УТП
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!u.userText.trim()}
                          onClick={() =>
                            updateUsp(u.id, (u) => {
                              u.approvedText = u.userText;
                            })}
                        >
                          Оставить мой вариант УТП
                        </Button>
                      </div>
                      {u.aiText && (
                        <div className="rounded-md bg-muted/40 p-3 space-y-2">
                          <p className="text-sm font-medium">
                            Отдельный вариант ИИ
                          </p>
                          <p className="whitespace-pre-wrap text-sm">
                            {u.aiText}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() =>
                                updateUsp(u.id, (u) => {
                                  u.approvedText = u.aiText;
                                })}
                            >
                              Принять вариант УТП
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() =>
                                updateUsp(u.id, (u) => {
                                  u.userText = u.aiText;
                                })}
                            >
                              Редактировать вариант УТП
                            </Button>
                          </div>
                        </div>
                      )}
                      {u.approvedText && (
                        <p className="text-sm whitespace-pre-wrap">
                          Утверждённый текст: {u.approvedText}
                        </p>
                      )}
                      <SelectField
                        label="Статус УТП"
                        value={u.status}
                        options={[{ value: "draft", label: "Черновик" }, {
                          value: "needs_evidence",
                          label: "Гипотеза · нужны доказательства",
                        }, { value: "ready", label: "Готово к проверке" }]}
                        onChange={(v) => {
                          if (v === "ready" && !u.evidence.trim()) {
                            toast.error(
                              "Добавьте доказательство или оставьте статус гипотезы",
                            );
                            return;
                          }
                          updateUsp(u.id, (u) => {
                            u.status = v as Usp["status"];
                          });
                        }}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Удалить это УТП? Утверждённые сдачи сохраняются в истории.",
                            )
                          ) {
                            w.edit((s) => {
                              s.usps = s.usps.filter((x) => x.id !== u.id);
                            });
                          }
                        }}
                      >
                        Удалить УТП
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    disabled={!segment}
                    onClick={() =>
                      w.edit((s) =>
                        s.usps.push({
                          id: newId(),
                          segmentId: sid,
                          title: "",
                          needId: null,
                          problem: "",
                          result: "",
                          mechanism: "",
                          productRefs: [],
                          evidence: "",
                          userText: "",
                          aiText: "",
                          approvedText: "",
                          status: "draft",
                        })
                      )}
                  >
                    + Добавить УТП
                  </Button>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </ReadOnly.Provider>
        {w.canEdit && (
          <div className="space-y-2">
            <Button
              className={buttonClass}
              disabled={busy || w.conflict}
              onClick={() =>
                void work(async () => {
                  await w.flush();
                  const issues = completionIssues(w.getState(), w.getHashes());
                  if (issues.length) throw new Error(issues.join(". "));
                  await w.action("submit", { state: w.getState() });
                  toast.success("Задание завершено и отправлено на проверку");
                  await w.reload();
                })}
            >
              Завершить и отправить на проверку
            </Button>
            <p className="text-xs text-muted-foreground">
              Сохранение черновика, завершение задания и проверка
              администратором — разные статусы.
            </p>
          </div>
        )}
        {w.isAdmin && reviewMode && (
          <div className={rowClass}>
            <h3 className="font-semibold">Проверка администратором</h3>
            <Field
              label="Комментарий к проверке"
              value={reviewNotes}
              area
              onChange={setReviewNotes}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || w.workspace?.status !== "submitted"}
                onClick={() =>
                  void work(async () => {
                    await w.action("review", {
                      status: "approved",
                      notes: reviewNotes,
                    });
                    toast.success("Результат проверен");
                    await w.reload();
                  })}
              >
                Утвердить результат
              </Button>
              <Button
                variant="outline"
                disabled={busy || w.workspace?.status !== "submitted"}
                onClick={() =>
                  void work(async () => {
                    await w.action("review", {
                      status: "changes_requested",
                      notes: reviewNotes,
                    });
                    await w.reload();
                  })}
              >
                Вернуть на доработку
              </Button>
            </div>
          </div>
        )}
        <details className="space-y-2">
          <summary className="cursor-pointer font-medium">
            История анализов и сдач
          </summary>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void work(async () => {
                await w.flush();
                await w.reload();
              })}
          >
            Обновить историю и источники
          </Button>
          {w.runs.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 text-sm py-1"
            >
              <span>
                {new Date(r.created_at).toLocaleString("ru-RU")} · {{
                  quotes: "Цитаты",
                  needs: "Потребности",
                  company: "Компания",
                  positioning: "Позиционирование",
                  usp: "УТП",
                }[r.action]} · {r.status === "succeeded"
                  ? "Готово"
                  : r.status === "failed"
                  ? "Сбой ИИ · ответы сохранены"
                  : "Выполняется"}
              </span>
              {r.status === "succeeded" && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() =>
                    void work(async () => {
                      const data = await w.action("run", { runId: r.id });
                      setPreview(data.run);
                    })}
                >
                  Посмотреть версию
                </Button>
              )}
            </div>
          ))}
          {w.versions.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center gap-2 text-sm py-1"
            >
              <span>
                Сдача №{v.revision} ·{" "}
                {statusLabels[v.status as keyof typeof statusLabels] ??
                  v.status}
              </span>
              <Button
                variant="link"
                size="sm"
                onClick={() =>
                  void work(async () => {
                    const data = await w.action("version", { versionId: v.id });
                    setVersionText(exportCustdevText(data.version.state));
                  })}
              >
                Посмотреть сдачу
              </Button>
            </div>
          ))}
          {(w.historyMore.runs || w.historyMore.versions) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await w.action("history", {
                    runsOffset: w.runs.length,
                    versionsOffset: w.versions.length,
                  });
                })}
            >
              Показать более ранние версии
            </Button>
          )}
        </details>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader className="pr-6 text-left">
              <DialogTitle>Импорт клиентов из портфеля Шага 2</DialogTitle>
            </DialogHeader>
            <SelectField
              label="Сегмент для импортируемых клиентов"
              value={sid}
              onChange={setSegmentId}
              options={[
                { value: "", label: "Выберите сегмент" },
                ...active.map((s) => ({
                  value: s.id,
                  label: s.title || "Без названия",
                })),
              ]}
            />
            <Field label="Поиск клиента" value={search} onChange={setSearch} />
            <SelectField
              label="Экономическая категория портфеля"
              value={category}
              onChange={setCategory}
              options={[
                { value: "", label: "Все категории" },
                ...categories.map((c) => ({ value: c, label: c })),
                { value: "__none", label: "Без категории" },
              ]}
            />
            <div className="space-y-2">
              {w.sources.portfolio.filter((p) =>
                p.name.toLocaleLowerCase().includes(
                  search.toLocaleLowerCase(),
                ) && (!category || (category === "__none"
                  ? !p.category
                  : p.category === category))
              ).map((p) => {
                const key = refKey(p.ref),
                  already = state.interviews.some((i) =>
                    i.segmentId === sid && i.portfolioRef &&
                    refKey(i.portfolioRef) === key
                  );
                return (
                  <label
                    key={key}
                    className="flex items-start gap-2 rounded-md border p-2 text-sm"
                  >
                    <CheckInput
                      type="checkbox"
                      disabled={already || !w.canEdit}
                      checked={selectedClients.includes(key)}
                      onChange={(e) =>
                        setSelectedClients(
                          e.target.checked
                            ? [...selectedClients, key]
                            : selectedClients.filter((v) => v !== key),
                        )}
                    />
                    <span>
                      {p.name} · {p.category ?? "Без категории"}
                      {already ? " · уже импортирован" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
            <Button
              disabled={!segment || !selectedClients.length || !w.canEdit}
              onClick={() => {
                w.edit((s) => {
                  for (
                    const p of w.sources.portfolio.filter((p) =>
                      selectedClients.includes(refKey(p.ref))
                    )
                  ) {
                    if (
                      !s.interviews.some((i) =>
                        i.segmentId === sid && i.portfolioRef &&
                        refKey(i.portfolioRef) === refKey(p.ref)
                      )
                    ) {
                      s.interviews.push(
                        syncInterview({
                          id: newId(),
                          segmentId: sid,
                          name: p.name,
                          type: "active",
                          category: p.category,
                          portfolioRef: p.ref,
                          date: "",
                          status: "planned",
                          answers: [],
                        }, segment!),
                      );
                    }
                  }
                });
                setImportOpen(false);
                setSelectedClients([]);
              }}
            >
              Импортировать выбранных
            </Button>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!preview}
          onOpenChange={(v) => {
            if (!v) setPreview(null);
          }}
        >
          <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
            <DialogHeader className="pr-6 text-left">
              <DialogTitle>
                Новая версия ИИ · предварительный просмотр
              </DialogTitle>
            </DialogHeader>
            {preview && (
              <>
                <p className="text-sm">
                  Сейчас в документе: {analysis.quotes.length} цитат,{" "}
                  {analysis.needs.filter((n) => !n.excluded).length}{" "}
                  потребностей. Потребностей с ручными правками:{" "}
                  {analysis.needs.filter((n) =>
                    Object.keys(n.overrides).length > 0
                  ).length}. Новая версия пока не применена.
                </p>
                {Array.isArray(preview.result?.output)
                  ? (
                    <div className="space-y-3">
                      {preview.result!.output.map((v, i: number) => (
                        <div
                          key={v.id ?? i}
                          className="rounded-md border p-3 text-sm space-y-1"
                        >
                          <p className="font-medium whitespace-pre-wrap">
                            {"text" in v ? `«${v.text}»` : v.label}
                          </p>
                          <p>
                            {CATEGORY_LABELS[
                              (v.category ?? "problem") as Category
                            ]}
                          </p>
                          {(() => {
                            const before = "quoteIds" in v
                              ? previewAnalysis.needs.find((n) =>
                                [...n.quoteIds].sort().join() ===
                                  [...v.quoteIds].sort().join()
                              )
                              : previewAnalysis.quotes.find((q) =>
                                q.sourceId === v.sourceId && q.text === v.text
                              );
                            return (
                              <p className="text-xs text-muted-foreground">
                                {before
                                  ? "Сопоставлено с текущей записью"
                                  : "Новая запись"}
                                {before && "label" in before
                                  ? ` · Сейчас: ${before.label}. Ручные оценки: ${
                                    Object.entries(before.overrides).map((
                                      [k, x],
                                    ) =>
                                      `${
                                        ({
                                          frequency: "повторяемость",
                                          significance: "значимость",
                                          purchaseImpact: "влияние",
                                          productFit: "соответствие",
                                          rationale: "обоснование",
                                        } as Record<string, string>)[k] ?? k
                                      }: ${x ?? "—"}`
                                    ).join(", ") ||
                                    "нет"
                                  }`
                                  : ""}
                              </p>
                            );
                          })()}
                          {"aiOriginal" in v && v.aiOriginal && (
                            <>
                              <p>
                                Предложение ИИ: значимость{" "}
                                {v.aiOriginal.significance ?? "—"}, влияние{" "}
                                {v.aiOriginal.purchaseImpact ?? "—"},
                                соответствие продукту{" "}
                                {v.aiOriginal.productFit ?? "требует проверки"}
                              </p>
                              <p className="whitespace-pre-wrap">
                                {v.aiOriginal.rationale}
                              </p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                  : (
                    <div className="space-y-3">
                      <p className="whitespace-pre-wrap">
                        {(preview.result
                          ?.output as import("../../../../supabase/functions/_shared/custdev-storage").WordingProposal)
                          ?.text}
                      </p>
                      {(preview.result
                        ?.output as import("../../../../supabase/functions/_shared/custdev-storage").WordingProposal)
                        ?.missing_evidence?.map((
                          v: string,
                          i: number,
                        ) => (
                          <p
                            key={i}
                            className="text-sm text-amber-700 dark:text-amber-400"
                          >
                            Требует проверки: {v}
                          </p>
                        ))}
                    </div>
                  )}
                {w.canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className={buttonClass}
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          await w.action("apply", {
                            runId: preview.id,
                            preserve: true,
                          });
                          setPreview(null);
                          toast.success(
                            "Новая версия применена, ручные правки сохранены",
                          );
                        })}
                    >
                      Применить, сохранив мои правки
                    </Button>
                    <Button
                      className={buttonClass}
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Заменить текущую группировку и ручные оценки новым анализом? Предыдущие AI-версии и сданные результаты останутся в истории.",
                          )
                        ) {
                          void work(async () => {
                            await w.action("apply", {
                              runId: preview.id,
                              preserve: false,
                              confirmReplace: true,
                            });
                            setPreview(null);
                          });
                        }
                      }}
                    >
                      Заменить ручные правки
                    </Button>
                  </div>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={versionText !== null}
          onOpenChange={(v) => {
            if (!v) setVersionText(null);
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
            <DialogHeader className="pr-6 text-left">
              <DialogTitle>Сохранённая версия · просмотр</DialogTitle>
            </DialogHeader>
            <pre className="text-sm whitespace-pre-wrap break-words font-sans">{versionText}</pre>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
