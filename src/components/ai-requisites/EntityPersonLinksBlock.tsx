/**
 * EntityPersonLinksBlock — view-mode section for managing entity↔person links.
 * Shows list, add, edit, delete actions.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Users, Plus, Pencil, Trash2, Loader2, Star } from "lucide-react";
import { useEntityPersonLinks, type LinkRow } from "@/hooks/useEntityPersonLinks";
import { useAiPersons } from "@/hooks/useAiPersons";
import { EntityPersonLinkForm } from "./EntityPersonLinkForm";

interface EntityPersonLinksBlockProps {
  legalDetailsId: string;
  profileId: string;
}

export function EntityPersonLinksBlock({ legalDetailsId, profileId }: EntityPersonLinksBlockProps) {
  const {
    links,
    linksLoading,
    rolesCatalog,
    positionsCatalog,
    createLink,
    updateLink,
    deleteLink,
    isCreating,
    isUpdating,
    isDeleting,
  } = useEntityPersonLinks(legalDetailsId, profileId);

  const { allPersons } = useAiPersons();

  const [formOpen, setFormOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkRow | null>(null);
  const [deletingLink, setDeletingLink] = useState<LinkRow | null>(null);

  const handleAdd = () => {
    setEditingLink(null);
    setFormOpen(true);
  };

  const handleEdit = (link: LinkRow) => {
    setEditingLink(link);
    setFormOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingLink) return;
    try {
      await deleteLink({ id: deletingLink.id, person_id: deletingLink.person_id });
    } catch { /* handled */ }
    setDeletingLink(null);
  };

  const getRoleDetail = (link: LinkRow): string | null => {
    if (link.role_type === "founder" && link.share_percent != null) {
      return `${link.share_percent}%`;
    }
    if (link.role_type === "position") {
      return link.position_label || link.custom_position_text || null;
    }
    if (link.role_type === "other") {
      return link.custom_role_text || null;
    }
    return null;
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Связанные лица
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleAdd}>
              <Plus className="w-3 h-3" />
              Добавить
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {linksLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Нет связанных лиц</p>
          ) : (
            <div className="space-y-2">
              {links.map((link) => {
                const detail = getRoleDetail(link);
                return (
                  <div
                    key={link.id}
                    className="flex items-center justify-between rounded-md border bg-muted/30 p-3 gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">
                        {link.person_full_name || "Без имени"}
                      </span>
                      {link.is_primary && (
                        <Star className="w-3 h-3 text-amber-500 shrink-0" fill="currentColor" />
                      )}
                      <Badge variant="outline" className="text-xs shrink-0">
                        {link.role_label || link.role_type}
                      </Badge>
                      {detail && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {detail}
                        </Badge>
                      )}
                      {!link.person_is_active && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">неактивен</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleEdit(link)}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => setDeletingLink(link)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Link form dialog */}
      <EntityPersonLinkForm
        open={formOpen}
        onOpenChange={setFormOpen}
        persons={allPersons}
        rolesCatalog={rolesCatalog}
        positionsCatalog={positionsCatalog}
        legalDetailsId={legalDetailsId}
        profileId={profileId}
        editingLink={editingLink}
        onSubmit={editingLink ? (p) => updateLink({ ...p, id: editingLink.id, old_person_id: editingLink.person_id } as any) : createLink}
        isSubmitting={isCreating || isUpdating}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deletingLink} onOpenChange={(v) => !v && setDeletingLink(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить связь?</AlertDialogTitle>
            <AlertDialogDescription>
              Связь «{deletingLink?.person_full_name}» будет удалена. Само физлицо останется в базе.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={isDeleting}>
              {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
