import { useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
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
  FileText,
  Video,
  BookOpen,
  Loader2
} from "lucide-react";
import { toast } from "sonner";

// Mock content data for demonstration
interface ContentItem {
  id: string;
  title: string;
  type: "article" | "video" | "course";
  status: "draft" | "published" | "hidden";
  accessLevel: "free" | "paid" | "premium";
  createdAt: string;
  updatedAt: string;
}

const mockContent: ContentItem[] = [
  {
    id: "1",
    title: "Введение в финансовое планирование",
    type: "article",
    status: "published",
    accessLevel: "free",
    createdAt: "2024-01-15",
    updatedAt: "2024-01-20",
  },
  {
    id: "2",
    title: "Матрица Эйзенхауэра: Полное руководство",
    type: "video",
    status: "published",
    accessLevel: "paid",
    createdAt: "2024-01-10",
    updatedAt: "2024-01-18",
  },
  {
    id: "3",
    title: "Курс по личной эффективности",
    type: "course",
    status: "draft",
    accessLevel: "premium",
    createdAt: "2024-01-05",
    updatedAt: "2024-01-25",
  },
  {
    id: "4",
    title: "Колесо баланса: Как использовать",
    type: "article",
    status: "hidden",
    accessLevel: "free",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-22",
  },
];

export default function AdminContent() {
  const { hasPermission } = usePermissions();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [editDialog, setEditDialog] = useState<{ open: boolean; item: ContentItem | null }>({
    open: false,
    item: null,
  });
  const [loading] = useState(false);

  const canEdit = hasPermission("content.edit");
  const canPublish = hasPermission("content.publish");

  const filteredContent = mockContent.filter((item) => {
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

  const handleSaveContent = () => {
    toast.success("Контент сохранен");
    setEditDialog({ open: false, item: null });
  };

  const handlePublish = (item: ContentItem) => {
    toast.success(`${item.title} опубликован`);
  };

  const handleHide = (item: ContentItem) => {
    toast.success(`${item.title} скрыт`);
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
            <Button onClick={() => setEditDialog({ open: true, item: null })}>
              <Plus className="w-4 h-4 mr-2" />
              Добавить
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="article">Статьи</TabsTrigger>
          <TabsTrigger value="video">Видео</TabsTrigger>
          <TabsTrigger value="course">Курсы</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <GlassCard>
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
                    <TableCell>{getAccessBadge(item.accessLevel)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.updatedAt}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditDialog({ open: true, item })}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        )}
                        {canPublish && item.status !== "published" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePublish(item)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                        {canPublish && item.status === "published" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleHide(item)}
                          >
                            <EyeOff className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                defaultValue={editDialog.item?.title || ""}
                placeholder="Введите название"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Тип контента</Label>
                <Select defaultValue={editDialog.item?.type || "article"}>
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
                <Select defaultValue={editDialog.item?.accessLevel || "free"}>
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
              <Label htmlFor="content">Содержимое</Label>
              <Textarea
                id="content"
                rows={6}
                placeholder="Введите содержимое..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, item: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveContent}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
