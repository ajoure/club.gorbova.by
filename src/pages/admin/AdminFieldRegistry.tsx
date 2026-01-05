import { useState } from 'react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Plus, 
  Search, 
  Copy, 
  Pencil, 
  Trash2, 
  Lock,
  Database,
  Link2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useFields,
  useCreateField,
  useUpdateField,
  useDeleteField,
  Field,
  FieldEntityType,
  FieldDataType,
  ENTITY_TYPE_LABELS,
  DATA_TYPE_LABELS,
  getFieldPlaceholder,
} from '@/hooks/useFields';

const ENTITY_TYPES: FieldEntityType[] = [
  'client', 'order', 'subscription', 'product', 'tariff', 'payment', 'company', 'telegram_member'
];

const DATA_TYPES: FieldDataType[] = [
  'string', 'number', 'boolean', 'date', 'datetime', 'money', 'enum', 'json', 'email', 'phone'
];

export default function AdminFieldRegistry() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FieldEntityType | 'all'>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [deleteField, setDeleteField] = useState<Field | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    entity_type: 'client' as FieldEntityType,
    key: '',
    label: '',
    data_type: 'string' as FieldDataType,
    is_required: false,
    default_value: '',
    description: '',
    external_id_amo: '',
    external_id_gc: '',
    external_id_b24: '',
  });
  
  const { data: fields, isLoading } = useFields();
  const createField = useCreateField();
  const updateField = useUpdateField();
  const deleteFieldMutation = useDeleteField();
  
  const filteredFields = fields?.filter(field => {
    const matchesSearch = !search || 
      field.key.toLowerCase().includes(search.toLowerCase()) ||
      field.label.toLowerCase().includes(search.toLowerCase());
    const matchesTab = activeTab === 'all' || field.entity_type === activeTab;
    return matchesSearch && matchesTab;
  }) || [];
  
  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('ID скопирован');
  };
  
  const handleCopyPlaceholder = (field: Field, type: 'id' | 'key') => {
    const placeholder = getFieldPlaceholder(field);
    navigator.clipboard.writeText(type === 'id' ? placeholder.byId : placeholder.byKey);
    toast.success('Плейсхолдер скопирован');
  };
  
  const openCreateDialog = () => {
    setFormData({
      entity_type: 'client',
      key: '',
      label: '',
      data_type: 'string',
      is_required: false,
      default_value: '',
      description: '',
      external_id_amo: '',
      external_id_gc: '',
      external_id_b24: '',
    });
    setEditingField(null);
    setShowCreateDialog(true);
  };
  
  const openEditDialog = (field: Field) => {
    setFormData({
      entity_type: field.entity_type,
      key: field.key,
      label: field.label,
      data_type: field.data_type,
      is_required: field.is_required,
      default_value: field.default_value || '',
      description: field.description || '',
      external_id_amo: field.external_id_amo || '',
      external_id_gc: field.external_id_gc || '',
      external_id_b24: field.external_id_b24 || '',
    });
    setEditingField(field);
    setShowCreateDialog(true);
  };
  
  const handleSubmit = async () => {
    if (!formData.key || !formData.label) {
      toast.error('Заполните обязательные поля');
      return;
    }
    
    if (editingField) {
      await updateField.mutateAsync({
        id: editingField.id,
        ...formData,
        default_value: formData.default_value || null,
        description: formData.description || null,
        external_id_amo: formData.external_id_amo || null,
        external_id_gc: formData.external_id_gc || null,
        external_id_b24: formData.external_id_b24 || null,
      });
    } else {
      await createField.mutateAsync({
        ...formData,
        is_system: false,
        is_active: true,
        display_order: 100,
        enum_options: null,
        validation_rules: null,
        default_value: formData.default_value || null,
        description: formData.description || null,
        external_id_amo: formData.external_id_amo || null,
        external_id_gc: formData.external_id_gc || null,
        external_id_b24: formData.external_id_b24 || null,
      });
    }
    
    setShowCreateDialog(false);
  };
  
  const handleDelete = async () => {
    if (!deleteField) return;
    await deleteFieldMutation.mutateAsync(deleteField.id);
    setDeleteField(null);
  };
  
  const countByEntity = (entityType: FieldEntityType) => {
    return fields?.filter(f => f.entity_type === entityType).length || 0;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Справочник полей</h1>
            <p className="text-muted-foreground">
              Управление полями системы для интеграций и шаблонов
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить поле
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Всего полей</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fields?.length || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Системных</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {fields?.filter(f => f.is_system).length || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Пользовательских</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {fields?.filter(f => !f.is_system).length || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>С маппингом CRM</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {fields?.filter(f => f.external_id_amo || f.external_id_gc || f.external_id_b24).length || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по ключу или названию..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)}>
              <TabsList className="flex-wrap h-auto gap-1">
                <TabsTrigger value="all">
                  Все <Badge variant="secondary" className="ml-1">{fields?.length || 0}</Badge>
                </TabsTrigger>
                {ENTITY_TYPES.map(type => (
                  <TabsTrigger key={type} value={type}>
                    {ENTITY_TYPE_LABELS[type]} 
                    <Badge variant="secondary" className="ml-1">{countByEntity(type)}</Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="mt-4">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
              ) : filteredFields.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Поля не найдены</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ключ</TableHead>
                      <TableHead>Название</TableHead>
                      <TableHead>Тип данных</TableHead>
                      <TableHead>Сущность</TableHead>
                      <TableHead className="text-center">Обязательное</TableHead>
                      <TableHead>Интеграции</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFields.map((field) => (
                      <TableRow key={field.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {field.is_system && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Lock className="h-3 w-3 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent>Системное поле</TooltipContent>
                              </Tooltip>
                            )}
                            <code className="text-sm bg-muted px-1 rounded">{field.key}</code>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{field.label}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{DATA_TYPE_LABELS[field.data_type]}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ENTITY_TYPE_LABELS[field.entity_type]}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {field.is_required ? (
                            <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {field.external_id_amo && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="outline" className="text-xs">amo</Badge>
                                </TooltipTrigger>
                                <TooltipContent>amoCRM: {field.external_id_amo}</TooltipContent>
                              </Tooltip>
                            )}
                            {field.external_id_gc && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="outline" className="text-xs">GC</Badge>
                                </TooltipTrigger>
                                <TooltipContent>GetCourse: {field.external_id_gc}</TooltipContent>
                              </Tooltip>
                            )}
                            {field.external_id_b24 && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="outline" className="text-xs">B24</Badge>
                                </TooltipTrigger>
                                <TooltipContent>Bitrix24: {field.external_id_b24}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleCopyId(field.id)}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Скопировать ID</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleCopyPlaceholder(field, 'id')}
                                >
                                  <Link2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Скопировать плейсхолдер</TooltipContent>
                            </Tooltip>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(field)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {!field.is_system && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteField(field)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingField ? 'Редактировать поле' : 'Новое поле'}
            </DialogTitle>
            <DialogDescription>
              {editingField?.is_system 
                ? 'Системное поле - доступно только редактирование маппинга интеграций'
                : 'Заполните параметры поля'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Сущность *</Label>
                <Select
                  value={formData.entity_type}
                  onValueChange={(val) => setFormData({ ...formData, entity_type: val as FieldEntityType })}
                  disabled={!!editingField}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {ENTITY_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Тип данных *</Label>
                <Select
                  value={formData.data_type}
                  onValueChange={(val) => setFormData({ ...formData, data_type: val as FieldDataType })}
                  disabled={editingField?.is_system}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {DATA_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ключ (key) *</Label>
              <Input
                value={formData.key}
                onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                placeholder="например: custom_field"
                disabled={editingField?.is_system}
              />
            </div>

            <div className="space-y-2">
              <Label>Название *</Label>
              <Input
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="Отображаемое название"
              />
            </div>

            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Описание поля..."
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="is_required"
                checked={formData.is_required}
                onCheckedChange={(checked) => setFormData({ ...formData, is_required: !!checked })}
                disabled={editingField?.is_system}
              />
              <Label htmlFor="is_required">Обязательное поле</Label>
            </div>

            <div className="border-t pt-4">
              <Label className="text-sm text-muted-foreground mb-2 block">Маппинг интеграций</Label>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">amoCRM ID</Label>
                  <Input
                    value={formData.external_id_amo}
                    onChange={(e) => setFormData({ ...formData, external_id_amo: e.target.value })}
                    placeholder="ID поля"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GetCourse ID</Label>
                  <Input
                    value={formData.external_id_gc}
                    onChange={(e) => setFormData({ ...formData, external_id_gc: e.target.value })}
                    placeholder="ID поля"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bitrix24 ID</Label>
                  <Input
                    value={formData.external_id_b24}
                    onChange={(e) => setFormData({ ...formData, external_id_b24: e.target.value })}
                    placeholder="ID поля"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Отмена
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={createField.isPending || updateField.isPending}
            >
              {editingField ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteField} onOpenChange={() => setDeleteField(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить поле?</DialogTitle>
            <DialogDescription>
              Поле "{deleteField?.label}" будет удалено. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteField(null)}>
              Отмена
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete}
              disabled={deleteFieldMutation.isPending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
