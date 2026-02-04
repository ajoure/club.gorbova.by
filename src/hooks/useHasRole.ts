import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface UseHasRoleResult {
  hasRole: boolean;
  isLoading: boolean;
}

/**
 * Hook to check if the current user has a specific role
 * Uses the has_role RPC function
 */
export function useHasRole(role: AppRole): UseHasRoleResult {
  const [hasRole, setHasRole] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkRole = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (mounted) {
            setHasRole(false);
            setIsLoading(false);
          }
          return;
        }

        const { data, error } = await supabase.rpc('has_role', {
          _user_id: user.id,
          _role: role,
        });

        if (mounted) {
          if (error) {
            console.error('useHasRole error:', error);
            setHasRole(false);
          } else {
            setHasRole(!!data);
          }
          setIsLoading(false);
        }
      } catch (e) {
        console.error('useHasRole exception:', e);
        if (mounted) {
          setHasRole(false);
          setIsLoading(false);
        }
      }
    };

    checkRole();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkRole();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [role]);

  return { hasRole, isLoading };
}
