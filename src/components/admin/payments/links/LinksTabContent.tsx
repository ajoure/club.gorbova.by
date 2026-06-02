import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link2, Search, Plus, RefreshCw, MoreHorizontal, Copy, ExternalLink, Ban, Edit, Eye } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { supabase } from "@/integrations/supabase/client";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { buildPublicPayUrl } from "@/utils/buildPublicPaymentUrl";
import { usePaymentLinks, type PaymentLinkRow } from "@/hooks/usePaymentLinks";
import { LinkStatusBadge } from "./LinkStatusBadge";
import { LinkDetailsDrawer } from "./LinkDetailsDrawer";
import { AdminPaymentLinkDialog } from "@/components/admin/AdminPaymentLinkDialog";
import { EditPaymentLinkDialog } from "./EditPaymentLinkDialog";

type StatusFilter = "all" | "active" | "invalidated" | "expired" | "exhausted";
type TypeFilter = "all" | "one_time" | "subscription";
type AssignFilter = "all" | "assigned" | "unassigned";
type PaidFilter = "all" | "paid" | "unpaid";
// Phase 1 Stripe Integration — provider filter
type ProviderFilter = "all" | "bepaid" | "stripe";

export function LinksTabContent() {
  const qc = useQueryClient();
  const { data: links, isLoading, refetch, isFetching } = usePaymentLinks();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [assignFilter, setAssignFilter] = useState<AssignFilter>("all");
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [detailsLink, setDetailsLink] = useState<PaymentLinkRow | null>(null);
  const [editLink, setEditLink] = useState<PaymentLinkRow | null>(null);
  const [invalidateLink, setInvalidateLink] = useState<PaymentLinkRow | null>(null);

  const filtered = useMemo(() => {
    if (!links) return [];
    const q = search.trim().toLowerCase();
    return links.filter((l) => {
      if (statusFilter !== "all") {
        if (statusFilter === "active" && (l.status !== "active" || l.is_invalid)) return false;
        if (statusFilter === "invalidated" && l.status !== "invalidated") return false;
        if (statusFilter === "expired" && !l.is_expired) return false;
        if (statusFilter === "exhausted" && !l.is_exhausted) return false;
      }
      if (typeFilter !== "all" && l.payment_type !== typeFilter) return false;
      if (assignFilter === "assigned" && !l.user_id) return false;
      if (assignFilter === "unassigned" && l.user_id) return false;
      if (paidFilter === "paid" && (l.paid_orders_count ?? 0) === 0) return false;
      if (paidFilter === "unpaid" && (l.paid_orders_count ?? 0) > 0) return false;

      // Phase 1 Stripe Integration — provider filter (All | bePaid | Stripe)
      if (providerFilter !== "all") {
        const prov = l.provider ?? "bepaid";
        if (prov !== providerFilter) return false;
      }

      if (q) {
        const hay = [
          l.url_token, l.product_name, l.tariff_name, l.offer_title,
          l.recipient_email, l.recipient_name, l.creator_email, l.creator_name,
          l.description,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [links, search, statusFilter, typeFilter, assignFilter, paidFilter, providerFilter]);

  const invalidateMutation = useMutation({
    mutationFn: async (link: PaymentLinkRow) => {
      const { data, error } = await supabase.functions.invoke("admin-invalidate-payment-link", {
        body: { payment_link_id: link.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Не удалось сделать ссылку недействительной");
      return data;
    },
    onSuccess: () => {
      toast.success("Ссылка сделана недействительной");
      qc.invalidateQueries({ queryKey: ["payment-links-enriched"] });
      setInvalidateLink(null);
    },
    onError: (e) => {
      toast.error("Ошибка: " + (e as Error).message);
    },
  });

  // Канонический URL берём ИЗ БД (заполняется writer'ом admin-create-public-link).
  // Фолбэк buildPublicPayUrl нужен только для исторических строк, где public_url отсутствует —
  // backfill в БД должен был покрыть все строки, но защищаемся от регрессии.
  const buildPublicUrl = (link: PaymentLinkRow) =>
    link.public_url ?? buildPublicPayUrl(link.url_token);

  const formatAmount = (kop: number, cur: string) =>
    `${(kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

  return (
    <div className="space-y-3 pt-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по токену, продукту, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="invalidated">Недействительные</SelectItem>
            <SelectItem value="expired">Истёкшие</SelectItem>
            <SelectItem value="exhausted">Исчерпанные</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="one_time">Разовые</SelectItem>
            <SelectItem value="subscription">Подписочные</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assignFilter} onValueChange={(v) => setAssignFilter(v as AssignFilter)}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любая привязка</SelectItem>
            <SelectItem value="assigned">С получателем</SelectItem>
            <SelectItem value="unassigned">Без получателя</SelectItem>
          </SelectContent>
        </Select>

        <Select value={paidFilter} onValueChange={(v) => setPaidFilter(v as PaidFilter)}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все по оплате</SelectItem>
            <SelectItem value="paid">Есть оплаты</SelectItem>
            <SelectItem value="unpaid">Без оплат</SelectItem>
          </SelectContent>
        </Select>

        {/* Phase 1 Stripe Integration — provider filter (All | bePaid | Stripe) */}
        <Select value={providerFilter} onValueChange={(v) => setProviderFilter(v as ProviderFilter)}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все провайдеры</SelectItem>
            <SelectItem value="bepaid">bePaid</SelectItem>
            <SelectItem value="stripe">Stripe</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>

        <Button size="sm" onClick={() => setCreateOpen(true)} className="ml-auto">
          <Plus className="h-4 w-4 mr-1.5" /> Создать ссылку
        </Button>
      </div>

      <div className="text-xs text-muted-foreground px-1">
        Показано: <strong>{filtered.length}</strong> из <strong>{links?.length ?? 0}</strong>
      </div>

      {/* Table */}
      <div className="rounded-md border bg-card">
        <div data-table-scroll-x="true" className="table-scroll-x">
        <Table style={{ minWidth: 1100 }}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Создана</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Продукт / тариф</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead>Получатель</TableHead>
              <TableHead>Создал</TableHead>
              <TableHead className="text-center">Использовано</TableHead>
              <TableHead className="text-center">Оплат</TableHead>
              <TableHead>Истекает</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={11}>
                <div className="space-y-2 py-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              </TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-10">
                <Link2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Ссылки не найдены
              </TableCell></TableRow>
            )}
            {filtered.map((l) => (
              <TableRow key={l.id} className="cursor-pointer" onClick={() => setDetailsLink(l)}>
                <TableCell className="text-xs">
                  {format(new Date(l.created_at), "dd.MM.yyyy HH:mm")}
                </TableCell>
                <TableCell><LinkStatusBadge link={l} /></TableCell>
                <TableCell className="text-xs">
                  {l.payment_type === "subscription" ? "Подписка" : "Разовая"}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium truncate max-w-[200px]">{l.product_name || "—"}</div>
                  <div className="text-muted-foreground truncate max-w-[200px]">{l.tariff_name || "—"}</div>
                </TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap">
                  {formatAmount(l.amount, l.currency)}
                </TableCell>
                <TableCell className="text-xs">
                  {l.user_id ? (
                    <div>
                      <div className="truncate max-w-[160px]">{l.recipient_name || "—"}</div>
                      <div className="text-muted-foreground truncate max-w-[160px]">{l.recipient_email}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">Любой плательщик</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="truncate max-w-[140px]">{l.creator_name || l.creator_email || "—"}</div>
                </TableCell>
                <TableCell className="text-center text-xs">
                  {l.current_uses}{l.max_uses != null ? ` / ${l.max_uses}` : ""}
                </TableCell>
                <TableCell className="text-center text-xs">
                  <span className={l.paid_orders_count > 0 ? "font-semibold" : "text-muted-foreground"}>
                    {l.paid_orders_count}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {l.expires_at ? format(new Date(l.expires_at), "dd.MM.yyyy") : "—"}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => copyToClipboard(buildPublicUrl(l), "Ссылка скопирована")}>
                        <Copy className="h-4 w-4 mr-2" /> Скопировать ссылку
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => window.open(buildPublicUrl(l), "_blank")}>
                        <ExternalLink className="h-4 w-4 mr-2" /> Открыть ссылку
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDetailsLink(l)}>
                        <Eye className="h-4 w-4 mr-2" /> Подробности
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setEditLink(l)} disabled={l.status !== "active"}>
                        <Edit className="h-4 w-4 mr-2" /> Изменить ссылку
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setInvalidateLink(l)}
                        disabled={l.status !== "active"}
                        className="text-destructive focus:text-destructive"
                      >
                        <Ban className="h-4 w-4 mr-2" /> Сделать недействительной
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Dialogs */}
      <AdminPaymentLinkDialog open={createOpen} onOpenChange={setCreateOpen} mode="public" />
      <LinkDetailsDrawer link={detailsLink} onOpenChange={(o) => !o && setDetailsLink(null)} />
      <EditPaymentLinkDialog
        link={editLink}
        onOpenChange={(o) => !o && setEditLink(null)}
      />

      <AlertDialog open={!!invalidateLink} onOpenChange={(o) => !o && setInvalidateLink(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сделать ссылку недействительной?</AlertDialogTitle>
            <AlertDialogDescription>
              После этого по ссылке нельзя будет создать новую оплату. Связанные заказы и доступы не затрагиваются.
              Действие обратимо только вручную через базу. Удаление ссылки не выполняется.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => invalidateLink && invalidateMutation.mutate(invalidateLink)}
              disabled={invalidateMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {invalidateMutation.isPending ? "Применяется…" : "Сделать недействительной"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default LinksTabContent;
