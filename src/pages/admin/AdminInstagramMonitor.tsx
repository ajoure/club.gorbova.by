import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Download,
  ExternalLink,
  Instagram,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  collectInstagramExport,
  instagramExportCsv,
  instagramExportEntities,
  instagramExportLabels,
  type InstagramExportPage,
  instagramWorkbook,
  saveInstagramFile,
} from "@/lib/instagramWorkspaceExport";

interface Profile {
  id: string;
  username: string;
  enabled: boolean;
  last_checked_at: string | null;
  latest_status: string | null;
  latest_error: string | null;
  imported_reels: number | null;
  reels_total: number;
}
interface Run {
  id: string;
  status: string;
  kind: string;
  created_at: string;
  cost_usd: number | null;
  error_code: string | null;
  provider_run_id: string | null;
  profile_id: string | null;
  reel_id: string | null;
  import_offset: number;
  reel: { shortcode: string; profile_id: string } | null;
}
interface Reel {
  id: string;
  profile_id: string;
  shortcode: string;
  post_url: string;
  caption: string;
  published_at: string | null;
  likes_count: number;
  comments_count: number;
  collected_comments_count: number;
  comments_coverage: string;
  coverage_reason: string | null;
  comments_checked_at: string | null;
  transcript: string | null;
  summary: string | null;
  transcript_status: string;
  storage_path: string | null;
}
interface Comment {
  id: string;
  text: string;
  username: string;
  posted_at: string | null;
  parent_comment_id: string | null;
  likes_count: number;
}
interface Snapshot {
  connected: boolean;
  ai_connected: boolean;
  enabled: boolean;
  auto_monitor: boolean;
  schedule_time: string;
  timezone: string;
  period: string;
  last_schedule_date: string | null;
  monthly_limit_usd: number;
  reserved_usd: number;
  actual_usd: number;
  max_run_usd: number;
  reels_per_run: number;
  run_timeout_seconds: number;
  include_replies: boolean;
  reels_total: number;
  runs_total: number;
  profiles: Profile[];
  runs: Run[];
  reels: Reel[];
}

async function api<T>(
  action: string,
  values: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("instagram-monitor", {
    body: { action, ...values },
  });
  if (error) {
    throw new Error(
      "Сервис недоступен. Проверьте подключение и попробуйте ещё раз.",
    );
  }
  if (!data?.ok) {
    throw new Error(data?.message || "Не удалось выполнить действие");
  }
  return data.result as T;
}

const statusLabels: Record<string, string> = {
  queued: "В очереди",
  starting: "Запуск",
  running: "Сбор",
  waiting: "Сбор / ожидание результата",
  succeeded: "Готово",
  failed: "Ошибка",
  importing: "Сохранение",
  done: "Готово",
  error: "Ошибка",
  unknown: "Нужна проверка запуска",
  skipped: "Пропущено",
  pending: "Ожидает расшифровки",
  processing: "Обработка",
  partial: "Неполные данные",
  available: "Результат Apify загружен",
};
const runKinds: Record<string, string> = {
  reels: "Сбор Reels",
  comments: "Комментарии",
  media: "Сохранение видео",
  transcribe: "Расшифровка Gemini",
};
const errorLabels: Record<string, string> = {
  monthly_budget_exhausted:
    "Лимит бесплатного пилота исчерпан. Новые сборы остановлены.",
  start_outcome_unknown:
    "Ответ Apify не подтверждён. Проверьте список запусков вручную перед повтором.",
  apify_http_401: "Проверьте API-ключ Apify в Интеграции → Соцсети → Apify.",
  apify_http_403: "Ключу Apify не хватает прав на запуск Actor.",
  profile_disabled: "Профиль выключен. Новый сбор не запускался.",
  missing_apify_token: "Ключ Apify пока не подключён.",
  missing_ai_key: "Gemini пока не подключён.",
  ai_credits_exhausted: "Закончились отдельные AI-кредиты Lovable.",
  ai_rate_limited:
    "Gemini временно ограничил запросы. Повторите вручную позже.",
  worker_interrupted:
    "Обработка прервана. Для расшифровки доступен ручной повтор.",
  provider_empty_result:
    "Apify не вернул доступные публикации или комментарии.",
  provider_profile_mismatch:
    "Apify вернул публикации без подтверждённого авторства выбранной страницы. Результат требует проверки.",
  duration_not_supported:
    "Не подтверждена длительность видео или она больше 5 минут.",
  media_too_large: "Видео превышает лимит 30 МБ.",
  media_fetch_403: "Источник видео больше недоступен. Нужен новый сбор.",
  transcript_empty: "Gemini не вернул достаточный текст для расшифровки.",
};
const label = (status: string) => statusLabels[status] || status;
const money = (amount: number) => `$${Number(amount || 0).toFixed(3)}`;

const coverageLabels: Record<string, string> = {
  provider_finished: "Весь результат Apify сохранён.",
  budget_limited: "Сбор остановлен ограничением бюджета.",
  timeout: "Истекло время сбора.",
  provider_stopped: "Apify завершился досрочно.",
  instagram_inaccessible: "Instagram не отдал часть комментариев.",
  replies_not_requested:
    "Часть комментариев недоступна или относится к платным ответам в ветках.",
  importing: "Продолжается импорт результата Apify.",
};
function InstagramPager({
  name,
  page,
  total,
  size,
  change,
}: {
  name: string;
  page: number;
  total: number;
  size: number;
  change: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button
        variant="outline"
        aria-label={`Предыдущая страница: ${name}`}
        disabled={page === 0}
        onClick={() => change(page - 1)}
      >
        Назад
      </Button>
      <span>
        {total ? Math.min(page * size + 1, total) : 0}–
        {Math.min((page + 1) * size, total)} из {total}
      </span>
      <Button
        variant="outline"
        aria-label={`Следующая страница: ${name}`}
        disabled={(page + 1) * size >= total}
        onClick={() => change(page + 1)}
      >
        Далее
      </Button>
    </div>
  );
}
export default function AdminInstagramMonitor() {
  const client = useQueryClient();
  const access = useAdminAccess();
  const canManage = access.canAccessSection("instagram-monitor", "manage");
  const [username, setUsername] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [video, setVideo] = useState<{ id: string; url: string } | null>(null);
  const [profileSearch, setProfileSearch] = useState("");
  const [profilesPage, setProfilesPage] = useState(0);
  const [profileFilter, setProfileFilter] = useState("");
  const [activeTab, setActiveTab] = useState("profiles");
  const [search, setSearch] = useState("");
  const [reelsPage, setReelsPage] = useState(0);
  const [runsPage, setRunsPage] = useState(0);
  const [commentsPage, setCommentsPage] = useState(0);
  const [commentSearch, setCommentSearch] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const exportCancel = useRef(false);
  const snapshot = useQuery({
    queryKey: ["instagram-monitor", profileFilter, search, reelsPage, runsPage],
    queryFn: () =>
      api<Snapshot>("status", {
        profile_id: profileFilter || undefined,
        search,
        reels_page: reelsPage,
        runs_page: runsPage,
      }),
    refetchInterval: 15_000,
  });
  const comments = useQuery({
    queryKey: [
      "instagram-monitor-comments",
      selected,
      commentsPage,
      commentSearch,
    ],
    queryFn: () =>
      api<{ rows: Comment[]; total: number }>("comments", {
        reel_id: selected,
        page: commentsPage,
        search: commentSearch,
      }),
    refetchInterval: selected ? 15_000 : false,
    enabled: !!selected,
  });
  const mutation = useMutation({
    mutationFn: ({
      action,
      ...values
    }: {
      action: string;
      [key: string]: unknown;
    }) => api<{ queued?: number; worker_notified?: boolean }>(action, values),
    onSuccess: (result, variables) => {
      client.invalidateQueries({ queryKey: ["instagram-monitor"] });
      client.invalidateQueries({ queryKey: ["instagram-monitor-comments"] });
      if (
        ["collect", "collect_all", "collect_comments", "transcribe"].includes(
          variables.action,
        )
      ) {
        toast.success(
          variables.action === "collect_all"
            ? `Поставлено в очередь: ${
              result.queued || 0
            }. Прогресс — во вкладке «Запуски».`
            : "Запрос в очереди. Прогресс — во вкладке «Запуски».",
        );
        if (result.worker_notified === false) {
          toast.info("Обработка начнётся на следующей минуте.");
        }
      } else toast.success("Изменения сохранены");
    },
    onError: (error) => toast.error(error.message),
  });
  const downloading = useMutation({
    mutationFn: async ({
      format,
      entity,
      reelId,
    }: {
      format: "csv" | "xlsx";
      entity?: string;
      reelId?: string;
    }) => {
      exportCancel.current = false;
      setExportProgress(0);
      const entities = entity ? [entity] : instagramExportEntities;
      const exported = await collectInstagramExport(
        (values) => api<InstagramExportPage>("export_page", values),
        entities,
        setExportProgress,
        reelId,
        () => exportCancel.current,
      );
      if (exportCancel.current) throw new Error("Выгрузка отменена");
      if (format === "xlsx") {
        saveInstagramFile(
          new Blob([await instagramWorkbook(exported)], {
            type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          "instagram-workspace.xlsx",
        );
      } else if (entity) {
        const value = exported[entity];
        saveInstagramFile(
          new Blob(["\uFEFF", instagramExportCsv(value.headers, value.rows)], {
            type: "text/csv;charset=utf-8",
          }),
          `instagram-${entity}.csv`,
        );
      } else {
        const headers = [
          ...new Set(Object.values(exported).flatMap((value) => value.headers)),
        ];
        const rows = Object.entries(exported).flatMap(([key, value]) =>
          value.rows.map((row) => [
            instagramExportLabels[key as keyof typeof instagramExportLabels],
            ...headers.map((header) => {
              const index = value.headers.indexOf(header);
              return index < 0 ? "" : row[index];
            }),
          ])
        );
        saveInstagramFile(
          new Blob(
            ["\uFEFF", instagramExportCsv(["Тип данных", ...headers], rows)],
            { type: "text/csv;charset=utf-8" },
          ),
          "instagram-workspace.csv",
        );
      }
    },
    onError: (error) => toast.error(error.message),
    onSuccess: () => toast.success("Выгрузка всех сохранённых строк готова"),
  });
  const downloadVideo = useMutation({
    mutationFn: async (id: string) => {
      const result = await api<{ url: string }>("video", {
        reel_id: id,
        download: true,
      });
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 60_000);
      let objectUrl: string | undefined;
      try {
        const response = await fetch(result.url, {
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        const maxBytes = 30 * 1024 * 1024;
        const contentType = response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim();
        if (
          !response.ok ||
          contentType !== "video/mp4" ||
          Number(response.headers.get("content-length")) > maxBytes
        ) {
          controller.abort();
          throw new Error("video_download_failed");
        }
        const blob = await response.blob();
        if (!blob.size || blob.size > maxBytes) {
          throw new Error("video_download_failed");
        }
        objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "instagram-reel.mp4";
        document.body.appendChild(link);
        try {
          link.click();
        } finally {
          link.remove();
        }
      } catch {
        throw new Error(
          "Не удалось скачать видео. Проверьте подключение и попробуйте ещё раз.",
        );
      } finally {
        window.clearTimeout(timeout);
        if (objectUrl) {
          const downloadUrl = objectUrl;
          window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
        }
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const play = useMutation({
    mutationFn: async (id: string) => {
      const result = await api<{ url: string }>("video", { reel_id: id });
      setVideo({ id, url: result.url });
    },
    onError: (error) => toast.error(error.message),
  });
  const data = snapshot.data;
  const filteredProfiles =
    data?.profiles.filter((p) =>
      p.username.toLowerCase().includes(profileSearch.toLowerCase())
    ) || [];
  const reel = data?.reels.find((item) => item.id === selected);
  const busy = mutation.isPending;

  return (
    <AdminLayout>
      <div className="space-y-5 p-4 md:p-6 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Instagram className="h-6 w-6 shrink-0" />
              Мониторинг Instagram
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Reels, вопросы аудитории и материалы для своих видео
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => snapshot.refetch()}
            disabled={snapshot.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        </div>
        {snapshot.isLoading && (
          <div role="status" className="flex gap-2">
            <Loader2 className="animate-spin h-5 w-5" />
            Загрузка мониторинга…
          </div>
        )}
        {snapshot.isError && (
          <Alert variant="destructive">
            <AlertDescription>{snapshot.error.message}</AlertDescription>
          </Alert>
        )}
        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Подключение</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Badge variant={data.connected ? "default" : "destructive"}>
                    Apify: {data.connected ? "подключён" : "ключ не настроен"}
                  </Badge>
                  <p className="text-sm">
                    Gemini: {data.ai_connected ? "доступен" : "не настроен"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Бюджет Apify за месяц
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">
                    {money(data.actual_usd)} / {money(data.monthly_limit_usd)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Зарезервировано: {money(data.reserved_usd)}. За запуск: до
                    {" "}
                    {money(data.max_run_usd)}.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Рабочий кабинет</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p>
                    До {data.reels_per_run}{" "}
                    роликов за сбор. Комментарии запрашиваются без выборочного
                    ограничения.
                  </p>
                  <p className="text-muted-foreground">
                    Расшифровка использует отдельные AI-кредиты Lovable. Лимит
                    расходов может остановить сбор. Бесплатный бюджет не
                    гарантирует ежедневный сбор всех страниц.
                  </p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Ежедневный сбор и выгрузка
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Все включённые страницы собираются по очереди. Один профиль
                  может занимать несколько минут. Состояние обновляется каждые
                  15 секунд; результаты появляются во вкладке Reels. При
                  исчерпании бюджета сбор останавливается.
                </p>
                {canManage && (
                  <div className="flex flex-wrap gap-3 items-end">
                    <Label className="flex items-center gap-2">
                      <Switch
                        checked={data.auto_monitor}
                        disabled={busy || !data.enabled}
                        onCheckedChange={(value) =>
                          mutation.mutate({
                            action: "settings",
                            auto_monitor: value,
                          })}
                      />
                      Ежедневно
                    </Label>
                    <Label className="space-y-1">
                      Время ежедневного запуска
                      <Input
                        aria-label="Время ежедневного запуска"
                        type="time"
                        defaultValue={data.schedule_time}
                        key={data.schedule_time}
                        disabled={busy}
                        onBlur={(event) => {
                          if (
                            event.target.value &&
                            event.target.value !== data.schedule_time
                          ) {
                            mutation.mutate({
                              action: "settings",
                              schedule_time: event.target.value,
                            });
                          }
                        }}
                      />
                    </Label>
                    <Label className="space-y-1">
                      Часовой пояс
                      <select
                        aria-label="Часовой пояс"
                        className="h-10 w-full rounded-md border bg-background px-3"
                        value={data.timezone}
                        disabled={busy}
                        onChange={(e) =>
                          mutation.mutate({
                            action: "settings",
                            timezone: e.target.value,
                          })}
                      >
                        <option value="Europe/Minsk">Минск (UTC+3)</option>
                        <option value="Europe/Warsaw">Варшава</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </Label>
                    <Label className="space-y-1">
                      Период по расписанию
                      <select
                        aria-label="Период по расписанию"
                        className="h-10 w-full rounded-md border bg-background px-3"
                        value={data.period}
                        disabled={busy}
                        onChange={(e) =>
                          mutation.mutate({
                            action: "settings",
                            period: e.target.value,
                          })}
                      >
                        <option value="previous_day">
                          За предыдущий день
                        </option>
                        <option value="recent">Последние ролики</option>
                      </select>
                    </Label>
                    <Label className="space-y-1">
                      Роликов за сбор
                      <Input
                        aria-label="Роликов за сбор"
                        type="number"
                        min={1}
                        max={100}
                        defaultValue={data.reels_per_run}
                        key={data.reels_per_run}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (value !== data.reels_per_run) {
                            mutation.mutate({
                              action: "settings",
                              reels_per_run: value,
                            });
                          }
                        }}
                      />
                    </Label>
                    <Label className="space-y-1">
                      Таймаут, секунд
                      <Input
                        aria-label="Таймаут, секунд"
                        type="number"
                        min={60}
                        max={600}
                        defaultValue={data.run_timeout_seconds}
                        key={data.run_timeout_seconds}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (value !== data.run_timeout_seconds) {
                            mutation.mutate({
                              action: "settings",
                              run_timeout_seconds: value,
                            });
                          }
                        }}
                      />
                    </Label>
                    <Button
                      disabled={busy || !data.enabled || !data.connected}
                      onClick={() => mutation.mutate({ action: "collect_all" })}
                    >
                      Собрать все страницы сейчас
                    </Button>
                    <Label className="flex items-center gap-2">
                      <Switch
                        checked={data.include_replies}
                        disabled={busy}
                        onCheckedChange={(value) =>
                          mutation.mutate({
                            action: "settings",
                            include_replies: value,
                          })}
                      />
                      Ответы в ветках — платная возможность Apify
                    </Label>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  {data.auto_monitor
                    ? `Расписание включено: ежедневно в ${data.schedule_time}, ${data.timezone}.`
                    : "Расписание выключено."} Последняя дата расписания:{" "}
                  {data.last_schedule_date || "ещё не запускалось"}. Ручная
                  кнопка собирает последние ролики независимо от периода
                  расписания. Лимит «Роликов за сбор» ограничивает объём одного
                  профиля, в том числе за предыдущий день.
                </p>
                <p className="text-xs text-muted-foreground">
                  Ответы в ветках на бесплатном тарифе Apify недоступны. Платный
                  тариф здесь не подключается. Счётчик Instagram может включать
                  скрытые комментарии и ответы.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={downloading.isPending}
                    onClick={() => downloading.mutate({ format: "xlsx" })}
                  >
                    Весь кабинет Excel
                  </Button>
                  <Button
                    variant="outline"
                    disabled={downloading.isPending}
                    onClick={() => downloading.mutate({ format: "csv" })}
                  >
                    Весь кабинет CSV
                  </Button>
                  {instagramExportEntities.map((entity) => (
                    <Button
                      key={entity}
                      variant="outline"
                      disabled={downloading.isPending}
                      onClick={() =>
                        downloading.mutate({ format: "csv", entity })}
                    >
                      {instagramExportLabels[entity]} CSV
                    </Button>
                  ))}
                </div>
                {downloading.isPending && (
                  <div
                    role="status"
                    className="flex flex-wrap gap-2 items-center"
                  >
                    Загружено строк: {exportProgress}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        exportCancel.current = true;
                      }}
                    >
                      Отменить выгрузку
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex h-auto flex-wrap justify-start">
                <TabsTrigger value="profiles">Профили</TabsTrigger>
                <TabsTrigger value="reels">
                  Ролики ({data.reels_total})
                </TabsTrigger>
                <TabsTrigger value="runs">Запуски</TabsTrigger>
              </TabsList>
              <TabsContent value="profiles" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Профили для мониторинга</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {canManage && (
                      <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          mutation.mutate(
                            { action: "add_profile", username },
                            {
                              onSuccess: () => setUsername(""),
                            },
                          );
                        }}
                      >
                        <Label htmlFor="instagram-profile" className="sr-only">
                          Публичный профиль Instagram
                        </Label>
                        <Input
                          id="instagram-profile"
                          className="flex-1 min-w-[180px]"
                          placeholder="@username или ссылка на профиль"
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          maxLength={150}
                        />
                        <Button disabled={busy || !username.trim()}>
                          Добавить профиль
                        </Button>
                      </form>
                    )}
                    <Input
                      aria-label="Найти страницу"
                      placeholder="Найти страницу"
                      value={profileSearch}
                      onChange={(event) => {
                        setProfileSearch(event.target.value);
                        setProfilesPage(0);
                      }}
                    />
                    {!data.profiles.length && (
                      <p className="text-muted-foreground">
                        Добавьте публичный профиль Катерины или конкурента.
                      </p>
                    )}
                    {filteredProfiles
                      .slice(profilesPage * 20, profilesPage * 20 + 20)
                      .map((profile) => (
                        <div
                          key={profile.id}
                          className="flex flex-wrap items-center justify-between gap-3 border rounded-lg p-3"
                        >
                          <div className="min-w-0">
                            <a
                              className="font-medium break-all hover:underline"
                              href={`https://www.instagram.com/${profile.username}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              @{profile.username}
                            </a>
                            <p className="text-xs text-muted-foreground">
                              {profile.latest_status
                                ? `${
                                  label(profile.latest_status)
                                } · Обработано в последнем сборе: ${
                                  profile.imported_reels || 0
                                }. `
                                : ""}
                              Сохранено роликов:{" "}
                              {profile.reels_total || 0}. Последняя проверка:
                              {" "}
                              {profile.last_checked_at
                                ? new Date(
                                  profile.last_checked_at,
                                ).toLocaleString("ru-RU")
                                : "ещё не запускалась"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 items-center">
                            {canManage && (
                              <>
                                <Label className="flex gap-2 items-center">
                                  <Switch
                                    checked={profile.enabled}
                                    disabled={busy}
                                    onCheckedChange={(enabled) =>
                                      mutation.mutate({
                                        action: "profile_enabled",
                                        profile_id: profile.id,
                                        enabled,
                                      })}
                                  />
                                  Включён
                                </Label>
                                <Button
                                  disabled={busy ||
                                    !data.connected ||
                                    !data.enabled ||
                                    !profile.enabled}
                                  onClick={() =>
                                    mutation.mutate({
                                      action: "collect",
                                      profile_id: profile.id,
                                    })}
                                >
                                  Собрать Reels
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    <InstagramPager
                      name="Страницы"
                      page={profilesPage}
                      total={filteredProfiles.length}
                      size={20}
                      change={setProfilesPage}
                    />
                    {canManage && (
                      <div className="space-y-3 border-t pt-3">
                        <Button variant="outline" asChild>
                          <a href="/admin/integrations/socials">
                            Настройки подключения Apify
                          </a>
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          При исчерпании бюджета новые запуски останавливаются.
                          Платный тариф автоматически не подключается.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="reels" className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Label className="sr-only" htmlFor="profile-filter">
                    Фильтр по странице
                  </Label>
                  <select
                    id="profile-filter"
                    className="border rounded-md h-10 px-3 max-w-full"
                    value={profileFilter}
                    onChange={(event) => {
                      setProfileFilter(event.target.value);
                      setReelsPage(0);
                      setSelected(null);
                    }}
                  >
                    <option value="">Все страницы</option>
                    {data.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        @{p.username}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="max-w-sm"
                    aria-label="Поиск роликов по описанию"
                    placeholder="Поиск по описанию ролика"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setReelsPage(0);
                      setSelected(null);
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={downloading.isPending || !data.reels.length}
                  onClick={() =>
                    downloading.mutate({ format: "csv", entity: "reels" })}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Выгрузить ролики CSV
                </Button>
                <div className="grid gap-3 lg:grid-cols-2">
                  {data.reels.map((item) => (
                    <Card key={item.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base break-all">
                          @
                          {data.profiles.find(
                            (profile) => profile.id === item.profile_id,
                          )?.username} · {item.shortcode}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm whitespace-pre-wrap break-words line-clamp-4">
                          {item.caption || "Без описания"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            Лайки: {item.likes_count}
                          </Badge>
                          <Badge variant="secondary">
                            Комментарии: {item.collected_comments_count} /{" "}
                            {item.comments_count}
                          </Badge>
                          <Badge
                            variant={["error", "failed"].includes(
                                item.transcript_status,
                              )
                              ? "destructive"
                              : "outline"}
                          >
                            {label(item.transcript_status)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelected(item.id);
                              setCommentsPage(0);
                              setCommentSearch("");
                            }}
                          >
                            Текст и комментарии
                          </Button>
                          {item.storage_path && (
                            <Button
                              variant="outline"
                              disabled={play.isPending}
                              onClick={() => play.mutate(item.id)}
                            >
                              Смотреть видео
                            </Button>
                          )}
                          {item.storage_path && (
                            <Button
                              variant="outline"
                              disabled={downloadVideo.isPending}
                              onClick={() => downloadVideo.mutate(item.id)}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Скачать MP4
                            </Button>
                          )}
                          <Button variant="ghost" asChild>
                            <a
                              href={item.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Instagram
                            </a>
                          </Button>
                        </div>
                        {video?.id === item.id && (
                          <video
                            key={video.url}
                            src={video.url}
                            controls
                            playsInline
                            className="w-full max-h-[420px] rounded-lg"
                          />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <InstagramPager
                  name="Ролики"
                  page={reelsPage}
                  total={data.reels_total}
                  size={20}
                  change={(value) => {
                    setReelsPage(value);
                    setSelected(null);
                  }}
                />
                {!data.reels.length && (
                  <p className="text-muted-foreground">
                    Здесь появятся собранные ролики. Запустите сбор на вкладке
                    «Профили».
                  </p>
                )}
                {reel && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex justify-between gap-2 items-center text-base">
                        {reel.shortcode}
                        <Button
                          variant="ghost"
                          onClick={() => setSelected(null)}
                        >
                          Закрыть
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h2 className="font-medium mb-2">
                          Дословная расшифровка
                        </h2>
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {reel.transcript || label(reel.transcript_status)}
                        </p>
                        {canManage &&
                          reel.storage_path &&
                          ["error", "failed", "pending"].includes(
                            reel.transcript_status,
                          ) && (
                          <Button
                            className="mt-2"
                            disabled={busy || !data.ai_connected}
                            onClick={() =>
                              mutation.mutate({
                                action: "transcribe",
                                reel_id: reel.id,
                              })}
                          >
                            Расшифровать через Gemini
                          </Button>
                        )}
                      </div>
                      {reel.summary && (
                        <div>
                          <h2 className="font-medium mb-2">
                            Краткое содержание
                          </h2>
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {reel.summary}
                          </p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 justify-between items-center">
                        <h2 className="font-medium">
                          Комментарии · {label(reel.comments_coverage)}
                        </h2>
                        <div className="flex flex-wrap gap-2">
                          {canManage && (
                            <Button
                              variant="outline"
                              disabled={busy || !data.connected ||
                                !data.enabled}
                              onClick={() =>
                                mutation.mutate({
                                  action: "collect_comments",
                                  reel_id: reel.id,
                                })}
                            >
                              Обновить комментарии
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            disabled={downloading.isPending}
                            onClick={() =>
                              downloading.mutate({
                                format: "csv",
                                entity: "comments",
                                reelId: reel.id,
                              })}
                          >
                            Выгрузить комментарии CSV
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Сохранено {reel.collected_comments_count} из{" "}
                        {reel.comments_count} по счётчику Instagram.{" "}
                        {coverageLabels[reel.coverage_reason || ""] ||
                          "Сбор ещё не завершён."}{" "}
                        Instagram может скрывать часть комментариев. Счётчик
                        публикации не равен числу доступных строк.
                      </p>
                      <Input
                        aria-label="Поиск комментариев"
                        placeholder="Найти вопрос или тему в комментариях"
                        value={commentSearch}
                        onChange={(event) => {
                          setCommentSearch(event.target.value);
                          setCommentsPage(0);
                        }}
                      />
                      <Button
                        variant="outline"
                        disabled={downloading.isPending}
                        onClick={() =>
                          downloading.mutate({
                            format: "xlsx",
                            entity: "comments",
                            reelId: reel.id,
                          })}
                      >
                        Комментарии Excel
                      </Button>
                      {comments.isLoading && <p>Загрузка комментариев…</p>}
                      {comments.isError && (
                        <Alert variant="destructive">
                          <AlertDescription>
                            {comments.error.message}
                          </AlertDescription>
                        </Alert>
                      )}
                      {comments.data?.rows.map((comment) => (
                        <div
                          key={comment.id}
                          className="border rounded-lg p-3 space-y-1"
                        >
                          <p className="text-xs text-muted-foreground break-all">
                            @{comment.username}
                            {comment.parent_comment_id && " · Ответ в ветке"}
                            {" "}
                            · Лайки: {comment.likes_count}
                            {comment.posted_at &&
                              ` · ${
                                new Date(comment.posted_at).toLocaleString(
                                  "ru-RU",
                                )
                              }`}
                          </p>
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {comment.text}
                          </p>
                        </div>
                      ))}
                      <InstagramPager
                        name="Комментарии"
                        page={commentsPage}
                        total={comments.data?.total || 0}
                        size={50}
                        change={setCommentsPage}
                      />
                      {comments.data?.rows.length === 0 && (
                        <p className="text-muted-foreground">
                          Комментарии ещё не собраны или недоступны.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="runs" className="space-y-3">
                <InstagramPager
                  name="Запуски"
                  page={runsPage}
                  total={data.runs_total}
                  size={20}
                  change={setRunsPage}
                />
                {data.runs.map((run) => (
                  <Card key={run.id}>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-sm">
                          {new Date(run.created_at).toLocaleString("ru-RU")} ·
                          {" "}
                          {runKinds[run.kind] || "Обработка"}
                        </span>
                        <Badge
                          variant={run.status === "error" ||
                              run.status === "failed" ||
                              run.status === "unknown"
                            ? "destructive"
                            : "outline"}
                        >
                          {label(run.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {run.kind === "transcribe"
                          ? "Используются отдельные AI-кредиты Lovable"
                          : run.kind === "media"
                          ? "Приватная копия видео"
                          : `Расход Apify: ${
                            run.cost_usd === null
                              ? "ожидается расчёт"
                              : money(run.cost_usd)
                          }`}
                      </p>
                      {run.error_code && (
                        <p className="text-sm">
                          {errorLabels[run.error_code] ||
                            (run.status === "unknown"
                              ? "Ответ Apify не подтверждён. Нужна ручная проверка запуска."
                              : "Не удалось обработать материал. Проверьте доступность источника и повторите позже.")}
                        </p>
                      )}
                      {run.provider_run_id && (
                        <a
                          className="text-sm underline"
                          href={`https://console.apify.com/actors/runs/${run.provider_run_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Открыть запуск Apify
                        </a>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {!data.runs.length && (
                  <p className="text-muted-foreground">Запусков пока нет.</p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
