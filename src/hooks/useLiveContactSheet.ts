/**
 * Hook to open ContactDetailSheet from webinar room.
 * Reuses existing ContactDetailSheet pattern — lookup by profiles.user_id.
 */
import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useLiveContactSheet() {
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);

  const openContactSheet = useCallback(async (userId: string) => {
    try {
      // Lookup by user_id (correct field per platform rules)
      const { data: contact, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;

      if (!contact) {
        // Fallback: try by profile.id
        const { data: byId } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        if (byId) {
          setSelectedContact(byId);
          setContactSheetOpen(true);
          return;
        }
        throw new Error("Контакт не найден");
      }

      setSelectedContact(contact);
      setContactSheetOpen(true);
    } catch (e) {
      console.error("Failed to load contact:", e);
      toast.error("Не удалось загрузить контакт");
    }
  }, []);

  return {
    selectedContact,
    contactSheetOpen,
    setContactSheetOpen,
    openContactSheet,
  };
}
