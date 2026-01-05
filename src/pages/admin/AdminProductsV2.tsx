import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Package, Globe, Users, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useProductsV2, useCreateProductV2, useUpdateProductV2, useDeleteProductV2 } from "@/hooks/useProductsV2";
import { useTelegramClubs } from "@/hooks/useTelegramIntegration";
import { useNavigate } from "react-router-dom";

interface ProductFormData {
  code: string;
  name: string;
  description: string;
  slug: string;
  status: string;
  primary_domain: string;
  currency: string;
  public_title: string;
  public_subtitle: string;
  payment_disclaimer_text: string;
  telegram_club_id: string | null;
  is_active: boolean;
}

const defaultFormData: ProductFormData = {
  code: "",
  name: "",
  description: "",
  slug: "",
  status: "active",
  primary_domain: "",
  currency: "BYN",
  public_title: "",
  public_subtitle: "",
  payment_disclaimer_text: "",
  telegram_club_id: null,
  is_active: true,
};

export default function AdminProductsV2() {
  const navigate = useNavigate();
  const { data: products, isLoading } = useProductsV2();
  const { data: clubs } = useTelegramClubs();
  const createMutation = useCreateProductV2();
  const updateMutation = useUpdateProductV2();
  const deleteMutation = useDeleteProductV2();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleOpenDialog = (product?: any) => {
    if (product) {
      setEditingProduct(product.id);
      setFormData({
        code: product.code,
        name: product.name,
        description: product.description || "",
        slug: product.slug || "",
        status: product.status || "active",
        primary_domain: product.primary_domain || "",
        currency: product.currency || "BYN",
        public_title: product.public_title || "",
        public_subtitle: product.public_subtitle || "",
        payment_disclaimer_text: product.payment_disclaimer_text || "",
        telegram_club_id: product.telegram_club_id,
        is_active: product.is_active,
      });
    } else {
      setEditingProduct(null);
      setFormData(defaultFormData);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async () => {
    if (!formData.code || !formData.name) {
      toast.error("Заполните код и название");
      return;
    }

    const payload: any = {
      code: formData.code,
      name: formData.name,
      description: formData.description || null,
      slug: formData.slug || null,
      status: formData.status,
      primary_domain: formData.primary_domain || null,
      currency: formData.currency,
      public_title: formData.public_title || null,
      public_subtitle: formData.public_subtitle || null,
      payment_disclaimer_text: formData.payment_disclaimer_text || null,
      telegram_club_id: formData.telegram_club_id || null,
      is_active: formData.is_active,
    };

    if (editingProduct) {
      await updateMutation.mutateAsync({ id: editingProduct, ...payload });
      handleCloseDialog();
    } else {
      const newProduct = await createMutation.mutateAsync(payload);
      handleCloseDialog();
      // Navigate to product detail page to add tariffs
      if (newProduct?.id) {
        navigate(`/admin/products-v2/${newProduct.id}`);
        toast.info("Теперь добавьте тарифы для продукта");
      }
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmId) {
      await deleteMutation.mutateAsync(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const copyProductId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("ID скопирован");
  };

  const activeProducts = products?.filter(p => p.is_active).length || 0;
  const withDomain = products?.filter(p => (p as any).primary_domain).length || 0;
  const withClub = products?.filter(p => p.telegram_club_id).length || 0;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Продукты</h1>
            <p className="text-muted-foreground">
              Управление продуктами, доменами и тарифами
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить продукт
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{products?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">Всего продуктов</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Package className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{activeProducts}</p>
                  <p className="text-sm text-muted-foreground">Активных</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Globe className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{withDomain}</p>
                  <p className="text-sm text-muted-foreground">С доменом</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-purple-500/10 rounded-lg">
                  <Users className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{withClub}</p>
                  <p className="text-sm text-muted-foreground">С Telegram клубом</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Products Table */}
        <Card>
          <CardHeader>
            <CardTitle>Список продуктов</CardTitle>
            <CardDescription>
              Нажмите на продукт для настройки тарифов, кнопок оплаты и превью
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : !products?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                Нет продуктов. Создайте первый продукт.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Домен</TableHead>
                    <TableHead>Telegram клуб</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product: any) => (
                    <TableRow 
                      key={product.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/admin/products-v2/${product.id}`)}
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{product.name}</div>
                          <code className="text-xs bg-muted px-2 py-0.5 rounded">
                            {product.code}
                          </code>
                        </div>
                      </TableCell>
                      <TableCell>
                        {product.primary_domain ? (
                          <div className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{product.primary_domain}</span>
                            <a 
                              href={`https://${product.primary_domain}`} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Не указан</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {product.telegram_clubs?.name || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Badge variant={product.is_active ? "default" : "secondary"}>
                            {product.is_active ? "Активен" : "Неактивен"}
                          </Badge>
                          {product.status === "draft" && (
                            <Badge variant="outline">Черновик</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyProductId(product.id);
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDialog(product);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(product.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-4 w-4 text-muted-foreground ml-2" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Редактировать продукт" : "Новый продукт"}
            </DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Измените данные продукта"
                : "Заполните данные продукта. После создания вы перейдёте к настройке тарифов и цен."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Основные данные</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Код *</Label>
                  <Input
                    placeholder="gorbova_club"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Название *</Label>
                  <Input
                    placeholder="Gorbova Club"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Slug (URL)</Label>
                  <Input
                    placeholder="gorbova-club"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Статус</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(v) => setFormData({ ...formData, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Черновик</SelectItem>
                      <SelectItem value="active">Активный</SelectItem>
                      <SelectItem value="archived">Архивный</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea
                  placeholder="Описание продукта..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
            </div>

            {/* Domain & Currency */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Домен и валюта</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Основной домен</Label>
                  <Input
                    placeholder="club.gorbova.by"
                    value={formData.primary_domain}
                    onChange={(e) => setFormData({ ...formData, primary_domain: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Домен, на котором будет отображаться продукт
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Валюта</Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(v) => setFormData({ ...formData, currency: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BYN">BYN</SelectItem>
                      <SelectItem value="RUB">RUB</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Public Display */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Публичное отображение</h4>
              <div className="space-y-2">
                <Label>Заголовок секции тарифов</Label>
                <Input
                  placeholder="Тарифы клуба"
                  value={formData.public_title}
                  onChange={(e) => setFormData({ ...formData, public_title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Подзаголовок</Label>
                <Input
                  placeholder="Выберите подходящий формат участия"
                  value={formData.public_subtitle}
                  onChange={(e) => setFormData({ ...formData, public_subtitle: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Текст под тарифами (disclaimer)</Label>
                <Textarea
                  placeholder="Безопасная оплата через bePaid..."
                  value={formData.payment_disclaimer_text}
                  onChange={(e) => setFormData({ ...formData, payment_disclaimer_text: e.target.value })}
                />
              </div>
            </div>

            {/* Telegram & Status */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Интеграции</h4>
              <div className="space-y-2">
                <Label>Telegram клуб</Label>
                <Select
                  value={formData.telegram_club_id || "none"}
                  onValueChange={(v) =>
                    setFormData({ ...formData, telegram_club_id: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите клуб" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не привязан</SelectItem>
                    {clubs?.map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.club_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
                <Label>Активен</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Отмена
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingProduct ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить продукт?</DialogTitle>
            <DialogDescription>
              Это действие нельзя отменить. Все связанные тарифы и данные будут удалены.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
