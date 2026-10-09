import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Read a direct CRM identity independently of contact-list filters/pagination. */
export function useLinkedAdminContact(contactFromUrl: string | null) {
  return useQuery({
    queryKey: ["admin-contact-deep-link", contactFromUrl],
    enabled: !!contactFromUrl,
    queryFn: async () => {
      if (!contactFromUrl || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactFromUrl)) return null;
      const { data: byProfile, error: profileError } = await supabase
        .from("profiles").select("*").eq("id", contactFromUrl).maybeSingle();
      if (profileError) throw profileError;
      if (byProfile) return byProfile;
      const { data: byUser, error: userError } = await supabase
        .from("profiles").select("*").eq("user_id", contactFromUrl)
        .is("merged_to_profile_id", null).eq("is_archived", false).maybeSingle();
      if (userError) throw userError;
      return byUser;
    },
  });

}
