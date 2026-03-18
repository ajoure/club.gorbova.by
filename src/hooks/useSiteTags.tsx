import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SiteTagService } from "@/services/sitePages/SiteTagService";
import type { SitePageTag } from "@/services/sitePages/types";

export function useSiteTags() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["site-tags"],
    queryFn: () => SiteTagService.listTags(),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => SiteTagService.createTag(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-tags"] });
      toast.success("Тег создан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => SiteTagService.deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-tags"] });
      queryClient.invalidateQueries({ queryKey: ["site-page-tags"] });
      toast.success("Тег удалён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTagMutation = useMutation({
    mutationFn: ({ pageId, tagId }: { pageId: string; tagId: string }) =>
      SiteTagService.addTagToPage(pageId, tagId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["site-page-tags", variables.pageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeTagMutation = useMutation({
    mutationFn: ({ pageId, tagId }: { pageId: string; tagId: string }) =>
      SiteTagService.removeTagFromPage(pageId, tagId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["site-page-tags", variables.pageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    tags: listQuery.data || [],
    isLoading: listQuery.isLoading,
    createTag: createMutation.mutate,
    deleteTag: deleteMutation.mutate,
    addTagToPage: addTagMutation.mutate,
    removeTagFromPage: removeTagMutation.mutate,
    isCreating: createMutation.isPending,
  };
}

export function usePageTags(pageId: string) {
  return useQuery({
    queryKey: ["site-page-tags", pageId],
    queryFn: () => SiteTagService.getPageTags(pageId),
    enabled: !!pageId,
  });
}
