import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSitePages } from "@/hooks/useSitePages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, FileText, Globe, Loader2, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function AdminSiteBuilder() {
  const navigate = useNavigate();
  const { pages, isLoading, createPage, deletePage, isCreating } = useSitePages();
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");

  const handleCreate = () => {
    if (!newTitle.trim() || !newSlug.trim()) return;
    createPage(
      { title: newTitle.trim(), slug: newSlug.trim().toLowerCase() },
      {
        onSuccess: (page) => {
          setCreateOpen(false);
          setNewTitle("");
          setNewSlug("");
          navigate(`/admin/sites/${page.id}`);
        },
      } as any
    );
  };

  const handleSlugChange = (value: string) => {
    setNewSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/--+/g, "-"));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Конструктор сайтов</h1>
          <p className="text-muted-foreground">Создавайте и управляйте лендингами</p>
        </div>
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

      {pages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Страницы ещё не созданы</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pages.map((page) => (
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
  );
}
