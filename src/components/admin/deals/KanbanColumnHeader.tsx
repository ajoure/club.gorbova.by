import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MoreHorizontal, Pencil, Trash2, Shield, Palette } from "lucide-react";
import type { CrmPipelineStage } from "@/services/pipelineService";
import { STAGE_PALETTE } from "@/lib/stagePalette";

interface Props {
  name: string;
  color: string;
  stageType: "open" | "closed_won" | "closed_lost";
  count: number;
  sum: number;
  avg: number;
  canEdit: boolean;
  onRename?: (name: string) => void;
  onDelete?: (targetStageId: string) => void;
  onChangeColor?: (color: string) => void;
  availableStages: CrmPipelineStage[];
  hasDeals: boolean;
  // Bulk selection props
  selectedCount?: number;
  totalInStage?: number;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  bulkMode?: boolean;
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency: "BYN",
    maximumFractionDigits: 0,
  }).format(v);

export function KanbanColumnHeader({
  name,
  color,
  stageType,
  count,
  sum,
  avg,
  canEdit,
  onRename,
  onDelete,
  onChangeColor,
  availableStages,
  hasDeals,
  selectedCount = 0,
  totalInStage = 0,
  onSelectAll,
  onDeselectAll,
  bulkMode,
}: Props) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [remapTargetId, setRemapTargetId] = useState<string>("");
  const [showColorPicker, setShowColorPicker] = useState(false);

  const isClosed = stageType !== "open";

  const handleRename = () => {
    if (renameValue.trim() && onRename) {
      onRename(renameValue.trim());
    }
    setIsRenaming(false);
  };

  const handleDelete = () => {
    if (remapTargetId && onDelete) {
      onDelete(remapTargetId);
      setShowDeleteDialog(false);
    }
  };

  const isAllSelected = totalInStage > 0 && selectedCount === totalInStage;
  const isIndeterminate = selectedCount > 0 && selectedCount < totalInStage;

  const handleCheckboxChange = () => {
    if (isAllSelected || isIndeterminate) {
      onDeselectAll?.();
    } else {
      onSelectAll?.();
    }
  };

  return (
    <>
      <div className="p-3 border-b border-border/20 sticky top-0 z-10 backdrop-blur-xl rounded-t-2xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Bulk selection checkbox — only visible in bulk mode */}
            {bulkMode && totalInStage > 0 && onSelectAll && (
              <Checkbox
                checked={isIndeterminate ? "indeterminate" : isAllSelected}
                onCheckedChange={handleCheckboxChange}
                className="shrink-0"
                aria-label={`Выделить все сделки в стадии ${name}`}
              />
            )}
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            {isRenaming ? (
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setIsRenaming(false);
                }}
                className="h-6 text-sm font-semibold px-1"
                autoFocus
              />
            ) : (
              <span className="text-sm font-semibold truncate">{name}</span>
            )}
            {isClosed && (
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {selectedCount > 0 && (
              <Badge variant="default" className="h-5 text-[10px] px-1.5 font-semibold bg-primary/20 text-primary">
                {selectedCount}
              </Badge>
            )}
            <Badge variant="secondary" className="h-5 text-[10px] px-1.5 font-semibold">
              {count}
            </Badge>
            {canEdit && (onRename || onDelete || onChangeColor) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {onRename && (
                    <DropdownMenuItem onClick={() => { setRenameValue(name); setIsRenaming(true); }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      Переименовать
                    </DropdownMenuItem>
                  )}
                  {onChangeColor && (
                    <DropdownMenuItem onClick={() => setShowColorPicker(true)}>
                      <Palette className="h-3.5 w-3.5 mr-2" />
                      Сменить цвет
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          if (!hasDeals) {
                            const target = availableStages.find(s => s.stage_type === 'open' && s.is_default) || availableStages[0];
                            if (target) onDelete(target.id);
                          } else {
                            setRemapTargetId(availableStages[0]?.id || "");
                            setShowDeleteDialog(true);
                          }
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Удалить стадию
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Sum / avg row */}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
          <span>{formatCurrency(sum)}</span>
          {count > 0 && (
            <span className="opacity-60">ø {formatCurrency(avg)}</span>
          )}
        </div>
      </div>

      {/* Color picker dialog */}
      <Dialog open={showColorPicker} onOpenChange={setShowColorPicker}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Цвет стадии</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 justify-center py-2">
            {STAGE_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onChangeColor?.(c);
                  setShowColorPicker(false);
                }}
                className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                  color.toLowerCase() === c.toLowerCase()
                    ? "border-foreground ring-2 ring-foreground/20"
                    : "border-transparent hover:border-border"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Remap delete dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить стадию «{name}»</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            В этой стадии {count} сделок. Выберите стадию, в которую перенести сделки перед удалением:
          </p>
          <div className="space-y-2">
            {availableStages.map((s) => (
              <button
                key={s.id}
                onClick={() => setRemapTargetId(s.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm text-left transition-all ${
                  remapTargetId === s.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60 hover:border-border"
                }`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-medium">{s.name}</span>
                {s.stage_type === "closed_won" && <Badge variant="secondary" className="ml-auto text-[9px] h-4 px-1">Успех</Badge>}
                {s.stage_type === "closed_lost" && <Badge variant="secondary" className="ml-auto text-[9px] h-4 px-1">Отказ</Badge>}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!remapTargetId}
            >
              Удалить и перенести
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
