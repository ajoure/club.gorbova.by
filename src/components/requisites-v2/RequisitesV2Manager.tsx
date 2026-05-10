/**
 * RequisitesV2Manager — unified list+CRUD UI for new requisites tables.
 *
 * Used for both scopes:
 *  - scope="system_customer" — Settings → Requisites (system customer)
 *  - scope="user_requisites" — Documents / Personal user requisites
 *
 * The component is fully scope-driven; no AI wording.
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
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={backToList}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              {isEdit ? "Редактировать реквизиты" : "Новые реквизиты"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {SCOPE_LABEL[scope]} ·{" "}
              {tab === "legal_entity"
                ? "Юридическое лицо"
                : tab === "entrepreneur"
                ? "Индивидуальный предприниматель"
                : "Физическое лицо"}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-6 flex items-start gap-3 text-sm">
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubjectTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="legal_entity">
            <Building2 className="h-4 w-4 mr-2" />
            Юрлицо
          </TabsTrigger>
          <TabsTrigger value="entrepreneur">
            <Briefcase className="h-4 w-4 mr-2" />
            ИП
          </TabsTrigger>
          <TabsTrigger value="individual">
            <User className="h-4 w-4 mr-2" />
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">
            [{SCOPE_LABEL[scope]}] [{subjectLabel}]
          </CardTitle>
          <CardDescription>
            {rows.length} записей
          </CardDescription>
        </div>
        <Button onClick={onCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Добавить
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Нет записей
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const d = row.data as Record<string, string | undefined>;
              const title =
                subjectType === "legal_entity"
                  ? [d.org_form, d.full_name && `«${d.full_name}»`]
                      .filter(Boolean)
                      .join(" ") || "Юрлицо"
                  : d.full_name || "ИП";
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-muted/30 hover:bg-muted/50 cursor-pointer"
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
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!row.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSetDefault(row)}
                      >
                        Сделать default
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">
            [{SCOPE_LABEL[scope]}] [ФЛ]
          </CardTitle>
          <CardDescription>{rows.length} записей</CardDescription>
        </div>
        <Button onClick={onCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Добавить
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Нет записей
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const d = row.data as Record<string, string | undefined>;
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-muted/30 hover:bg-muted/50 cursor-pointer"
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
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!row.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSetDefault(row)}
                      >
                        Сделать default
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
