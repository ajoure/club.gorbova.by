import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPipelines, createPipeline, renamePipeline, deletePipeline, reorderPipelines } from "@/services/pipelineService";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const QUERY_KEY = ["crm-pipelines"];

export function usePipelines() {
  const qc = useQueryClient();

  const { data: pipelines = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPipelines,
    staleTime: 60_000,
  });

  // Realtime: любое изменение в crm_pipelines → инвалидация
  useEffect(() => {
    const channel = supabase
      .channel("crm-pipelines-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_pipelines" },
        () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const createMutation = useMutation({
    mutationFn: (name: string) => createPipeline(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["crm-pipeline-stages"] });
      toast.success("Воронка создана");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renamePipeline(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Воронка переименована");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePipeline(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Воронка удалена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => reorderPipelines(orderedIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Порядок воронок сохранён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    pipelines,
    isLoading,
    createPipeline: createMutation.mutateAsync,
    renamePipeline: renameMutation.mutateAsync,
    deletePipeline: deleteMutation.mutateAsync,
    reorderPipelines: reorderMutation.mutateAsync,
  };
}
