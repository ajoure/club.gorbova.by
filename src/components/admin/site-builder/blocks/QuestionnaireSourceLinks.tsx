import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { questionnaireSourceLinks } from "../../../../../supabase/functions/site-form-submit/questionnaire-source";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function QuestionnaireSourceLinks({ pageId }: { pageId?: string }) {
  const page = useQuery({
    queryKey: ["questionnaire-source-links",pageId], enabled: !!pageId,
    queryFn: async () => {
      const { data,error } = await supabase.from("site_pages").select("slug").eq("id",pageId!).single();
      if(error) throw error;
      return data;
    },
  });
  const slug=page.data?.slug?.replace(/^\/+/,"");
  const links = slug && /^[a-z0-9_/-]+$/i.test(slug) ? questionnaireSourceLinks(`https://gorbova.by/${slug}`) : [];
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success("Ссылка скопирована"); }
    catch { toast.error("Не удалось скопировать. Выделите ссылку вручную."); }
  }
  return <div className="space-y-2 border rounded p-3">
    <p className="text-xs font-medium">10 ссылок для источников предзаписи</p>
    <p className="text-xs text-muted-foreground">Все ведут на эту анкету. Метка показывает в карточке контакта, откуда пришёл человек.</p>
    {links.map(link => <div key={link.label} className="space-y-1">
      <div className="flex items-center justify-between gap-2"><span className="text-xs">{link.label}</span><Button type="button" size="sm" variant="outline" onClick={() => { void copy(link.url); }}>Копировать</Button></div>
      <p className="text-[10px] break-all select-all text-muted-foreground">{link.url}</p>
    </div>)}
    {!links.length && <p className="text-xs text-muted-foreground">{page.isError ? "Не удалось загрузить адрес страницы." : "Ссылки появятся после сохранения адреса страницы."}</p>}
  </div>;
}
