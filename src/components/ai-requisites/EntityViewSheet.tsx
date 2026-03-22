/**
 * EntityViewSheet — view-mode card for entity records.
 *
 * Shell layout 1:1 with ContactDetailSheet.
 * Sections: basic info, address, management, bank, system.
 * Actions: edit, archive (document only).
 */

import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building2,
  User,
  Pencil,
  Archive,
  Loader2,
  MapPin,
  Landmark,
  Briefcase,
  Info,
  Copy,
} from "lucide-react";
import {
  getEntityShortName,
  getEntityTypeBadge,
  getEntityUnp,
} from "@/lib/legal-entities/entityDisplayUtils";
import { toast } from "sonner";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

/* ── helpers ── */

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} скопировано`);
}

function InfoRow({
  label,
  value,
  copyable,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  copyable?: boolean;
  mono?: boolean;
}) {
  const display = value || "—";
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground shrink-0">{label}</span>
        <div className="flex items-center gap-1 min-w-0">
          <span
            className={`text-sm text-right break-words ${mono ? "font-mono" : ""} ${!value ? "text-muted-foreground" : ""}`}
          >
            {display}
          </span>
          {copyable && value && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0"
              onClick={() => copyToClipboard(value, label)}
            >
              <Copy className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/* ── props ── */

interface EntityViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: ClientLegalDetails | null;
  isArchiving: boolean;
  onEdit: (entity: ClientLegalDetails) => void;
  onArchive: (id: string) => void;
}

/* ── component ── */

export function EntityViewSheet({
  open,
  onOpenChange,
  entity,
  isArchiving,
  onEdit,
  onArchive,
}: EntityViewSheetProps) {
  if (!entity) return null;

  const isEntrepreneur = entity.client_type === "entrepreneur";
  const shortName = getEntityShortName(entity);
  const typeBadge = getEntityTypeBadge(entity);
  const unp = getEntityUnp(entity);
  const canArchive = entity.purpose === "document" && entity.status === "active";

  // Build full org form + UNP subtitle
  const orgForm = isEntrepreneur ? "Индивидуальный предприниматель" : entity.leg_org_form;
  const subtitle = [orgForm, unp ? `УНП ${unp}` : null].filter(Boolean).join(" · ");

  // Address
  const address = isEntrepreneur ? entity.ent_address : entity.leg_address;

  // Bank
  const bankAccount = entity.bank_account;
  const bankName = entity.bank_name;
  const bankCode = entity.bank_code;

  // Director (legal entity only)
  const directorName = !isEntrepreneur ? entity.leg_director_name : null;
  const directorPosition = !isEntrepreneur ? entity.leg_director_position : null;
  const actsOnBasis = isEntrepreneur ? entity.ent_acts_on_basis : entity.leg_acts_on_basis;

  // Full name
  const fullName = isEntrepreneur ? entity.ent_name : entity.leg_name;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-[60vw] lg:max-w-3xl p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden"
      >
        {/* ── Header (1:1 ContactDetailSheet shell) ── */}
        <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0">
          {/* Row 1: Icon + Title + Subtitle */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-muted shrink-0">
              {isEntrepreneur ? (
                <User className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
              ) : (
                <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg sm:text-xl font-bold leading-tight break-words">
                {shortName}
              </SheetTitle>
              {subtitle && (
                <p className="text-xs text-muted-foreground break-all mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          <Separator className="mt-3" />

          {/* Row 2: Badge pills + action buttons */}
          <div className="flex flex-wrap items-center gap-1.5 px-1 py-1">
            <Badge variant="outline" className="h-7 px-2.5 text-xs">
              {typeBadge}
            </Badge>

            {entity.status === "active" ? (
              <Badge variant="default" className="h-7 px-2.5 text-xs gap-1">
                Активный
              </Badge>
            ) : (
              <Badge variant="secondary" className="h-7 px-2.5 text-xs gap-1">
                Архив
              </Badge>
            )}

            {entity.purpose === "billing" && (
              <Badge variant="outline" className="h-7 px-2.5 text-xs gap-1 border-amber-400/30 text-amber-600 dark:text-amber-400">
                <Landmark className="w-3 h-3" />
                Платёжные
              </Badge>
            )}

            <Badge
              variant="outline"
              className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => {
                onOpenChange(false);
                onEdit(entity);
              }}
            >
              <Pencil className="w-3 h-3" />
              редактировать
            </Badge>

            {canArchive && (
              <Badge
                variant="outline"
                className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => onArchive(entity.id)}
              >
                {isArchiving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Archive className="w-3 h-3" />
                )}
                в архив
              </Badge>
            )}
          </div>
        </SheetHeader>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 py-4 pb-24 space-y-4">
            {/* Section 1: Basic info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Основная информация
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow
                  label={isEntrepreneur ? "ФИО" : "Полное наименование"}
                  value={fullName}
                />
                {!isEntrepreneur && (
                  <>
                    <Separator />
                    <InfoRow label="Орг. форма" value={entity.leg_org_form} />
                  </>
                )}
                <Separator />
                <InfoRow label="УНП" value={unp} copyable mono />
                {actsOnBasis && (
                  <>
                    <Separator />
                    <InfoRow label="Действует на основании" value={actsOnBasis} />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Section 2: Address */}
            {address && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Адрес
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow label="Юридический адрес" value={address} />
                </CardContent>
              </Card>
            )}

            {/* Section 3: Director (legal entity only) */}
            {!isEntrepreneur && (directorName || directorPosition) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    Руководитель
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {directorPosition && (
                    <InfoRow label="Должность" value={directorPosition} />
                  )}
                  {directorPosition && directorName && <Separator />}
                  {directorName && (
                    <InfoRow label="ФИО" value={directorName} />
                  )}
                </CardContent>
              </Card>
            )}

            {/* Section 4: Bank details */}
            {(bankAccount || bankName || bankCode) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Landmark className="w-4 h-4" />
                    Банковские реквизиты
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow label="Расчётный счёт" value={bankAccount} copyable mono />
                  {bankName && (
                    <>
                      <Separator />
                      <InfoRow label="Банк" value={bankName} />
                    </>
                  )}
                  {bankCode && (
                    <>
                      <Separator />
                      <InfoRow label="Код банка" value={bankCode} copyable mono />
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Section 5: System info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Служебная информация
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow
                  label="Назначение"
                  value={entity.purpose === "billing" ? "Платёжные" : "Документы"}
                />
                <Separator />
                <InfoRow
                  label="Дата создания"
                  value={format(new Date(entity.created_at), "dd MMM yyyy HH:mm", { locale: ru })}
                />
                <Separator />
                <InfoRow label="ID" value={entity.id} copyable mono />
              </CardContent>
            </Card>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
