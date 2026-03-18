import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SitePageService } from "@/services/sitePages/SitePageService";
import { SiteFolderService } from "@/services/sitePages/SiteFolderService";
import { SitePublicationService } from "@/services/sitePages/SitePublicationService";
import type { CreateSitePageData, UpdateSitePageData, CreateSiteFolderData, UpdateSiteFolderData } from "@/services/sitePages/types";

export function useSitePages() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["site-pages"],
    queryFn: () => SitePageService.listPages(),
  });

  const getPage = (id: string) =>
    useQuery({
      queryKey: ["site-pages", id],
      queryFn: () => SitePageService.getPage(id),
      enabled: !!id,
    });

  const createMutation = useMutation({
    mutationFn: (data: CreateSitePageData) => SitePageService.createPage(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      toast.success("Страница создана");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSitePageData }) =>
      SitePageService.updatePage(id, data),
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      queryClient.invalidateQueries({ queryKey: ["site-pages", page.id] });
      toast.success("Страница сохранена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => SitePageService.deletePage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      toast.success("Страница удалена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => SitePublicationService.publish(id),
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      queryClient.invalidateQueries({ queryKey: ["site-pages", page.id] });
      toast.success("Страница опубликована");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unpublishMutation = useMutation({
    mutationFn: (id: string) => SitePublicationService.unpublish(id),
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      queryClient.invalidateQueries({ queryKey: ["site-pages", page.id] });
      toast.success("Страница снята с публикации");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    pages: listQuery.data || [],
    isLoading: listQuery.isLoading,
    getPage,
    createPage: createMutation.mutate,
    updatePage: updateMutation.mutate,
    deletePage: deleteMutation.mutate,
    publishPage: publishMutation.mutate,
    unpublishPage: unpublishMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isPublishing: publishMutation.isPending,
  };
}

export function useSitePage(id: string) {
  return useQuery({
    queryKey: ["site-pages", id],
    queryFn: () => SitePageService.getPage(id),
    enabled: !!id,
  });
}

export function useSiteFolders() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["site-folders"],
    queryFn: () => SiteFolderService.listFolders(),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateSiteFolderData) => SiteFolderService.createFolder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-folders"] });
      toast.success("Папка создана");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSiteFolderData }) =>
      SiteFolderService.updateFolder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-folders"] });
      toast.success("Папка обновлена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => SiteFolderService.deleteFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-folders"] });
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      toast.success("Папка удалена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    folders: listQuery.data || [],
    isLoading: listQuery.isLoading,
    createFolder: createMutation.mutate,
    updateFolder: updateMutation.mutate,
    deleteFolder: deleteMutation.mutate,
    isCreating: createMutation.isPending,
  };
}
