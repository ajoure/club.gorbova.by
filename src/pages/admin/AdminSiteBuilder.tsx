import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSitePages, useSiteFolders } from "@/hooks/useSitePages";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Globe, Loader2, Trash2, FolderPlus, Folder, FolderOpen, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { SitePageFolder } from "@/services/sitePages/types";

export default function AdminSiteBuilder() {
  const navigate = useNavigate();
  const { pages, isLoading, createPage, deletePage, isCreating } = useSitePages();
  const { folders, isLoading: foldersLoading, createFolder, deleteFolder, isCreating: isCreatingFolder } = useSiteFolders();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newFolderId, setNewFolderId] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const handleCreate = () => {
    if (!newTitle.trim() || !newSlug.trim()) return;
    createPage(
      {
        title: newTitle.trim(),
        slug: newSlug.trim().toLowerCase(),
        folder_id: newFolderId && newFolderId !== "__none__" ? newFolderId : null,
      },
      {
        onSuccess: (page) => {
          setCreateOpen(false);
          setNewTitle("");
          setNewSlug("");
          setNewFolderId("");
          navigate(`/admin/sites/${page.id}`);
        },
      } as any
    );
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder(
      { name: newFolderName.trim() },
      {
        onSuccess: () => {
          setFolderOpen(false);
          setNewFolderName("");
        },
      } as any
    );
  };

  const handleSlugChange = (value: string) => {
    setNewSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/--+/g, "-"));
  };

  // Pages filtered by active folder
  const filteredPages = activeFolderId
    ? pages.filter((p) => p.folder_id === activeFolderId)
    : pages.filter((p) => !p.folder_id);

  const unfolderedCount = pages.filter((p) => !p.folder_id).length;

  if (isLoading || foldersLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Конструктор сайтов</h1>
            <p className="text-muted-foreground">Создавайте и управляйте лендингами</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Create Folder */}
            <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Папка
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Создать папку</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Название папки</Label>
                    <Input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Лендинги курсов"
                    />
                  </div>
                  <Button
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="w-full"
                  >
                    {isCreatingFolder ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Создать
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Create Page */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Новая страница
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Создать страницу</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Название</Label>
                    <Input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Название страницы"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug (URL-путь)</Label>
                    <Input
                      value={newSlug}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      placeholder="my-page"
                    />
                    <p className="text-xs text-muted-foreground">
                      Только латиница, цифры и дефис
                    </p>
                  </div>
                  {folders.length > 0 && (
                    <div className="space-y-2">
                      <Label>Папка</Label>
                      <Select value={newFolderId} onValueChange={setNewFolderId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Без папки" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Без папки</SelectItem>
                          {folders.map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button
                    onClick={handleCreate}
                    disabled={!newTitle.trim() || !newSlug.trim() || isCreating}
                    className="w-full"
                  >
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Создать
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Folder Navigation */}
        {folders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={activeFolderId === null ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFolderId(null)}
            >
              <FileText className="h-4 w-4 mr-1" />
              Все без папки
              <Badge variant="secondary" className="ml-1.5 text-xs">{unfolderedCount}</Badge>
            </Button>
            {folders.map((folder) => {
              const count = pages.filter((p) => p.folder_id === folder.id).length;
              const isActive = activeFolderId === folder.id;
              return (
                <div key={folder.id} className="flex items-center gap-0.5">
                  <Button
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveFolderId(isActive ? null : folder.id)}
                  >
                    {isActive ? <FolderOpen className="h-4 w-4 mr-1" /> : <Folder className="h-4 w-4 mr-1" />}
                    {folder.name}
                    <Badge variant="secondary" className="ml-1.5 text-xs">{count}</Badge>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Удалить папку «{folder.name}»?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Страницы из папки не удалятся, а станут без папки.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                          if (activeFolderId === folder.id) setActiveFolderId(null);
                          deleteFolder(folder.id);
                        }}>
                          Удалить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              );
            })}
          </div>
        )}

        {/* Breadcrumb */}
        {activeFolderId && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <button className="hover:text-foreground" onClick={() => setActiveFolderId(null)}>
              Все страницы
            </button>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">
              {folders.find((f) => f.id === activeFolderId)?.name}
            </span>
          </div>
        )}

        {/* Pages Grid */}
        {filteredPages.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {activeFolderId ? "В этой папке пока нет страниц" : "Страницы ещё не созданы"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPages.map((page) => (
              <Card
                key={page.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/admin/sites/${page.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{page.title}</CardTitle>
                    <Badge variant={page.status === "published" ? "default" : "secondary"}>
                      {page.status === "published" ? "Опубликована" : "Черновик"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <Globe className="h-3.5 w-3.5" />
                    <span>/{page.slug}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(page.created_at), "d MMM yyyy", { locale: ru })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {(page.blocks as unknown[])?.length || 0} блоков
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end" onClick={(e) => e.stopPropagation()}>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Удалить страницу?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Страница «{page.title}» будет удалена безвозвратно.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deletePage(page.id)}>
                            Удалить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
