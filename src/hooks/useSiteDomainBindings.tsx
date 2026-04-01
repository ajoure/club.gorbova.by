import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SitePublicationService } from "@/services/sitePages/SitePublicationService";

export function useSiteDomainBindings(pageId: string) {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["site-domain-bindings", pageId],
    queryFn: () => SitePublicationService.listBindings(pageId),
    enabled: !!pageId,
  });

  const bindMutation = useMutation({
    mutationFn: (domain: string) => SitePublicationService.bindDomain(pageId, domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-domain-bindings", pageId] });
      toast.success("Домен привязан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unbindMutation = useMutation({
    mutationFn: (bindingId: string) => SitePublicationService.unbindDomain(bindingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-domain-bindings", pageId] });
      toast.success("Домен отвязан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setHomeMutation = useMutation({
    mutationFn: ({ domain, targetPageId }: { domain: string; targetPageId: string }) =>
      SitePublicationService.setHomePage(domain, targetPageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-domain-bindings", pageId] });
      toast.success("Главная страница назначена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    bindings: listQuery.data || [],
    isLoading: listQuery.isLoading,
    bindDomain: bindMutation.mutate,
    unbindDomain: unbindMutation.mutate,
    setHome: setHomeMutation.mutate,
    isBinding: bindMutation.isPending,
    isUnbinding: unbindMutation.isPending,
    isSettingHome: setHomeMutation.isPending,
  };
}
