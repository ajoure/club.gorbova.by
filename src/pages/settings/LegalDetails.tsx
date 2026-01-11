import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalDetails, ClientType, ClientLegalDetails } from "@/hooks/useLegalDetails";
import { PayerTypeSelector } from "@/components/legal-details/PayerTypeSelector";
import { IndividualDetailsForm } from "@/components/legal-details/IndividualDetailsForm";
import { EntrepreneurDetailsForm } from "@/components/legal-details/EntrepreneurDetailsForm";
import { LegalEntityDetailsForm } from "@/components/legal-details/LegalEntityDetailsForm";
import { 
  FileText, 
  Plus, 
  Trash2, 
  Star, 
  ChevronLeft,
  User,
  Briefcase,
  Building2,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
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

export default function LegalDetailsSettings() {
  const {
    legalDetails,
    isLoading,
    createDetails,
    updateDetails,
    deleteDetails,
    setDefault,
    isCreating,
    isUpdating,
    isDeleting,
  } = useLegalDetails();

  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [selectedType, setSelectedType] = useState<ClientType>("individual");
  const [editingDetails, setEditingDetails] = useState<ClientLegalDetails | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [detailsToDelete, setDetailsToDelete] = useState<ClientLegalDetails | null>(null);

  const handleCreate = async (data: Partial<ClientLegalDetails>) => {
    await createDetails(data);
    setMode("list");
  };

  const handleUpdate = async (data: Partial<ClientLegalDetails>) => {
    if (!editingDetails) return;
    await updateDetails({ id: editingDetails.id, ...data });
    setEditingDetails(null);
    setMode("list");
  };

  const handleDelete = async () => {
    if (!detailsToDelete) return;
    await deleteDetails(detailsToDelete.id);
    setDeleteDialogOpen(false);
    setDetailsToDelete(null);
  };

  const openEdit = (details: ClientLegalDetails) => {
    setEditingDetails(details);
    setSelectedType(details.client_type as ClientType);
    setMode("edit");
  };

  const openDelete = (details: ClientLegalDetails) => {
    setDetailsToDelete(details);
    setDeleteDialogOpen(true);
  };

  const getTypeIcon = (type: ClientType) => {
    switch (type) {
      case "individual": return <User className="h-4 w-4" />;
      case "entrepreneur": return <Briefcase className="h-4 w-4" />;
      case "legal_entity": return <Building2 className="h-4 w-4" />;
    }
  };

  const getTypeLabel = (type: ClientType) => {
    switch (type) {
      case "individual": return "Физлицо";
      case "entrepreneur": return "ИП";
      case "legal_entity": return "Юрлицо";
    }
  };

  const getDisplayName = (details: ClientLegalDetails) => {
    switch (details.client_type) {
      case "individual":
        return details.ind_full_name || "Физлицо";
      case "entrepreneur":
        return details.ent_name || "ИП";
      case "legal_entity":
        return details.leg_org_form && details.leg_name 
          ? `${details.leg_org_form} "${details.leg_name}"`
          : "Юрлицо";
    }
  };

  const renderForm = () => {
    // Для редактирования: showDemoOnEmpty = false, так как редактируем реальные данные
    // Для создания: showDemoOnEmpty = true, чтобы показать примеры заполнения
    const isEditMode = mode === "edit";
    const props = {
      initialData: editingDetails,
      onSubmit: isEditMode ? handleUpdate : handleCreate,
      isSubmitting: isCreating || isUpdating,
      showDemoOnEmpty: !isEditMode, // Демо только при создании новых
    };

    switch (selectedType) {
      case "individual":
        return <IndividualDetailsForm {...props} />;
      case "entrepreneur":
        return <EntrepreneurDetailsForm {...props} />;
      case "legal_entity":
        return <LegalEntityDetailsForm {...props} />;
    }
  };

  if (mode === "create" || mode === "edit") {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => {
                setMode("list");
                setEditingDetails(null);
              }}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {mode === "edit" ? "Редактировать реквизиты" : "Новые реквизиты"}
              </h1>
              <p className="text-muted-foreground">
                {mode === "edit" ? "Измените данные для документов" : "Заполните данные для закрывающих документов"}
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Тип плательщика</CardTitle>
              <CardDescription>
                Выберите тип для правильного заполнения документов
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PayerTypeSelector 
                value={selectedType} 
                onChange={setSelectedType}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              {renderForm()}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Реквизиты для документов</h1>
          <p className="text-muted-foreground">Данные для формирования счёт-актов и закрывающих документов</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Мои реквизиты
                </CardTitle>
                <CardDescription>
                  Сохранённые данные для автоматического формирования документов
                </CardDescription>
              </div>
              <Button onClick={() => setMode("create")} className="gap-2">
                <Plus className="h-4 w-4" />
                Добавить
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : legalDetails && legalDetails.length > 0 ? (
              <div className="space-y-4">
                {legalDetails.map((details) => (
                  <div
                    key={details.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => openEdit(details)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        {getTypeIcon(details.client_type as ClientType)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{getDisplayName(details)}</span>
                          {details.is_default && (
                            <Badge variant="secondary" className="gap-1">
                              <Star className="h-3 w-3" />
                              Основной
                            </Badge>
                          )}
                          <Badge variant="outline">
                            {getTypeLabel(details.client_type as ClientType)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          {details.validation_status === "valid" ? (
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="h-3 w-3" />
                              Проверено
                            </span>
                          ) : details.validation_status === "invalid" ? (
                            <span className="flex items-center gap-1 text-destructive">
                              <AlertCircle className="h-3 w-3" />
                              Есть ошибки
                            </span>
                          ) : (
                            <span>Не проверено</span>
                          )}
                          {details.bank_account && (
                            <span>• {details.bank_name}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {!details.is_default && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDefault(details.id)}
                        >
                          Сделать основным
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDelete(details)}
                        disabled={isDeleting}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-4">У вас нет сохранённых реквизитов</p>
                <p className="text-sm mb-6">
                  Добавьте реквизиты для автоматического формирования<br />
                  счёт-актов после каждой оплаты
                </p>
                <Button onClick={() => setMode("create")} variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Добавить реквизиты
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info card */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium mb-1">Автоматические документы</h3>
                <p className="text-sm text-muted-foreground">
                  После каждой успешной оплаты мы автоматически сформируем счёт-акт 
                  с вашими реквизитами и отправим на email. Документы также доступны 
                  в разделе "Мои покупки".
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить реквизиты?</AlertDialogTitle>
            <AlertDialogDescription>
              {detailsToDelete && (
                <>
                  Реквизиты "{getDisplayName(detailsToDelete)}" будут удалены.
                  Это действие нельзя отменить.
                </>
              )}
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
    </DashboardLayout>
  );
}
