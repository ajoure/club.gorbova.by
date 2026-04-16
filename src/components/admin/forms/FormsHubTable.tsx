import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ClipboardList, FileText, GraduationCap, User, Handshake } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { FormsHubRow } from "@/hooks/useFormsHubData";

const SOURCE_CONFIG = {
  site_form: { label: "Анкета", icon: FileText, badgeClass: "bg-blue-50 text-blue-700 border-blue-200" },
  preorder: { label: "Предзапись", icon: ClipboardList, badgeClass: "bg-amber-50 text-amber-700 border-amber-200" },
  training: { label: "Обучение", icon: GraduationCap, badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
} as const;

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  completed: { label: "Завершён", variant: "default" },
  processed: { label: "Обработано", variant: "default" },
  in_progress: { label: "В процессе", variant: "secondary" },
  new: { label: "Новый", variant: "outline" },
  confirmed: { label: "Подтверждён", variant: "default" },
  contacted: { label: "Связались", variant: "outline" },
  paid: { label: "Оплачено", variant: "default" },
  cancelled: { label: "Отменён", variant: "destructive" },
};

interface Props {
  rows: FormsHubRow[];
  isLoading: boolean;
  onOpenDetail: (row: FormsHubRow) => void;
  onOpenContact?: (row: FormsHubRow) => void;
}

export function FormsHubTable({ rows, isLoading, onOpenDetail, onOpenContact }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ClipboardList className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">Нет записей по текущим фильтрам</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="w-[180px]">Клиент</TableHead>
            <TableHead className="w-[100px]">Тип</TableHead>
            <TableHead>Продукт</TableHead>
            <TableHead>Источник</TableHead>
            <TableHead className="w-[100px]">Дата</TableHead>
            <TableHead className="w-[100px]">Статус</TableHead>
            <TableHead className="w-[60px] text-center">Сделка</TableHead>
            <TableHead className="w-[60px] text-center">Аккаунт</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const source = SOURCE_CONFIG[row.source_type];
            const Icon = source.icon;
            const status = STATUS_CONFIG[row.status] || STATUS_CONFIG.new;

            return (
              <TableRow
                key={`${row.source_type}-${row.id}`}
                className="cursor-pointer hover:bg-accent/40 transition-colors"
                onClick={() => onOpenDetail(row)}
              >
                <TableCell>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{row.client_name}</div>
                    {row.client_email && (
                      <div className="text-xs text-muted-foreground truncate">{row.client_email}</div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[11px] gap-1 ${source.badgeClass}`}>
                    <Icon className="h-3 w-3" />
                    {source.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm truncate block max-w-[200px]">{row.product_title || "—"}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground truncate block max-w-[180px]">{row.source_entity}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(row.created_at), "dd.MM.yy", { locale: ru })}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant} className="text-[11px]">{status.label}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  {row.has_deal ? (
                    <Handshake className="h-4 w-4 text-emerald-500 mx-auto" />
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {row.has_account ? (
                    <User className="h-4 w-4 text-blue-500 mx-auto" />
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
