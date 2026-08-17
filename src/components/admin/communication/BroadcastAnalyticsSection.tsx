import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  MessageCircle,
  MousePointerClick,
  ReceiptText,
  RefreshCw,
  Reply,
  Send,
  Users,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Channel = "telegram" | "email";

interface AnalyticsSummary {
  campaigns?: number;
  recipients?: number;
  unique_recipients?: number;
  accepted?: number;
  email_accepted?: number;
  telegram_accepted?: number;
  delivered?: number;
  open_signals?: number;
  unique_clicks?: number;
  replies?: number;
  failed?: number;
  skipped?: number;
  purchases?: number;
  direct_purchases?: number;
  assisted_purchases?: number;
}

interface DailyPoint {
  date: string;
  sent: number;
  clicks: number;
  replies: number;
  purchases: number;
}

interface CampaignRow extends AnalyticsSummary {
  id: string;
  name: string;
  status: string;
  source: string;
  send_mode: string;
  channels: Channel[];
  content_snapshot: {
    subject?: string;
    body_preview?: string;
    message_preview?: string;
    has_media?: boolean;
    media_type?: string | null;
  };
  started_at: string;
  finished_at: string | null;
  revenue_by_currency: Record<string, number>;
}

interface AnalyticsResponse {
  summary: AnalyticsSummary;
  revenue_by_currency: Record<string, number>;
  daily: DailyPoint[];
  campaigns: CampaignRow[];
  total_campaigns: number;
  limit: number;
  offset: number;
}

interface RecipientRow {
  id: string;
  channel: Channel;
  status: string;
  accepted_at: string | null;
  delivered_at: string | null;
  first_opened_at: string | null;
  first_clicked_at: string | null;
  first_replied_at: string | null;
  open_count: number;
  click_count: number;
  error_message: string | null;
  profile_id: string | null;
  full_name: string | null;
  email: string | null;
  telegram_username: string | null;
  segments: Array<{
    product_id: string | null;
    product_name: string | null;
    tariff_id: string | null;
    tariff_name: string | null;
    access_mode: string;
  }>;
  purchases: Array<{
    order_id: string | null;
    payment_id: string;
    amount: number;
    currency: string;
    paid_at: string;
    model: string;
    product_name: string | null;
    tariff_name: string | null;
  }>;
}

interface LinkRow {
  id: string;
  channel: Channel;
  url: string;
  label: string | null;
  unique_human_clicks: number;
  total_clicks: number;
  machine_clicks: number;
}

const PAGE_SIZE = 25;

type AnalyticsRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const analyticsRpc = supabase as unknown as AnalyticsRpcClient;

function percent(value = 0, base = 0) {
  return base > 0 ? `${Math.round((value / base) * 1000) / 10}%` : "—";
}

function formatRevenue(values: Record<string, number> | null | undefined) {
  const rows = Object.entries(values || {});
  if (!rows.length) return "—";
  return rows.map(([currency, amount]) => `${Number(amount).toLocaleString("ru-RU")} ${currency}`).join(" · ");
}

function channelLabel(channel: Channel) {
  return channel === "telegram" ? "Telegram" : "Email";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Черновик",
    running: "Выполняется",
    completed: "Завершена",
    partial: "Частично",
    failed: "Ошибка",
    cancelled: "Отменена",
    queued: "В очереди",
    accepted: "Принято сервисом",
    sent: "Отправлено",
    delivered: "Доставлено",
    bounced: "Возврат",
    skipped: "Пропущено",
  };
  return labels[status] || status;
}

function mediaTypeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    photo: "фото",
    animation: "GIF-анимация",
    video: "видео",
    audio: "аудио",
    video_note: "видеокружок",
    document: "файл",
  };
  return value ? labels[value] || "медиа" : "медиа";
}

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: typeof Users;
  tone?: "primary" | "success" | "danger";
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
          <div className={cn(
            "rounded-xl p-2.5",
            tone === "success" && "bg-emerald-500/10 text-emerald-600",
            tone === "danger" && "bg-destructive/10 text-destructive",
            tone === "primary" && "bg-primary/10 text-primary",
          )}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function BroadcastAnalyticsSection() {
  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [channel, setChannel] = useState<"all" | Channel>("all");
  const [productId, setProductId] = useState("all");
  const [tariffId, setTariffId] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<CampaignRow | null>(null);
  const [recipientPage, setRecipientPage] = useState(0);

  const { data: filterOptions } = useQuery({
    queryKey: ["broadcast-analytics-filters"],
    queryFn: async () => {
      const { data, error } = await analyticsRpc.rpc("admin_get_broadcast_analytics_filters", {});
      if (error) throw error;
      return data as {
        products: Array<{ id: string; name: string }>;
        tariffs: Array<{ id: string; name: string; product_id: string }>;
      };
    },
    staleTime: 5 * 60_000,
  });
  const products = filterOptions?.products || [];
  const tariffs = (filterOptions?.tariffs || []).filter((tariff) =>
    productId === "all" || tariff.product_id === productId
  );

  const analyticsQuery = useQuery({
    queryKey: ["broadcast-analytics", from, to, channel, productId, tariffId, page],
    queryFn: async () => {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toExclusiveIso = addDays(new Date(`${to}T00:00:00`), 1).toISOString();
      const { data, error } = await analyticsRpc.rpc("admin_get_broadcast_analytics", {
        _from: fromIso,
        _to: toExclusiveIso,
        _channel: channel === "all" ? null : channel,
        _product_id: productId === "all" ? null : productId,
        _tariff_id: tariffId === "all" ? null : tariffId,
        _limit: PAGE_SIZE,
        _offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return data as AnalyticsResponse;
    },
    placeholderData: (previous) => previous,
  });

  const recipientsQuery = useQuery({
    queryKey: ["broadcast-analytics-recipients", selected?.id, recipientPage],
    enabled: Boolean(selected),
    queryFn: async () => {
      const { data, error } = await analyticsRpc.rpc("admin_get_broadcast_campaign_recipients", {
        _campaign_id: selected!.id,
        _limit: PAGE_SIZE,
        _offset: recipientPage * PAGE_SIZE,
        _status: null,
      });
      if (error) throw error;
      return data as { items: RecipientRow[]; total: number; limit: number; offset: number };
    },
    placeholderData: (previous) => previous,
  });

  const linksQuery = useQuery({
    queryKey: ["broadcast-analytics-links", selected?.id],
    enabled: Boolean(selected),
    queryFn: async () => {
      const { data, error } = await analyticsRpc.rpc("admin_get_broadcast_campaign_links", {
        _campaign_id: selected!.id,
      });
      if (error) throw error;
      return (data || []) as LinkRow[];
    },
  });

  const data = analyticsQuery.data;
  const summary = data?.summary || {};
  const accepted = summary.accepted || 0;
  const emailAccepted = summary.email_accepted || 0;
  const canNext = (page + 1) * PAGE_SIZE < (data?.total_campaigns || 0);
  const chartData = useMemo(() => (data?.daily || []).map((row) => ({
    ...row,
    label: format(new Date(row.date), "dd.MM", { locale: ru }),
  })), [data?.daily]);

  const resetPagination = () => setPage(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Аналитика рассылок</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Отправки, доступные сигналы вовлечения и покупки из канонических заказов и платежей.
          </p>
        </div>
        <Button variant="outline" onClick={() => analyticsQuery.refetch()} disabled={analyticsQuery.isFetching}>
          <RefreshCw className={cn("mr-2 h-4 w-4", analyticsQuery.isFetching && "animate-spin")} />
          Обновить
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <DatePicker value={from} onChange={(value) => { setFrom(value); resetPagination(); }} label="С даты" />
          <DatePicker value={to} onChange={(value) => { setTo(value); resetPagination(); }} label="По дату" />
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground/80">Канал</span>
            <Select value={channel} onValueChange={(value) => { setChannel(value as typeof channel); resetPagination(); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все каналы</SelectItem>
                <SelectItem value="telegram">Telegram</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground/80">Продукт</span>
            <Select value={productId} onValueChange={(value) => { setProductId(value); setTariffId("all"); resetPagination(); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все продукты</SelectItem>
                {products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground/80">Тариф</span>
            <Select value={tariffId} onValueChange={(value) => { setTariffId(value); resetPagination(); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все тарифы</SelectItem>
                {tariffs.map((tariff) => <SelectItem key={tariff.id} value={tariff.id}>{tariff.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Как читать показатели</AlertTitle>
        <AlertDescription>
          Telegram не передаёт ботам факт прочтения. Для него доступны приём сообщения Telegram, клики, ответы и реакции.
          Открытие email — технический сигнал и может срабатывать из-за защиты почтового сервиса; надёжнее сравнивать клики, ответы и покупки.
          Текущий SMTP подтверждает приём письма, но не сообщает о доставке или возврате: эти значения появятся только после подключения событий почтового провайдера.
          Детальная статистика начинается с момента запуска этого журнала: прошлые открытия и клики восстановить задним числом нельзя.
        </AlertDescription>
      </Alert>

      {analyticsQuery.isError ? (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Не удалось загрузить аналитику</AlertTitle>
          <AlertDescription>{(analyticsQuery.error as Error).message}</AlertDescription>
        </Alert>
      ) : analyticsQuery.isLoading ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Уникальные получатели" value={summary.unique_recipients || 0} hint={`${summary.recipients || 0} участий в ${summary.campaigns || 0} кампаниях`} icon={Users} />
            <SummaryCard label="Принято сервисом" value={accepted} hint={`${summary.failed || 0} ошибок · ${summary.skipped || 0} пропущено`} icon={Send} tone="success" />
            <SummaryCard label="Доставлено" value={summary.delivered || 0} hint="если провайдер сообщает" icon={CheckCircle2} tone="success" />
            <SummaryCard label="Уникальные клики" value={summary.unique_clicks || 0} hint={percent(summary.unique_clicks, summary.recipients)} icon={MousePointerClick} />
            <SummaryCard label="Ответы" value={summary.replies || 0} hint={percent(summary.replies, summary.recipients)} icon={Reply} />
            <SummaryCard label="Сигналы открытия email" value={summary.open_signals || 0} hint={percent(summary.open_signals, emailAccepted)} icon={Eye} />
            <SummaryCard label="Покупки" value={summary.purchases || 0} hint={`${summary.direct_purchases || 0} после клика`} icon={ReceiptText} tone="success" />
            <SummaryCard label="Выручка" value={formatRevenue(data?.revenue_by_currency)} hint="за окно атрибуции" icon={CheckCircle2} tone="success" />
            <SummaryCard label="Ошибки" value={summary.failed || 0} hint={percent(summary.failed, summary.recipients)} icon={XCircle} tone="danger" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Динамика</CardTitle>
              <CardDescription>Отправки и действия по дням выбранного периода</CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ left: -18, right: 8 }}>
                      <defs>
                        <linearGradient id="broadcastSent" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} /><stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="sent" name="Принято" stroke="hsl(var(--primary))" fill="url(#broadcastSent)" strokeWidth={2} />
                      <Area type="monotone" dataKey="clicks" name="Клики" stroke="#8b5cf6" fill="transparent" strokeWidth={2} />
                      <Area type="monotone" dataKey="replies" name="Ответы" stroke="#10b981" fill="transparent" strokeWidth={2} />
                      <Area type="monotone" dataKey="purchases" name="Покупки" stroke="#f59e0b" fill="transparent" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="py-16 text-center text-sm text-muted-foreground">За выбранный период данных нет</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Рассылки</CardTitle>
              <CardDescription>Нажмите строку, чтобы увидеть получателей, ошибки, ссылки и покупки</CardDescription>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Рассылка</TableHead><TableHead>Каналы</TableHead><TableHead className="text-right">Получатели</TableHead><TableHead className="text-right">Клики</TableHead><TableHead className="text-right">Ответы</TableHead><TableHead className="text-right">Покупки</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(data?.campaigns || []).map((campaign) => (
                      <TableRow key={campaign.id} className="cursor-pointer" onClick={() => { setSelected(campaign); setRecipientPage(0); }}>
                        <TableCell><div className="max-w-xs"><p className="truncate font-medium">{campaign.name}</p><p className="text-xs text-muted-foreground">{format(new Date(campaign.started_at), "dd.MM.yyyy HH:mm")}</p></div></TableCell>
                        <TableCell><div className="flex gap-1">{campaign.channels.map((item) => <Badge key={item} variant="outline">{item === "telegram" ? <MessageCircle className="mr-1 h-3 w-3" /> : <Mail className="mr-1 h-3 w-3" />}{channelLabel(item)}</Badge>)}</div></TableCell>
                        <TableCell className="text-right tabular-nums">{campaign.recipients || 0}</TableCell>
                        <TableCell className="text-right tabular-nums">{campaign.unique_clicks || 0}</TableCell>
                        <TableCell className="text-right tabular-nums">{campaign.replies || 0}</TableCell>
                        <TableCell className="text-right tabular-nums">{campaign.purchases || 0}</TableCell>
                        <TableCell><Badge variant={campaign.status === "failed" ? "destructive" : "secondary"}>{statusLabel(campaign.status)}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 p-4 md:hidden">
                {(data?.campaigns || []).map((campaign) => (
                  <button key={campaign.id} type="button" onClick={() => { setSelected(campaign); setRecipientPage(0); }} className="w-full rounded-xl border bg-card p-4 text-left shadow-sm">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{campaign.name}</p><p className="mt-1 text-xs text-muted-foreground">{format(new Date(campaign.started_at), "dd.MM.yyyy HH:mm")}</p></div><Badge variant="secondary">{statusLabel(campaign.status)}</Badge></div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4"><div><p className="font-semibold">{campaign.recipients || 0}</p><p className="text-muted-foreground">адресатов</p></div><div><p className="font-semibold">{campaign.unique_clicks || 0}</p><p className="text-muted-foreground">кликов</p></div><div><p className="font-semibold">{campaign.replies || 0}</p><p className="text-muted-foreground">ответов</p></div><div><p className="font-semibold">{campaign.purchases || 0}</p><p className="text-muted-foreground">покупок</p></div></div>
                  </button>
                ))}
              </div>
              {!data?.campaigns?.length && <p className="py-16 text-center text-sm text-muted-foreground">Рассылок за выбранный период нет</p>}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Показано {page * PAGE_SIZE + (data?.campaigns?.length ? 1 : 0)}–{page * PAGE_SIZE + (data?.campaigns?.length || 0)} из {data?.total_campaigns || 0}</p>
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}><ArrowLeft className="mr-1 h-4 w-4" />Назад</Button><Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={!canNext}>Далее<ArrowRight className="ml-1 h-4 w-4" /></Button></div>
          </div>
        </>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="h-[92dvh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto p-4 sm:h-auto sm:max-h-[90vh] sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-8">{selected?.name}</DialogTitle>
            <DialogDescription>{selected ? `${format(new Date(selected.started_at), "dd MMMM yyyy, HH:mm", { locale: ru })} · ${selected.recipients || 0} получателей` : ""}</DialogDescription>
          </DialogHeader>

          {selected && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SummaryCard label="Принято" value={selected.accepted || 0} hint={`${selected.failed || 0} ошибок · ${selected.skipped || 0} пропущено`} icon={Send} tone="success" /><SummaryCard label="Клики" value={selected.unique_clicks || 0} hint={percent(selected.unique_clicks, selected.recipients)} icon={MousePointerClick} /><SummaryCard label="Ответы" value={selected.replies || 0} hint={percent(selected.replies, selected.recipients)} icon={Reply} /><SummaryCard label="Покупки" value={selected.purchases || 0} hint={formatRevenue(selected.revenue_by_currency)} icon={ReceiptText} tone="success" /></div>}

          {selected && (selected.content_snapshot?.subject || selected.content_snapshot?.body_preview || selected.content_snapshot?.message_preview || selected.content_snapshot?.has_media) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Содержание рассылки</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {selected.content_snapshot.subject && <p className="font-medium">{selected.content_snapshot.subject}</p>}
                {(selected.content_snapshot.message_preview || selected.content_snapshot.body_preview) && <p className="whitespace-pre-wrap text-muted-foreground">{selected.content_snapshot.message_preview || selected.content_snapshot.body_preview}</p>}
                {selected.content_snapshot.has_media && <Badge variant="outline">Вложение · {mediaTypeLabel(selected.content_snapshot.media_type)}</Badge>}
              </CardContent>
            </Card>
          )}

          {!!linksQuery.data?.length && <Card><CardHeader><CardTitle className="text-base">Ссылки</CardTitle></CardHeader><CardContent className="space-y-3">{linksQuery.data.map((link) => <div key={link.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-medium">{link.label || link.url}</p><p className="truncate text-xs text-muted-foreground">{link.url}</p></div><div className="flex shrink-0 gap-3 text-xs"><span>{link.unique_human_clicks} уник.</span><span className="text-muted-foreground">{link.total_clicks} всего</span>{link.machine_clicks > 0 && <span className="text-muted-foreground">{link.machine_clicks} техн.</span>}</div></div>)}</CardContent></Card>}

          <Card>
            <CardHeader><CardTitle className="text-base">Получатели и каналы</CardTitle><CardDescription>Статус каждой доставки и подтверждённые действия по контакту</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {recipientsQuery.isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div> : recipientsQuery.isError ? <Alert variant="destructive"><AlertDescription>{(recipientsQuery.error as Error).message}</AlertDescription></Alert> : (recipientsQuery.data?.items || []).map((recipient) => (
                <div key={recipient.id} className="rounded-xl border p-3 sm:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><p className="truncate font-medium">{recipient.full_name || recipient.email || recipient.telegram_username || "Контакт без имени"}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{recipient.email && <span>{recipient.email}</span>}{recipient.telegram_username && <span>@{recipient.telegram_username.replace(/^@/, "")}</span>}</div></div>
                    <div className="flex flex-wrap gap-1.5"><Badge variant="outline">{channelLabel(recipient.channel)}</Badge><Badge variant={recipient.status === "failed" || recipient.status === "bounced" ? "destructive" : "secondary"}>{statusLabel(recipient.status)}</Badge>{recipient.first_opened_at && <Badge className="bg-sky-500/10 text-sky-700 hover:bg-sky-500/10">Сигнал открытия</Badge>}{recipient.first_clicked_at && <Badge className="bg-violet-500/10 text-violet-700 hover:bg-violet-500/10">Клик</Badge>}{recipient.first_replied_at && <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10">Ответ</Badge>}{recipient.purchases?.length > 0 && <Badge className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/10">Покупка</Badge>}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {recipient.accepted_at && <span>Принято: {format(new Date(recipient.accepted_at), "dd.MM.yyyy HH:mm")}</span>}
                    {recipient.delivered_at && <span>Доставлено: {format(new Date(recipient.delivered_at), "dd.MM.yyyy HH:mm")}</span>}
                    {recipient.first_opened_at && <span>Открытие: {format(new Date(recipient.first_opened_at), "dd.MM.yyyy HH:mm")} ({recipient.open_count})</span>}
                    {recipient.first_clicked_at && <span>Клик: {format(new Date(recipient.first_clicked_at), "dd.MM.yyyy HH:mm")} ({recipient.click_count})</span>}
                    {recipient.first_replied_at && <span>Ответ: {format(new Date(recipient.first_replied_at), "dd.MM.yyyy HH:mm")}</span>}
                  </div>
                  {!!recipient.segments?.length && <div className="mt-3 flex flex-wrap gap-1.5">{recipient.segments.map((segment, index) => <Badge key={`${segment.product_id}-${segment.tariff_id}-${index}`} variant="outline">{segment.product_name || "Продукт"}{segment.tariff_name ? ` · ${segment.tariff_name}` : ""}</Badge>)}</div>}
                  {!!recipient.purchases?.length && <div className="mt-3 rounded-lg bg-amber-500/5 p-3 text-xs"><p className="font-medium text-amber-800">Покупки после рассылки</p>{recipient.purchases.map((purchase) => <p key={purchase.payment_id} className="mt-1 text-muted-foreground">{purchase.product_name || "Покупка"}{purchase.tariff_name ? ` · ${purchase.tariff_name}` : ""} · {Number(purchase.amount).toLocaleString("ru-RU")} {purchase.currency} · {format(new Date(purchase.paid_at), "dd.MM.yyyy HH:mm")} · {purchase.model === "direct_click" ? "после клика" : "после отправки"}</p>)}</div>}
                  {recipient.error_message && <p className="mt-3 text-xs text-destructive">{recipient.error_message}</p>}
                </div>
              ))}
              {!recipientsQuery.isLoading && !recipientsQuery.data?.items?.length && <p className="py-12 text-center text-sm text-muted-foreground">Получателей нет</p>}
              <div className="flex items-center justify-between pt-2"><p className="text-xs text-muted-foreground">Записей доставки: {recipientsQuery.data?.total || 0}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setRecipientPage((value) => Math.max(0, value - 1))} disabled={recipientPage === 0}>Назад</Button><Button variant="outline" size="sm" onClick={() => setRecipientPage((value) => value + 1)} disabled={(recipientPage + 1) * PAGE_SIZE >= (recipientsQuery.data?.total || 0)}>Далее</Button></div></div>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>
    </div>
  );
}
