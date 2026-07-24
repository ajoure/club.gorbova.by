/**
 * RequisitesV2Manager — unified list+CRUD UI for new requisites tables.
 *
 * Used for both scopes:
 *  - scope="system_customer" — Settings → Requisites (system customer)
 *  - scope="user_requisites" — Documents / Personal user requisites
 *
 * The component is fully scope-driven. No artificial-intelligence wording.
 */

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Star,
  Trash2,
  Building2,
  User,
  Briefcase,
  ChevronLeft,
  ShieldCheck,
} from "lucide-react";
import {
  useRequisitesV2,
  type IndividualRequisitesRow,
  type LegalEntityRequisitesRow,
  type RequisitesScope,
} from "@/hooks/useRequisitesV2";
import { LegalEntityRequisitesForm } from "./LegalEntityRequisitesForm";
import { IndividualRequisitesForm } from "./IndividualRequisitesForm";
import { normalizeLegacyData } from "@/lib/requisites-v2/fieldMap";

type SubjectTab = "legal_entity" | "entrepreneur" | "individual";

const SCOPE_LABEL: Record<RequisitesScope, string> = {
  system_customer: "Сист. заказчик",
  user_requisites: "Пользовательские",
};

interface Props {
  scope: RequisitesScope;
  title: string;
  description: string;
}

export function RequisitesV2Manager({ scope, title, description }: Props) {
  const v2 = useRequisitesV2({ scope });

  const [tab, setTab] = useState<SubjectTab>("legal_entity");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingLegal, setEditingLegal] =
    useState<LegalEntityRequisitesRow | null>(null);
  const [editingIndividual, setEditingIndividual] =
    useState<IndividualRequisitesRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "legal"; row: LegalEntityRequisitesRow }
    | { kind: "individual"; row: IndividualRequisitesRow }
    | null
  >(null);

  const legalRows = v2.legalEntities.filter((r) => r.subject_type === "legal_entity");
  const ipRows = v2.legalEntities.filter((r) => r.subject_type === "entrepreneur");
  const indRows = v2.individuals;

  function openCreate(t: SubjectTab) {
    setTab(t);
    setEditingLegal(null);
    setEditingIndividual(null);
    setMode("create");
  }

  function openEditLegal(row: LegalEntityRequisitesRow) {
    setTab(row.subject_type);
    setEditingLegal(row);
    setMode("edit");
  }

  function openEditIndividual(row: IndividualRequisitesRow) {
    setTab("individual");
    setEditingIndividual(row);
    setMode("edit");
  }

  function backToList() {
    setMode("list");
    setEditingLegal(null);
    setEditingIndividual(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "legal") {
      await v2.deleteLegalEntityRequisites(deleteTarget.row.id);
    } else {
      await v2.deleteIndividualRequisites(deleteTarget.row.id);
    }
    setDeleteTarget(null);
  }

  // ---------- Form view ----------
  if (mode !== "list") {
    const isEdit = mode === "edit";
    return (
      <div className="min-w-0 space-y-4 sm:space-y-6">
        <div className="flex min-w-0 items-start gap-2 sm:items-center sm:gap-3">
          <Button className="shrink-0" variant="ghost" size="icon" onClick={backToList}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold sm:text-xl">
              {isEdit ? "Редактировать реквизиты" : "Новые реквизиты"}
            </h2>
            <p className="break-words text-sm text-muted-foreground">
              {SCOPE_LABEL[scope]} ·{" "}
              {tab === "legal_entity"
                ? "Юридическое лицо"
                : tab === "entrepreneur"
                ? "Индивидуальный предприниматель"
                : "Физическое лицо"}
            </p>
          </div>
        </div>

        <Card className="min-w-0">
          <CardContent className="p-4 sm:p-6 sm:pt-6">
            {tab === "individual" ? (
              <IndividualRequisitesForm
                scope={scope}
                initialData={editingIndividual}
                isSubmitting={v2.isMutating}
                onCancel={backToList}
                onSubmit={async ({ data, is_default }) => {
                  if (isEdit && editingIndividual) {
                    await v2.updateIndividualRequisites({
                      id: editingIndividual.id,
                      data,
                      is_default,
                    });
                  } else {
                    await v2.createIndividualRequisites({ data, is_default });
                  }
                  backToList();
                }}
              />
            ) : (
              <LegalEntityRequisitesForm
                scope={scope}
                subjectType={tab}
                initialData={editingLegal}
                isSubmitting={v2.isMutating}
                onCancel={backToList}
                onSubmit={async ({ data, is_default }) => {
                  if (isEdit && editingLegal) {
                    await v2.updateLegalEntityRequisites({
                      id: editingLegal.id,
                      data,
                      is_default,
                    });
                  } else {
                    await v2.createLegalEntityRequisites({
                      subject_type: tab,
                      data,
                      is_default,
                    });
                  }
                  backToList();
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------- List view ----------
  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <div className="min-w-0">
        <h1 className="break-words text-xl font-bold sm:text-2xl">{title}</h1>
        <p className="break-words text-sm text-muted-foreground sm:text-base">{description}</p>
      </div>

      <Card className="min-w-0 bg-muted/30 border-dashed">
        <CardContent className="flex items-start gap-3 p-4 text-sm sm:p-6 sm:pt-6">
          <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Новая модель реквизитов (v2)</div>
            <div className="text-muted-foreground">
              Записи хранятся в новых таблицах с привязкой к личному tenant и owner_user_id.
              Каждый пользователь видит только свои записи. Администратор — все.
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs className="min-w-0" value={tab} onValueChange={(v) => setTab(v as SubjectTab)}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger className="min-w-0 gap-1 px-1.5 py-2 sm:gap-2 sm:px-3" value="legal_entity">
            <Building2 className="h-4 w-4 shrink-0" />
            Юрлицо
          </TabsTrigger>
          <TabsTrigger className="min-w-0 gap-1 px-1.5 py-2 sm:gap-2 sm:px-3" value="entrepreneur">
            <Briefcase className="h-4 w-4 shrink-0" />
            ИП
          </TabsTrigger>
          <TabsTrigger className="min-w-0 gap-1 px-1.5 py-2 sm:gap-2 sm:px-3" value="individual">
            <User className="h-4 w-4 shrink-0" />
            Физлицо
          </TabsTrigger>
        </TabsList>

        <TabsContent value="legal_entity">
          <LegalSection
            scope={scope}
            subjectType="legal_entity"
            rows={legalRows}
            onCreate={() => openCreate("legal_entity")}
            onEdit={openEditLegal}
            onDelete={(row) => setDeleteTarget({ kind: "legal", row })}
            onSetDefault={(row) =>
              v2.setDefaultRequisites({
                table: "legal_entities_requisites",
                id: row.id,
                subject_type: "legal_entity",
              })
            }
            isLoading={v2.isLoading}
          />
        </TabsContent>

        <TabsContent value="entrepreneur">
          <LegalSection
            scope={scope}
            subjectType="entrepreneur"
            rows={ipRows}
            onCreate={() => openCreate("entrepreneur")}
            onEdit={openEditLegal}
            onDelete={(row) => setDeleteTarget({ kind: "legal", row })}
            onSetDefault={(row) =>
              v2.setDefaultRequisites({
                table: "legal_entities_requisites",
                id: row.id,
                subject_type: "entrepreneur",
              })
            }
            isLoading={v2.isLoading}
          />
        </TabsContent>

        <TabsContent value="individual">
          <IndividualSection
            scope={scope}
            rows={indRows}
            onCreate={() => openCreate("individual")}
            onEdit={openEditIndividual}
            onDelete={(row) => setDeleteTarget({ kind: "individual", row })}
            onSetDefault={(row) =>
              v2.setDefaultRequisites({
                table: "individual_requisites",
                id: row.id,
              })
            }
            isLoading={v2.isLoading}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить реквизиты?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------- Sections ----------------

function RowBadges({ isDefault }: { isDefault: boolean }) {
  if (!isDefault) return null;
  return (
    <Badge variant="secondary" className="gap-1">
      <Star className="h-3 w-3" />
      По умолчанию
    </Badge>
  );
}

function LegalSection({
  scope,
  subjectType,
  rows,
  onCreate,
  onEdit,
  onDelete,
  onSetDefault,
  isLoading,
}: {
  scope: RequisitesScope;
  subjectType: "legal_entity" | "entrepreneur";
  rows: LegalEntityRequisitesRow[];
  onCreate: () => void;
  onEdit: (row: LegalEntityRequisitesRow) => void;
  onDelete: (row: LegalEntityRequisitesRow) => void;
  onSetDefault: (row: LegalEntityRequisitesRow) => void;
  isLoading: boolean;
}) {
  const subjectLabel = subjectType === "legal_entity" ? "ЮЛ" : "ИП";

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <CardTitle className="text-lg">
            [{SCOPE_LABEL[scope]}] [{subjectLabel}]
          </CardTitle>
          <CardDescription>
            {rows.length} записей
          </CardDescription>
        </div>
        <Button onClick={onCreate} className="w-full gap-2 sm:w-auto">
          <Plus className="h-4 w-4" />
          Добавить реквизиты
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Нет записей
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const d = normalizeLegacyData(
                subjectType,
                row.data as Record<string, unknown>,
              ) as Record<string, string | undefined>;
              const title =
                subjectType === "legal_entity"
                  ? [d.org_form, d.name && `«${d.name}»`]
                      .filter(Boolean)
                      .join(" ") || "Юрлицо"
                  : d.name || "ИП";
              return (
                <div
                  key={row.id}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50 cursor-pointer sm:flex-row sm:items-center sm:justify-between sm:p-4"
                  onClick={() => onEdit(row)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      {subjectType === "legal_entity" ? (
                        <Building2 className="h-4 w-4" />
                      ) : (
                        <Briefcase className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{title}</span>
                        <RowBadges isDefault={row.is_default} />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        УНП: {d.unp ?? "—"}
                        {d.bank_account ? ` · сч. ${d.bank_account}` : ""}
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex w-full items-center justify-end gap-2 border-t pt-3 sm:w-auto sm:border-0 sm:pt-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!row.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSetDefault(row)}
                      >
                        Сделать основным
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IndividualSection({
  scope,
  rows,
  onCreate,
  onEdit,
  onDelete,
  onSetDefault,
  isLoading,
}: {
  scope: RequisitesScope;
  rows: IndividualRequisitesRow[];
  onCreate: () => void;
  onEdit: (row: IndividualRequisitesRow) => void;
  onDelete: (row: IndividualRequisitesRow) => void;
  onSetDefault: (row: IndividualRequisitesRow) => void;
  isLoading: boolean;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <CardTitle className="text-lg">
            [{SCOPE_LABEL[scope]}] [ФЛ]
          </CardTitle>
          <CardDescription>{rows.length} записей</CardDescription>
        </div>
        <Button onClick={onCreate} className="w-full gap-2 sm:w-auto">
          <Plus className="h-4 w-4" />
          Добавить реквизиты
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Нет записей
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const d = normalizeLegacyData(
                "individual",
                row.data as Record<string, unknown>,
              ) as Record<string, string | undefined>;
              return (
                <div
                  key={row.id}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50 cursor-pointer sm:flex-row sm:items-center sm:justify-between sm:p-4"
                  onClick={() => onEdit(row)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">
                          {d.full_name || "Физлицо"}
                        </span>
                        <RowBadges isDefault={row.is_default} />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {d.passport_number
                          ? `Паспорт: ${d.passport_series ?? ""} ${d.passport_number}`
                          : "—"}
                        {d.bank_account ? ` · сч. ${d.bank_account}` : ""}
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex w-full items-center justify-end gap-2 border-t pt-3 sm:w-auto sm:border-0 sm:pt-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!row.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSetDefault(row)}
                      >
                        Сделать основным
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
