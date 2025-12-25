import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminContent, ContentItem, ContentFormData } from "@/hooks/useAdminContent";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Search, 
  Plus,
  Edit,
  Eye,
  EyeOff,
  Trash2,
  FileText,
  Video,
  BookOpen,
  Loader2
} from "lucide-react";

export default function AdminContent() {
  const { hasPermission } = usePermissions();
  const { items, loading, createContent, updateContent, deleteContent, publishContent, hideContent } = useAdminContent();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [editDialog, setEditDialog] = useState<{ open: boolean; item: ContentItem | null }>({
    open: false,
    item: null,
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ContentItem | null }>({
    open: false,
    item: null,
  });
  const [formData, setFormData] = useState<ContentFormData>({
    title: "",
    type: "article",
    content: "",
    status: "draft",
    access_level: "free",
  });
  const [saving, setSaving] = useState(false);

  const canEdit = hasPermission("content.edit");
  const canPublish = hasPermission("content.publish");

  const filteredContent = items.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase());
    const matchesTab = activeTab === "all" || item.type === activeTab;
    return matchesSearch && matchesTab;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "article":
        return <FileText className="w-4 h-4" />;
      case "video":
        return <Video className="w-4 h-4" />;
      case "course":
        return <BookOpen className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case "article":
        return "Статья";
      case "video":
        return "Видео";
      case "course":
        return "Курс";
      default:
        return type;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><Eye className="w-3 h-3 mr-1" />Опубликован</Badge>;
      case "draft":
        return <Badge variant="secondary"><Edit className="w-3 h-3 mr-1" />Черновик</Badge>;
      case "hidden":
        return <Badge variant="outline"><EyeOff className="w-3 h-3 mr-1" />Скрыт</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getAccessBadge = (level: string) => {
    switch (level) {
      case "free":
        return <Badge variant="outline" className="border-blue-500/30 text-blue-400">Бесплатный</Badge>;
      case "paid":
        return <Badge variant="outline" className="border-yellow-500/30 text-yellow-400">Платный</Badge>;
      case "premium":
        return <Badge variant="outline" className="border-purple-500/30 text-purple-400">Премиум</Badge>;
      default:
        return <Badge variant="outline">{level}</Badge>;
    }
  };

  const openEditDialog = (item: ContentItem | null) => {
    if (item) {
      setFormData({
        title: item.title,
        type: item.type,
        content: item.content || "",
        status: item.status,
        access_level: item.access_level,
      });
    } else {
      setFormData({
        title: "",
        type: "article",
        content: "",
        status: "draft",
        access_level: "free",
      });
    }
    setEditDialog({ open: true, item });
  };

  const handleSaveContent = async () => {
    if (!formData.title.trim()) {
      return;
    }

    setSaving(true);
    let success: boolean;

    if (editDialog.item) {
      success = await updateContent(editDialog.item.id, formData);
    } else {
      success = await createContent(formData);
    }

    setSaving(false);
    if (success) {
      setEditDialog({ open: false, item: null });
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog.item) return;
    
    const success = await deleteContent(deleteDialog.item.id);
    if (success) {
      setDeleteDialog({ open: false, item: null });
    }
  };

  const handlePublish = async (item: ContentItem) => {
    await publishContent(item.id);
  };

  const handleHide = async (item: ContentItem) => {
    await hideContent(item.id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Управление контентом</h1>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {canEdit && (
            <Button onClick={() => openEditDialog(null)}>
              <Plus className="w-4 h-4 mr-2" />
              Добавить
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">Все ({items.length})</TabsTrigger>
          <TabsTrigger value="article">Статьи ({items.filter(i => i.type === "article").length})</TabsTrigger>
          <TabsTrigger value="video">Видео ({items.filter(i => i.type === "video").length})</TabsTrigger>
          <TabsTrigger value="course">Курсы ({items.filter(i => i.type === "course").length})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <GlassCard>
            {filteredContent.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {search ? "Ничего не найдено" : "Контент пока не добавлен"}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Доступ</TableHead>
                    <TableHead>Обновлен</TableHead>
                    <TableHead className="w-[150px]">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContent.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getTypeIcon(item.type)}
                          <span>{getTypeName(item.type)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell>{getAccessBadge(item.access_level)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(item.updated_at), "dd MMM yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(item)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {canPublish && item.status !== "published" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handlePublish(item)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          {canPublish && item.status === "published" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleHide(item)}
                            >
                              <EyeOff className="w-4 h-4" />
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteDialog({ open: true, item })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </GlassCard>
        </TabsContent>
      </Tabs>

      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog({ ...editDialog, open })}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editDialog.item ? "Редактировать контент" : "Добавить контент"}</DialogTitle>
            <DialogDescription>
              {editDialog.item ? "Измените данные контента" : "Заполните данные нового контента"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Название</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Введите название"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Тип контента</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: "article" | "video" | "course") => 
                    setFormData({ ...formData, type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="article">Статья</SelectItem>
                    <SelectItem value="video">Видео</SelectItem>
                    <SelectItem value="course">Курс</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Уровень доступа</Label>
                <Select
                  value={formData.access_level}
                  onValueChange={(value: "free" | "paid" | "premium") => 
                    setFormData({ ...formData, access_level: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Бесплатный</SelectItem>
                    <SelectItem value="paid">Платный</SelectItem>
                    <SelectItem value="premium">Премиум</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Статус</Label>
              <Select
                value={formData.status}
                onValueChange={(value: "draft" | "published" | "hidden") => 
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Черновик</SelectItem>
                  <SelectItem value="published">Опубликован</SelectItem>
                  <SelectItem value="hidden">Скрыт</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Содержимое</Label>
              <Textarea
                id="content"
                rows={6}
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Введите содержимое..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, item: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveContent} disabled={saving || !formData.title.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить контент?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить "{deleteDialog.item?.title}"? Это действие нельзя отменить.
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
    </div>
  );
}
