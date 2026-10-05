import { useState } from "react";
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

interface Profile {
  id: string;
  username: string;
  enabled: boolean;
  last_checked_at: string | null;
}
interface Run {
  id: string;
  status: string;
  kind: string;
  created_at: string;
  cost_usd: number | null;
  error_code: string | null;
  provider_run_id: string | null;
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
}
interface Snapshot {
  connected: boolean;
  ai_connected: boolean;
  enabled: boolean;
  auto_monitor: boolean;
  monthly_limit_usd: number;
  reserved_usd: number;
  actual_usd: number;
  max_run_usd: number;
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
  importing: "Сохранение",
  done: "Готово",
  error: "Ошибка",
  unknown: "Нужна проверка запуска",
  skipped: "Пропущено",
  pending: "Ожидает расшифровки",
  processing: "Расшифровка",
  partial: "Частичная выборка",
};
const label = (status: string) => statusLabels[status] || status;
const money = (amount: number) => `$${Number(amount || 0).toFixed(3)}`;

export default function AdminInstagramMonitor() {
  const client = useQueryClient();
  const access = useAdminAccess();
  const canManage = access.canAccessSection("instagram-monitor", "manage");
  const [username, setUsername] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [video, setVideo] = useState<{ id: string; url: string } | null>(null);
  const snapshot = useQuery({
    queryKey: ["instagram-monitor"],
    queryFn: () => api<Snapshot>("status"),
    refetchInterval: 15_000,
  });
  const comments = useQuery({
    queryKey: ["instagram-monitor-comments", selected],
    queryFn: () => api<Comment[]>("comments", { reel_id: selected }),
    enabled: !!selected,
  });
  const mutation = useMutation({
    mutationFn: (
      { action, ...values }: { action: string; [key: string]: unknown },
    ) => api<unknown>(action, values),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["instagram-monitor"] });
      client.invalidateQueries({ queryKey: ["instagram-monitor-comments"] });
      toast.success("Изменения сохранены");
    },
    onError: (error) => toast.error(error.message),
  });
  const downloading = useMutation({
    mutationFn: async (reelId?: string) => {
      const result = await api<{ csv: string }>("export", { reel_id: reelId });
      const url = URL.createObjectURL(
        new Blob(["\uFEFF", result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = reelId ? "instagram-comments.csv" : "instagram-reels.csv";
      link.click();
      URL.revokeObjectURL(url);
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
  const reel = data?.reels.find((item) => item.id === selected);
  const busy = mutation.isPending;

  return (
    <AdminLayout>
      <div className="space-y-5 p-4 md:p-6 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Instagram className="h-6 w-6 shrink-0" />Мониторинг Instagram
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
            <RefreshCw className="mr-2 h-4 w-4" />Обновить
          </Button>
        </div>
        {snapshot.isLoading && (
          <div role="status" className="flex gap-2">
            <Loader2 className="animate-spin h-5 w-5" />Загрузка мониторинга…
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
                  <CardTitle className="text-base">Бесплатный пилот</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p>До 2 Reels за профиль и 15 комментариев к ролику.</p>
                  <p className="text-muted-foreground">
                    Расшифровка использует отдельные AI-кредиты Lovable.
                    Комментарии — частичная выборка.
                  </p>
                </CardContent>
              </Card>
            </div>
            <Tabs defaultValue="profiles">
              <TabsList className="flex h-auto flex-wrap justify-start">
                <TabsTrigger value="profiles">Профили</TabsTrigger>
                <TabsTrigger value="reels">
                  Ролики ({data.reels.length})
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
                          mutation.mutate({ action: "add_profile", username }, {
                            onSuccess: () => setUsername(""),
                          });
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
                    {!data.profiles.length && (
                      <p className="text-muted-foreground">
                        Добавьте публичный профиль Катерины или конкурента.
                      </p>
                    )}
                    {data.profiles.map((profile) => (
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
                            Последняя проверка: {profile.last_checked_at
                              ? new Date(profile.last_checked_at)
                                .toLocaleString("ru-RU")
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
                                />Включён
                              </Label>
                              <Button
                                disabled={busy || !data.connected ||
                                  !data.enabled || !profile.enabled}
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
                    {canManage && (
                      <div className="space-y-3 border-t pt-3">
                        <Label className="flex gap-3 items-center">
                          <Switch
                            disabled={busy || !data.connected}
                            checked={data.enabled}
                            onCheckedChange={(enabled) =>
                              mutation.mutate({ action: "settings", enabled })}
                          />Разрешить сбор в пределах бюджета
                        </Label>
                        <Label className="flex gap-3 items-center">
                          <Switch
                            disabled={busy || !data.connected || !data.enabled}
                            checked={data.auto_monitor}
                            onCheckedChange={(auto_monitor) =>
                              mutation.mutate({
                                action: "settings",
                                auto_monitor,
                              })}
                          />Проверять включённые профили раз в сутки
                        </Label>
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
                <Button
                  variant="outline"
                  disabled={downloading.isPending || !data.reels.length}
                  onClick={() => downloading.mutate(undefined)}
                >
                  <Download className="mr-2 h-4 w-4" />Выгрузить ролики CSV
                </Button>
                <div className="grid gap-3 lg:grid-cols-2">
                  {data.reels.map((item) => (
                    <Card key={item.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base break-all">
                          @{data.profiles.find((profile) =>
                            profile.id === item.profile_id
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
                            variant={item.transcript_status === "error"
                              ? "destructive"
                              : "outline"}
                          >
                            {label(item.transcript_status)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => setSelected(item.id)}
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
                          <Button variant="ghost" asChild>
                            <a
                              href={item.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />Instagram
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
                        {canManage && reel.storage_path &&
                          ["error", "pending"].includes(
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
                            onClick={() => downloading.mutate(reel.id)}
                          >
                            Выгрузить комментарии CSV
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Instagram может скрывать часть комментариев. Счётчик
                        публикации не равен числу доступных строк.
                      </p>
                      {comments.isLoading && <p>Загрузка комментариев…</p>}
                      {comments.isError && (
                        <Alert variant="destructive">
                          <AlertDescription>
                            {comments.error.message}
                          </AlertDescription>
                        </Alert>
                      )}
                      {comments.data?.map((comment) => (
                        <div
                          key={comment.id}
                          className="border rounded-lg p-3 space-y-1"
                        >
                          <p className="text-xs text-muted-foreground break-all">
                            @{comment.username}
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
                      {comments.data?.length === 0 && (
                        <p className="text-muted-foreground">
                          Комментарии ещё не собраны или недоступны.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="runs" className="space-y-3">
                {data.runs.map((run) => (
                  <Card key={run.id}>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-sm">
                          {new Date(run.created_at).toLocaleString("ru-RU")} ·
                          {" "}
                          {run.kind === "reels" ? "Reels" : "Комментарии"}
                        </span>
                        <Badge
                          variant={run.status === "error" ||
                              run.status === "unknown"
                            ? "destructive"
                            : "outline"}
                        >
                          {label(run.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Расход Apify: {run.cost_usd === null
                          ? "ожидается расчёт"
                          : money(run.cost_usd)}
                      </p>
                      {run.error_code && (
                        <p className="text-sm">{run.error_code}</p>
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
