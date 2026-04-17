import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchStages,
  createStage,
  renameStage,
  deleteStageWithRemap,
  reorderStages,
  updateStageColor,
  type CrmPipelineStage,
} from "@/services/pipelineService";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function usePipelineStages(pipelineId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["crm-pipeline-stages", pipelineId];

  const { data: stages = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchStages(pipelineId!),
    enabled: !!pipelineId,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  // Realtime: изменения стадий выбранной воронки → invalidate
  useEffect(() => {
    if (!pipelineId) return;
    const channel = supabase
      .channel(`crm-pipeline-stages-rt-${pipelineId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "crm_pipeline_stages",
          filter: `pipeline_id=eq.${pipelineId}`,
        },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, qc]);

  const createMut = useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) =>
      createStage(pipelineId!, name, color),
    onSuccess: () => { invalidate(); toast.success("Стадия создана"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameStage(id, name),
    onSuccess: () => { invalidate(); toast.success("Стадия переименована"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const colorMut = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) => updateStageColor(id, color),
    onSuccess: () => { invalidate(); toast.success("Цвет стадии обновлён"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: ({ stageId, targetStageId }: { stageId: string; targetStageId: string }) =>
      deleteStageWithRemap(stageId, targetStageId),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["deals-board"] });
      toast.success("Стадия удалена, сделки перенесены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => reorderStages(pipelineId!, orderedIds),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  // Sort: open stages first by order_index, then closed_won, then closed_lost
  const sortedStages = [...stages].sort((a, b) => {
    const typeOrder = { open: 0, closed_won: 1, closed_lost: 2 };
    const ta = typeOrder[a.stage_type] ?? 0;
    const tb = typeOrder[b.stage_type] ?? 0;
    if (ta !== tb) return ta - tb;
    return a.order_index - b.order_index;
  });

  return {
    stages: sortedStages,
    isLoading,
    createStage: createMut.mutateAsync,
    renameStage: renameMut.mutateAsync,
    updateStageColor: colorMut.mutateAsync,
    deleteStage: deleteMut.mutateAsync,
    reorderStages: reorderMut.mutateAsync,
  };
}
