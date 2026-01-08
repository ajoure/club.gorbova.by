import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Building2, Star, Copy } from "lucide-react";
import { toast } from "sonner";
import { useExecutors, Executor } from "@/hooks/useLegalDetails";

interface ExecutorFormData {
  full_name: string;
  short_name: string;
  legal_form: string;
  unp: string;
  legal_address: string;
  bank_name: string;
  bank_code: string;
  bank_account: string;
  director_position: string;
  director_full_name: string;
  director_short_name: string;
  acts_on_basis: string;
  phone: string;
  email: string;
}

const defaultFormData: ExecutorFormData = {
  full_name: "",
  short_name: "",
  legal_form: "ЗАО",
  unp: "",
  legal_address: "",
  bank_name: "",
  bank_code: "",
  bank_account: "",
  director_position: "Директор",
  director_full_name: "",
  director_short_name: "",
  acts_on_basis: "Устава",
  phone: "",
  email: "",
};

export default function AdminExecutors() {
  const { executors, isLoading: executorsLoading, createExecutor, updateExecutor, deleteExecutor, setDefault: setDefaultExecutor, isCreating, isUpdating } = useExecutors();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ExecutorFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleOpenDialog = (executor?: Executor) => {
    if (executor) {
      setEditingId(executor.id);
      setFormData({
        full_name: executor.full_name,
        short_name: executor.short_name || "",
        legal_form: executor.legal_form || "ЗАО",
        unp: executor.unp,
        legal_address: executor.legal_address,
        bank_name: executor.bank_name,
        bank_code: executor.bank_code,
        bank_account: executor.bank_account,
        director_position: executor.director_position || "",
        director_full_name: executor.director_full_name || "",
        director_short_name: executor.director_short_name || "",
        acts_on_basis: executor.acts_on_basis || "Устава",
        phone: executor.phone || "",
        email: executor.email || "",
      });
    } else {
      setEditingId(null);
      setFormData(defaultFormData);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingId(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async () => {
    if (!formData.full_name || !formData.unp || !formData.legal_address || !formData.bank_name || !formData.bank_code || !formData.bank_account) {
      toast.error("Заполните обязательные поля");
      return;
    }

    try {
      if (editingId) {
        await updateExecutor({ id: editingId, ...formData });
      } else {
        await createExecutor(formData);
      }
      handleCloseDialog();
    } catch (error) {
      console.error("Save error:", error);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmId) {
      try {
        await deleteExecutor(deleteConfirmId);
        setDeleteConfirmId(null);
      } catch (error) {
        console.error("Delete error:", error);
      }
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultExecutor(id);
    } catch (error) {
      console.error("Set default error:", error);
    }
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("ID скопирован");
  };

  const activeCount = executors?.filter(e => e.is_active).length || 0;
  const defaultExecutor = executors?.find(e => e.is_default);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Исполнители</h1>
            <p className="text-muted-foreground">
              Юридические лица для договоров и актов
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Всего</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{executors?.length || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активных</CardTitle>
              <Building2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">По умолчанию</CardTitle>
              <Star className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold truncate">
                {defaultExecutor?.short_name || defaultExecutor?.full_name || "—"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="pt-6">
            {executorsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : executors && executors.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Наименование</TableHead>
                    <TableHead>УНП</TableHead>
                    <TableHead>Банк</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executors.map((executor) => (
                    <TableRow key={executor.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{executor.short_name || executor.full_name}</span>
                          {executor.is_default && (
                            <Badge variant="secondary" className="text-xs">
                              <Star className="h-3 w-3 mr-1" />
                              По умолчанию
                            </Badge>
                          )}
                          {!executor.is_active && (
                            <Badge variant="outline" className="text-xs">Неактивен</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">{executor.legal_form}</div>
                      </TableCell>
                      <TableCell className="font-mono">{executor.unp}</TableCell>
                      <TableCell>
                        <div className="text-sm">{executor.bank_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{executor.bank_account}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!executor.is_default && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetDefault(executor.id)}
                              title="Сделать по умолчанию"
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyId(executor.id)}
                            title="Копировать ID"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDialog(executor)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmId(executor.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-4 opacity-40" />
                <p>Нет исполнителей</p>
                <Button variant="outline" className="mt-4" onClick={() => handleOpenDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить первого исполнителя
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Редактировать исполнителя" : "Новый исполнитель"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3">
                <Label>Полное наименование *</Label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder='Закрытое акционерное общество "АЖУР инкам"'
                />
              </div>
              <div>
                <Label>Форма</Label>
                <Input
                  value={formData.legal_form}
                  onChange={(e) => setFormData({ ...formData, legal_form: e.target.value })}
                  placeholder="ЗАО"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Краткое наименование</Label>
                <Input
                  value={formData.short_name}
                  onChange={(e) => setFormData({ ...formData, short_name: e.target.value })}
                  placeholder="АЖУР инкам"
                />
              </div>
              <div>
                <Label>УНП *</Label>
                <Input
                  value={formData.unp}
                  onChange={(e) => setFormData({ ...formData, unp: e.target.value })}
                  placeholder="123456789"
                />
              </div>
            </div>
            <div>
              <Label>Юридический адрес *</Label>
              <Input
                value={formData.legal_address}
                onChange={(e) => setFormData({ ...formData, legal_address: e.target.value })}
                placeholder="220000, г. Минск, ул. Примерная, д. 1, офис 101"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Банк *</Label>
                <Input
                  value={formData.bank_name}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                  placeholder='ОАО "Приорбанк"'
                />
              </div>
              <div>
                <Label>БИК *</Label>
                <Input
                  value={formData.bank_code}
                  onChange={(e) => setFormData({ ...formData, bank_code: e.target.value })}
                  placeholder="PJCBBY2X"
                />
              </div>
              <div>
                <Label>Р/счёт *</Label>
                <Input
                  value={formData.bank_account}
                  onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
                  placeholder="BY00PJCB00000000000000000000"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Должность директора</Label>
                <Input
                  value={formData.director_position}
                  onChange={(e) => setFormData({ ...formData, director_position: e.target.value })}
                  placeholder="Директор"
                />
              </div>
              <div>
                <Label>ФИО директора (полное)</Label>
                <Input
                  value={formData.director_full_name}
                  onChange={(e) => setFormData({ ...formData, director_full_name: e.target.value })}
                  placeholder="Иванов Иван Иванович"
                />
              </div>
              <div>
                <Label>ФИО (краткое)</Label>
                <Input
                  value={formData.director_short_name}
                  onChange={(e) => setFormData({ ...formData, director_short_name: e.target.value })}
                  placeholder="Иванов И.И."
                />
              </div>
            </div>
            <div>
              <Label>Действует на основании</Label>
              <Input
                value={formData.acts_on_basis}
                onChange={(e) => setFormData({ ...formData, acts_on_basis: e.target.value })}
                placeholder="Устава"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Телефон</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+375 29 123-45-67"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="info@company.by"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isCreating || isUpdating}>
              {editingId ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить исполнителя?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Исполнитель будет удалён из системы.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
