import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
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
import { toast } from "sonner";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";

interface ArchiveCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveCleanupDialog({ open, onOpenChange }: ArchiveCleanupDialogProps) {
  const [confirmationInput, setConfirmationInput] = useState("");
  const queryClient = useQueryClient();

  // Fetch count of archive import records
  const { data: archiveCount, isLoading: countLoading } = useQuery({
    queryKey: ["archive-import-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders_v2")
        .select("*", { count: "exact", head: true })
        .eq("reconcile_source", "bepaid_archive_import");
      
      if (error) throw error;
      return count || 0;
    },
    enabled: open,
  });

  // Reset input when dialog opens
  useEffect(() => {
    if (open) {
      setConfirmationInput("");
    }
  }, [open]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Call the purge function
      const { data, error } = await supabase.functions.invoke("admin-purge-imported-transactions", {
        body: {
          reconcile_source: "bepaid_archive_import",
          dry_run: false,
          limit: 10000,
          batch_size: 100,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const cancelled = data?.report?.cancelled || 0;
      toast.success(`Удалено ${cancelled} архивных сделок`);
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["archive-import-count"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error("Ошибка удаления: " + (error.message || String(error)));
    },
  });

  const isConfirmValid = confirmationInput === String(archiveCount);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Удаление архивного импорта
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              Это действие отменит все сделки, импортированные из архива bePaid 
              (источник: <code className="text-xs bg-muted px-1 py-0.5 rounded">bepaid_archive_import</code>).
            </p>
            
            {countLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Подсчёт записей...
              </div>
            ) : archiveCount === 0 ? (
              <p className="text-green-600 font-medium">
                Архивных записей не найдено.
              </p>
            ) : (
              <p className="text-destructive font-medium">
                Будет удалено: <strong>{archiveCount}</strong> сделок
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {archiveCount && archiveCount > 0 && (
          <div className="space-y-2 py-2">
            <Label htmlFor="confirm-count">
              Введите число <strong>{archiveCount}</strong> для подтверждения:
            </Label>
            <Input
              id="confirm-count"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={String(archiveCount)}
              className="font-mono"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>
            Отмена
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={!isConfirmValid || deleteMutation.isPending || !archiveCount}
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Удаление...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Удалить архив
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
