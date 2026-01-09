import { useState, useMemo, useRef } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Building2, Star, Copy, Upload, X, Image } from "lucide-react";
import { toast } from "sonner";
import { useExecutors, Executor } from "@/hooks/useLegalDetails";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";

// Предустановленные должности руководителя
const DIRECTOR_POSITIONS = [
  { value: "director", label: "Директор" },
  { value: "general_director", label: "Генеральный директор" },
  { value: "manager", label: "Управляющий" },
  { value: "chairman", label: "Председатель" },
  { value: "president", label: "Президент" },
  { value: "ceo", label: "Исполнительный директор" },
  { value: "custom", label: "Другое..." },
];

// Предустановленные основания для подписи
const ACTS_ON_BASIS_OPTIONS = [
  { value: "charter", label: "Устава" },
  { value: "poa", label: "Доверенности" },
  { value: "regulations", label: "Положения" },
  { value: "order", label: "Приказа" },
  { value: "custom", label: "Другое..." },
];

interface ExecutorFormData {
  full_name: string;
  short_name: string;
  unp: string;
  legal_address: string;
  bank_name: string;
  bank_code: string;
  bank_account: string;
  director_position: string;
  director_position_type: string;
  director_full_name: string;
  acts_on_basis: string;
  acts_on_basis_type: string;
  acts_on_basis_details: string;
  phone: string;
  email: string;
  signature_url: string;
}

const defaultFormData: ExecutorFormData = {
  full_name: "",
  short_name: "",
  unp: "",
  legal_address: "",
  bank_name: "",
  bank_code: "",
  bank_account: "",
  director_position: "Директор",
  director_position_type: "director",
  director_full_name: "",
  acts_on_basis: "Устава",
  acts_on_basis_type: "charter",
  acts_on_basis_details: "",
  phone: "",
  email: "",
  signature_url: "",
};

// Генерация краткого ФИО из полного
function generateShortName(fullName: string): string {
  if (!fullName.trim()) return "";
  
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "";
  
  // Фамилия + инициалы
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  
  // Фамилия И.О.
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

// Генерация полного текста "действует на основании"
function generateActsOnBasisText(type: string, basis: string, details: string): string {
  if (type === "poa" && details) {
    return `доверенности ${details}`;
  }
  return basis;
}

export default function AdminExecutors() {
  const { executors, isLoading: executorsLoading, createExecutor, updateExecutor, deleteExecutor, setDefault: setDefaultExecutor, isCreating, isUpdating } = useExecutors();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ExecutorFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  // Автогенерация краткого ФИО
  const directorShortName = useMemo(() => {
    return generateShortName(formData.director_full_name);
  }, [formData.director_full_name]);

  const handleOpenDialog = (executor?: Executor) => {
    if (executor) {
      setEditingId(executor.id);
      
      // Определяем тип должности
      let positionType = "custom";
      const positionMatch = DIRECTOR_POSITIONS.find(p => p.label === executor.director_position);
      if (positionMatch) positionType = positionMatch.value;
      
      // Определяем тип основания
      let basisType = "custom";
      const basisText = executor.acts_on_basis || "";
      if (basisText === "Устава") basisType = "charter";
      else if (basisText === "Положения") basisType = "regulations";
      else if (basisText === "Приказа") basisType = "order";
      else if (basisText.toLowerCase().includes("доверенност")) basisType = "poa";
      
      // Извлекаем детали доверенности
      let basisDetails = "";
      if (basisType === "poa") {
        const match = basisText.match(/доверенности\s*(.+)/i);
        if (match) basisDetails = match[1];
      }
      
      setFormData({
        full_name: executor.full_name,
        short_name: executor.short_name || "",
        unp: executor.unp,
        legal_address: executor.legal_address,
        bank_name: executor.bank_name,
        bank_code: executor.bank_code,
        bank_account: executor.bank_account,
        director_position: executor.director_position || "Директор",
        director_position_type: positionType,
        director_full_name: executor.director_full_name || "",
        acts_on_basis: basisText || "Устава",
        acts_on_basis_type: basisType,
        acts_on_basis_details: basisDetails,
        phone: executor.phone || "",
        email: executor.email || "",
        signature_url: executor.signature_url || "",
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

  const handlePositionTypeChange = (value: string) => {
    const selected = DIRECTOR_POSITIONS.find(p => p.value === value);
    setFormData({
      ...formData,
      director_position_type: value,
      director_position: value === "custom" ? formData.director_position : (selected?.label || "Директор"),
    });
  };

  const handleBasisTypeChange = (value: string) => {
    const selected = ACTS_ON_BASIS_OPTIONS.find(o => o.value === value);
    setFormData({
      ...formData,
      acts_on_basis_type: value,
      acts_on_basis: value === "custom" ? formData.acts_on_basis : (selected?.label || "Устава"),
      acts_on_basis_details: value === "poa" ? formData.acts_on_basis_details : "",
    });
  };

  const handleSubmit = async () => {
    if (!formData.full_name || !formData.unp || !formData.legal_address || !formData.bank_name || !formData.bank_code || !formData.bank_account) {
      toast.error("Заполните обязательные поля");
      return;
    }

    // Формируем текст "действует на основании"
    const actsOnBasis = generateActsOnBasisText(
      formData.acts_on_basis_type,
      formData.acts_on_basis,
      formData.acts_on_basis_details
    );

    try {
      const payload = {
        full_name: formData.full_name,
        short_name: formData.short_name,
        unp: formData.unp,
        legal_address: formData.legal_address,
        bank_name: formData.bank_name,
        bank_code: formData.bank_code,
        bank_account: formData.bank_account,
        director_position: formData.director_position,
        director_full_name: formData.director_full_name,
        director_short_name: directorShortName, // Автогенерируется
        acts_on_basis: actsOnBasis,
        phone: formData.phone,
        email: formData.email,
        signature_url: formData.signature_url || null,
      };

      if (editingId) {
        await updateExecutor({ id: editingId, ...payload });
      } else {
        await createExecutor(payload);
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Исполнители</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Юридические лица для договоров и актов
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Наименование</TableHead>
                      <TableHead className="hidden sm:table-cell">УНП</TableHead>
                      <TableHead className="hidden md:table-cell">Банк</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executors.map((executor) => (
                      <TableRow key={executor.id}>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
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
                        </TableCell>
                        <TableCell className="font-mono hidden sm:table-cell">{executor.unp}</TableCell>
                        <TableCell className="hidden md:table-cell">
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
                              className="hidden sm:inline-flex"
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
              </div>
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
            {/* Наименование */}
            <div>
              <Label>Полное наименование *</Label>
              <Input
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder='Закрытое акционерное общество "АЖУР инкам"'
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Краткое наименование</Label>
                <Input
                  value={formData.short_name}
                  onChange={(e) => setFormData({ ...formData, short_name: e.target.value })}
                  placeholder='ЗАО "АЖУР инкам"'
                />
              </div>
              <div>
                <Label>УНП *</Label>
                <Input
                  value={formData.unp}
                  onChange={(e) => setFormData({ ...formData, unp: e.target.value })}
                  placeholder="123456789"
                  maxLength={9}
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

            {/* Банковские реквизиты */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

            {/* Руководитель */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Подписант</h4>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Должность</Label>
                  <Select value={formData.director_position_type} onValueChange={handlePositionTypeChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите должность" />
                    </SelectTrigger>
                    <SelectContent>
                      {DIRECTOR_POSITIONS.map((pos) => (
                        <SelectItem key={pos.value} value={pos.value}>{pos.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {formData.director_position_type === "custom" && (
                  <div>
                    <Label>Укажите должность</Label>
                    <Input
                      value={formData.director_position}
                      onChange={(e) => setFormData({ ...formData, director_position: e.target.value })}
                      placeholder="Введите должность"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <Label>ФИО руководителя (полное)</Label>
                  <Input
                    value={formData.director_full_name}
                    onChange={(e) => setFormData({ ...formData, director_full_name: e.target.value })}
                    placeholder="Иванов Иван Иванович"
                  />
                </div>
                <div>
                  <Label>ФИО (краткое) — автоматически</Label>
                  <Input
                    value={directorShortName}
                    readOnly
                    className="bg-muted"
                    placeholder="Иванов И.И."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <Label>Действует на основании</Label>
                  <Select value={formData.acts_on_basis_type} onValueChange={handleBasisTypeChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите основание" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTS_ON_BASIS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {formData.acts_on_basis_type === "custom" && (
                  <div>
                    <Label>Укажите основание</Label>
                    <Input
                      value={formData.acts_on_basis}
                      onChange={(e) => setFormData({ ...formData, acts_on_basis: e.target.value })}
                      placeholder="Введите основание"
                    />
                  </div>
                )}
                {formData.acts_on_basis_type === "poa" && (
                  <div>
                    <Label>Номер и дата доверенности</Label>
                    <Input
                      value={formData.acts_on_basis_details}
                      onChange={(e) => setFormData({ ...formData, acts_on_basis_details: e.target.value })}
                      placeholder="№123 от 01.01.2025"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Контакты */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Контакты</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Телефон</Label>
                  <PhoneInput
                    value={formData.phone}
                    onChange={(value) => setFormData({ ...formData, phone: value })}
                    placeholder="29 123 45 67"
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

            {/* Подпись */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Подпись (изображение)</h4>
              <div className="flex items-start gap-4">
                {formData.signature_url ? (
                  <div className="relative">
                    <img 
                      src={formData.signature_url} 
                      alt="Подпись" 
                      className="h-20 object-contain border rounded bg-white p-2"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => setFormData({ ...formData, signature_url: "" })}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <input
                      ref={signatureInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        if (file.size > 2 * 1024 * 1024) {
                          toast.error("Файл слишком большой (макс. 2 МБ)");
                          return;
                        }
                        
                        setIsUploadingSignature(true);
                        try {
                          const fileExt = file.name.split('.').pop();
                          const fileName = `${Date.now()}.${fileExt}`;
                          const filePath = `signatures/${fileName}`;
                          
                          const { error: uploadError } = await supabase.storage
                            .from("signatures")
                            .upload(filePath, file, { upsert: true });
                          
                          if (uploadError) throw uploadError;
                          
                          const { data: urlData } = supabase.storage
                            .from("signatures")
                            .getPublicUrl(filePath);
                          
                          setFormData({ ...formData, signature_url: urlData.publicUrl });
                          toast.success("Подпись загружена");
                        } catch (error) {
                          console.error("Upload error:", error);
                          toast.error("Ошибка загрузки");
                        } finally {
                          setIsUploadingSignature(false);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => signatureInputRef.current?.click()}
                      disabled={isUploadingSignature}
                    >
                      {isUploadingSignature ? (
                        "Загрузка..."
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Загрузить PNG/JPG
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Рекомендуемый размер: 200x100 пикселей, прозрачный фон
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleCloseDialog} className="w-full sm:w-auto">Отмена</Button>
            <Button onClick={handleSubmit} disabled={isCreating || isUpdating} className="w-full sm:w-auto">
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