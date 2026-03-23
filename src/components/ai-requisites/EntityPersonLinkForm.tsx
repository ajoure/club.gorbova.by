/**
 * EntityPersonLinkForm — dialog form for creating/editing an entity↔person link.
 * Conditional fields based on role_type. Sanitizes before submit.
 * Supports reassign: PersonPicker is always enabled, confirm shown on person change.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { PersonPicker } from "./PersonPicker";
import { PositionPicker } from "./PositionPicker";
import type { PersonRow } from "@/hooks/useAiPersons";
import type { RoleCatalogEntry, PositionCatalogEntry, LinkRow, LinkInsertPayload } from "@/hooks/useEntityPersonLinks";

interface EntityPersonLinkFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persons: PersonRow[];
  rolesCatalog: RoleCatalogEntry[];
  positionsCatalog: PositionCatalogEntry[];
  legalDetailsId: string;
  profileId: string;
  editingLink?: LinkRow | null;
  onSubmit: (payload: LinkInsertPayload) => Promise<any>;
  isSubmitting: boolean;
}

export function EntityPersonLinkForm({
  open,
  onOpenChange,
  persons,
  rolesCatalog,
  positionsCatalog,
  legalDetailsId,
  profileId,
  editingLink,
  onSubmit,
  isSubmitting,
}: EntityPersonLinkFormProps) {
  const [personId, setPersonId] = useState<string | null>(null);
  const [roleCatalogId, setRoleCatalogId] = useState<string>("");
  const [sharePercent, setSharePercent] = useState<string>("");
  const [positionCatalogId, setPositionCatalogId] = useState<string>("");
  const [customPositionText, setCustomPositionText] = useState("");
  const [customRoleText, setCustomRoleText] = useState("");
  const [actsOnBasis, setActsOnBasis] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [showReassignConfirm, setShowReassignConfirm] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<LinkInsertPayload | null>(null);

  const selectedRole = rolesCatalog.find((r) => r.id === roleCatalogId);
  const roleType = selectedRole?.role_type ?? "";

  // Prefill on edit
  useEffect(() => {
    if (open && editingLink) {
      setPersonId(editingLink.person_id);
      setRoleCatalogId(editingLink.role_catalog_id);
      setSharePercent(editingLink.share_percent != null ? String(editingLink.share_percent) : "");
      setPositionCatalogId(editingLink.position_catalog_id || "");
      setCustomPositionText(editingLink.custom_position_text || "");
      setCustomRoleText(editingLink.custom_role_text || "");
      setActsOnBasis(editingLink.acts_on_basis || "");
      setIsPrimary(editingLink.is_primary);
      setNotes(editingLink.notes || "");
    } else if (open && !editingLink) {
      setPersonId(null);
      setRoleCatalogId("");
      setSharePercent("");
      setPositionCatalogId("");
      setCustomPositionText("");
      setCustomRoleText("");
      setActsOnBasis("");
      setIsPrimary(false);
      setNotes("");
    }
  }, [open, editingLink]);

  const canSubmit =
    !!personId &&
    !!roleCatalogId &&
    (roleType !== "other" || customRoleText.trim().length > 0) &&
    (roleType !== "position" || positionCatalogId || customPositionText.trim().length > 0);

  const buildPayload = (): LinkInsertPayload => ({
    person_id: personId!,
    legal_details_id: legalDetailsId,
    role_catalog_id: roleCatalogId,
    role_type: roleType,
    profile_id: profileId,
    position_catalog_id: roleType === "position" && positionCatalogId ? positionCatalogId : null,
    custom_position_text: roleType === "position" && !positionCatalogId ? customPositionText.trim() || null : null,
    custom_role_text: roleType === "other" ? customRoleText.trim() || null : null,
    share_percent: roleType === "founder" && sharePercent ? Number(sharePercent) : null,
    acts_on_basis: actsOnBasis.trim() || null,
    is_primary: isPrimary,
    notes: notes.trim() || null,
  });

  const doSubmit = async (payload: LinkInsertPayload) => {
    try {
      if (editingLink) {
        const submitPayload: any = { ...payload, id: editingLink.id };
        if (editingLink.person_id !== payload.person_id) {
          submitPayload.old_person_id = editingLink.person_id;
        }
        await onSubmit(submitPayload);
      } else {
        await onSubmit(payload);
      }
      onOpenChange(false);
    } catch {
      // error handled by hook
    }
  };

  const handleSubmit = async () => {
    if (!personId || !roleCatalogId || !roleType) return;
    const payload = buildPayload();

    // If editing and person changed, show reassign confirm
    if (editingLink && personId !== editingLink.person_id) {
      setPendingPayload(payload);
      setShowReassignConfirm(true);
      return;
    }

    await doSubmit(payload);
  };

  const handleReassignConfirm = async () => {
    setShowReassignConfirm(false);
    if (pendingPayload) {
      await doSubmit(pendingPayload);
      setPendingPayload(null);
    }
  };

  const oldPersonName = editingLink
    ? persons.find(p => p.id === editingLink.person_id)?.full_name || "—"
    : "";
  const newPersonName = personId
    ? persons.find(p => p.id === personId)?.full_name || "—"
    : "";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLink ? "Редактировать связь" : "Добавить связь"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Person picker — always enabled */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Физлицо *</Label>
              <PersonPicker
                persons={persons}
                value={personId}
                onChange={setPersonId}
              />
            </div>

            {/* Role */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Роль *</Label>
              <Select value={roleCatalogId} onValueChange={setRoleCatalogId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите роль…" />
                </SelectTrigger>
                <SelectContent>
                  {rolesCatalog.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Founder: share_percent */}
            {roleType === "founder" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Доля (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={sharePercent}
                  onChange={(e) => setSharePercent(e.target.value)}
                  placeholder="например, 50"
                />
              </div>
            )}

            {/* Position: catalog or custom */}
            {roleType === "position" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Должность из справочника</Label>
                  <Select
                    value={positionCatalogId}
                    onValueChange={(v) => {
                      setPositionCatalogId(v);
                      if (v) setCustomPositionText("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите…" />
                    </SelectTrigger>
                    <SelectContent>
                      {positionsCatalog.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!positionCatalogId && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Или своя должность *</Label>
                    <Input
                      value={customPositionText}
                      onChange={(e) => setCustomPositionText(e.target.value)}
                      placeholder="Введите должность…"
                    />
                  </div>
                )}
              </>
            )}

            {/* Other: custom role text */}
            {roleType === "other" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Описание роли *</Label>
                <Input
                  value={customRoleText}
                  onChange={(e) => setCustomRoleText(e.target.value)}
                  placeholder="Введите роль…"
                />
              </div>
            )}

            {/* Acts on basis */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Действует на основании</Label>
              <Input
                value={actsOnBasis}
                onChange={(e) => setActsOnBasis(e.target.value)}
                placeholder="Устав, доверенность…"
              />
            </div>

            {/* Is primary */}
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Основной контакт</Label>
              <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Примечание</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Доп. информация…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingLink ? "Сохранить" : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign confirm dialog */}
      <AlertDialog open={showReassignConfirm} onOpenChange={setShowReassignConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сменить физлицо?</AlertDialogTitle>
            <AlertDialogDescription>
              Связь будет перевесена с «{oldPersonName}» на «{newPersonName}». Продолжить?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPayload(null)}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleReassignConfirm}>Подтвердить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
