import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPipelines, createPipeline, renamePipeline, deletePipeline } from "@/services/pipelineService";
import { toast } from "sonner";

const QUERY_KEY = ["crm-pipelines"];

export function usePipelines() {
  const qc = useQueryClient();

  const { data: pipelines = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPipelines,
    staleTime: 60_000,
  });

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

  return {
    pipelines,
    isLoading,
    createPipeline: createMutation.mutateAsync,
    renamePipeline: renameMutation.mutateAsync,
    deletePipeline: deleteMutation.mutateAsync,
  };
}
