import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearImpersonationStorage, hasStaleImpersonationState } from "@/lib/impersonationStorage";

type AppRole = "user" | "admin" | "superadmin" | "employee";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, firstName: string, lastName: string, phone: string) => Promise<{ error: Error | null; data?: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>("user");
  const [loading, setLoading] = useState(true);

  // Controlled effect: fetch role when user.id changes
  useEffect(() => {
    if (!user?.id) {
      setRole("user");
      return;
    }

    let cancelled = false;

    const fetchRole = async () => {
      try {
        const { data, error } = await supabase
          .from("user_roles_v2")
          .select("role_id, roles(code)")
          .eq("user_id", user.id);

        if (cancelled || error) return;

        if (data && data.length > 0) {
          const roleCodes = data.map((r: any) => r.roles?.code).filter(Boolean);
          if (roleCodes.includes("super_admin")) {
            setRole("superadmin");
            return;
          }
          if (roleCodes.includes("admin")) {
            setRole("admin");
            return;
          }
          if (roleCodes.includes("employee") || roleCodes.includes("admin_gost")) {
            setRole("employee");
            return;
          }
        }
        setRole("user");
      } catch {
        if (!cancelled) setRole("user");
      }
    };

    fetchRole();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let isMounted = true;

    // 1. Subscribe to auth state changes
    // RULE: No await, no DB calls, no RPC, no heavy side-effects inside listener.
    // Listener does ONLY synchronous state updates.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        if (!isMounted) return;

        if (import.meta.env.DEV) {
          console.info(`[AuthContext] onAuthStateChange: event=${_event}, hasSession=${!!currentSession}`);
        }

        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setLoading(false);
      }
    );

    // 2. Check current session (one-time on mount)
    supabase.auth.getSession()
      .then(({ data: { session: existingSession } }) => {
        if (!isMounted) return;
        setSession(existingSession);
        setUser(existingSession?.user ?? null);
      })
      .catch((error) => {
        console.error("[AuthContext] getSession error:", error);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    // Safety timeout — prevent infinite loading if auth init hangs
    const safetyTimeout = setTimeout(() => {
      if (!isMounted) return;
      if (import.meta.env.DEV) {
        console.warn("[AuthContext] Safety timeout — forcing loading=false after 5s");
      }
      setLoading(false);
    }, 5000);

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    // Clean stale impersonation state on normal login
    if (hasStaleImpersonationState()) {
      clearImpersonationStorage();
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string, phone: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`.trim(),
          phone: phone,
        },
      },
    });
    
    if (data?.user && !data?.session && data?.user?.identities?.length === 0) {
      return { 
        error: { message: "User already registered" } as Error,
        data: null 
      };
    }
    
    return { error, data };
  };

  const signOut = async () => {
    // Always clear impersonation state on signOut
    clearImpersonationStorage();
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole("user");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        loading,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
