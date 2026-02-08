import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "user" | "admin" | "superadmin";

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

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("user_roles_v2")
        .select("role_id, roles(code)")
        .eq("user_id", userId);

      if (error) {
        console.error("Error fetching role:", error);
        return "user" as AppRole;
      }

      if (data && data.length > 0) {
        // Check for super_admin first, then admin
        const roleCodes = data.map((r: any) => r.roles?.code).filter(Boolean);
        if (roleCodes.includes("super_admin")) {
          return "superadmin" as AppRole;
        }
        if (roleCodes.includes("admin")) {
          return "admin" as AppRole;
        }
      }
      return "user" as AppRole;
    } catch (err) {
      console.error("Error fetching role:", err);
      return "user" as AppRole;
    }
  };

  useEffect(() => {
    let isMounted = true;

    // 1. СНАЧАЛА подписываемся на изменения (рекомендация Supabase)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          // Use setTimeout to avoid potential race conditions with Supabase internals
          setTimeout(() => {
            if (isMounted) {
              fetchUserRole(session.user.id).then((r) => {
                if (isMounted) setRole(r);
              });
            }
          }, 0);
        } else {
          setRole("user");
        }
        setLoading(false);
      }
    );

    // 2. ПОТОМ проверяем текущую сессию
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!isMounted) return;
        
        if (session) {
          setSession(session);
          setUser(session.user);
          fetchUserRole(session.user.id).then((r) => {
            if (isMounted) setRole(r);
          });
        }
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
      console.warn("[AuthContext] Safety timeout — forcing loading=false after 5s");
      setLoading(false);
    }, 5000);

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
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
    
    // If email exists but user has no identities (invited user without password)
    if (data?.user && !data?.session && data?.user?.identities?.length === 0) {
      return { 
        error: { message: "User already registered" } as Error,
        data: null 
      };
    }
    
    return { error, data };
  };

  const signOut = async () => {
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
