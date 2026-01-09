import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Upload, Trash2, Edit, FileText, Copy, Info, Download, Settings, FileCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useDocumentTemplates, INVOICE_ACT_PLACEHOLDERS, DocumentTemplate } from "@/hooks/useDocumentTemplates";
import { supabase } from "@/integrations/supabase/client";
import { DocumentRulesTab } from "@/components/admin/DocumentRulesTab";
import { DocumentLogTab } from "@/components/admin/DocumentLogTab";

interface TemplateFormData {
  name: string;
  code: string;
  description: string;
  document_type: string;
  is_active: boolean;
}

const defaultFormData: TemplateFormData = {
  name: "",
  code: "",
  description: "",
  document_type: "invoice_act",
  is_active: true,
};

export default function AdminDocumentTemplates() {
  const { templates, isLoading, createTemplate, updateTemplate, deleteTemplate, uploadTemplateFile, isCreating, isUpdating } = useDocumentTemplates();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TemplateFormData>(defaultFormData);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleOpenDialog = (template?: DocumentTemplate) => {
    if (template) {
      setEditingId(template.id);
      setFormData({
        name: template.name,
        code: template.code,
        description: template.description || "",
        document_type: template.document_type,
        is_active: template.is_active,
      });
    } else {
      setEditingId(null);
      setFormData(defaultFormData);
    }
    setSelectedFile(null);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setFormData(defaultFormData);
    setSelectedFile(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".docx")) {
        toast.error("Загрузите файл в формате .docx");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.code) {
      toast.error("Заполните обязательные поля");
      return;
    }

    if (!editingId && !selectedFile) {
      toast.error("Загрузите файл шаблона");
      return;
    }

    try {
      setUploading(true);
      let templatePath = "";

      if (selectedFile) {
        templatePath = await uploadTemplateFile(selectedFile, formData.code);
      }

      if (editingId) {
        await updateTemplate({
          id: editingId,
          name: formData.name,
          code: formData.code,
          description: formData.description || null,
          document_type: formData.document_type,
          is_active: formData.is_active,
          ...(templatePath && { template_path: templatePath }),
        });
      } else {
        await createTemplate({
          name: formData.name,
          code: formData.code,
          description: formData.description || null,
          document_type: formData.document_type,
          template_path: templatePath,
          placeholders: INVOICE_ACT_PLACEHOLDERS.map(p => p.key),
          is_active: formData.is_active,
        });
      }

      handleCloseDialog();
    } catch (error) {
      console.error("Submit error:", error);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteTemplate(deleteId);
      setDeleteId(null);
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const copyPlaceholder = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Скопировано в буфер обмена");
  };

  const downloadTemplate = async (template: DocumentTemplate) => {
    try {
      const { data, error } = await supabase.storage
        .from("documents-templates")
        .download(template.template_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${template.code}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Ошибка скачивания шаблона");
    }
  };

  const getDocumentTypeBadge = (type: string) => {
    switch (type) {
      case "invoice_act":
        return <Badge variant="default">Счёт-акт</Badge>;
      case "contract":
        return <Badge variant="secondary">Договор</Badge>;
      case "act":
        return <Badge variant="outline">Акт</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  return (
    <AdminLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Шаблоны документов</h1>
            <p className="text-muted-foreground">
              Управление шаблонами для автоматической генерации документов
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить шаблон
          </Button>
        </div>

        <Tabs defaultValue="templates" className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="templates">Шаблоны</TabsTrigger>
            <TabsTrigger value="rules" className="flex items-center gap-1">
              <Settings className="h-3.5 w-3.5" />
              Правила генерации
            </TabsTrigger>
            <TabsTrigger value="log" className="flex items-center gap-1">
              <FileCheck className="h-3.5 w-3.5" />
              Журнал документов
            </TabsTrigger>
            <TabsTrigger value="placeholders">Плейсхолдеры</TabsTrigger>
          </TabsList>

          <TabsContent value="templates">
            <Card>
              <CardHeader>
                <CardTitle>Загруженные шаблоны</CardTitle>
                <CardDescription>
                  Word-документы с плейсхолдерами для автоматической подстановки данных
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : templates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Шаблоны не найдены</p>
                    <p className="text-sm">Загрузите первый шаблон документа</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Название</TableHead>
                        <TableHead>Код</TableHead>
                        <TableHead>Тип</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Обновлён</TableHead>
                        <TableHead className="text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.map(template => (
                        <TableRow key={template.id}>
                          <TableCell className="font-medium">
                            {template.name}
                            {template.description && (
                              <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                                {template.description}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-2 py-1 rounded">
                              {template.code}
                            </code>
                          </TableCell>
                          <TableCell>{getDocumentTypeBadge(template.document_type)}</TableCell>
                          <TableCell>
                            <Badge variant={template.is_active ? "default" : "secondary"}>
                              {template.is_active ? "Активен" : "Неактивен"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {format(new Date(template.updated_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => downloadTemplate(template)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenDialog(template)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteId(template.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules">
            <DocumentRulesTab />
          </TabsContent>

          <TabsContent value="log">
            <DocumentLogTab />
          </TabsContent>

          <TabsContent value="placeholders">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  Доступные плейсхолдеры
                </CardTitle>
                <CardDescription>
                  Используйте эти плейсхолдеры в Word-шаблоне для автоматической подстановки данных
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="grid gap-2">
                    {INVOICE_ACT_PLACEHOLDERS.map(placeholder => (
                      <div
                        key={placeholder.key}
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <div>
                          <code className="text-sm font-mono bg-primary/10 text-primary px-2 py-1 rounded">
                            {placeholder.key}
                          </code>
                          <p className="text-sm text-muted-foreground mt-1">
                            {placeholder.description}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyPlaceholder(placeholder.key)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Редактировать шаблон" : "Новый шаблон"}
              </DialogTitle>
              <DialogDescription>
                Загрузите Word-документ с плейсхолдерами
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Название *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Счёт-акт на услуги"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Код *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") })}
                  placeholder="invoice_act_v1"
                  disabled={!!editingId}
                />
                <p className="text-xs text-muted-foreground">
                  Уникальный код для идентификации шаблона
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Описание</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Описание шаблона"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="file">
                  Файл шаблона (.docx) {!editingId && "*"}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="file"
                    type="file"
                    accept=".docx"
                    onChange={handleFileChange}
                    className="cursor-pointer"
                  />
                </div>
                {selectedFile && (
                  <p className="text-sm text-muted-foreground">
                    Выбран: {selectedFile.name}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="is_active">Активен</Label>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDialog}>
                Отмена
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isCreating || isUpdating || uploading}
              >
                {uploading ? "Загрузка..." : editingId ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить шаблон?</AlertDialogTitle>
              <AlertDialogDescription>
                Это действие нельзя отменить. Шаблон будет удалён безвозвратно.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}
