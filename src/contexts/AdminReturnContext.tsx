import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "./AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AdminReturnController, awaitApplicationRead, type ReturnView } from "@/lib/adminReturn";
import { normalizeAdminReturnUrl, RETURN_STATE_EVENT } from "@/lib/impersonationStorage";
import { permissionQueryKey } from "@/hooks/usePermissions";
import { adminAccessQueryKey, resolveAdminAccess, useAdminAccess } from "@/hooks/useAdminAccess";
import { findFirstAccessibleAdminPath } from "@/components/layout/AdminRouteGuard";

interface ReturnContext { view: ReturnView; returnToAdmin: () => Promise<void> }
const Context = createContext<ReturnContext | null>(null);
export function useAdminReturn() { return useContext(Context); }

/** Lives below AuthProvider, above Routes. No guarded shell/component owns the transaction. */
export function AdminReturnProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const currentSession = useRef(session);
  currentSession.current = session;
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;
  const actorListeners = useRef(new Set<() => void>());
  const queryClient = useQueryClient();
  // Register the SAME canonical queries for the current actor, including while Routes are fenced.
  useAdminAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const controller = useRef<AdminReturnController>();
  if (!controller.current) controller.current = new AdminReturnController({
    auth: supabase.auth,
    getSessionSnapshot: () => currentSession.current,
    navigate: url => navigate(url, { replace: true }),
    notice: kind => kind === "success" ? toast.success("Вернулись в аккаунт администратора") : toast.info("Вы вернулись в свой аккаунт. Доступ к прежнему разделу изменился."),
    waitForActor: (id, signal) => {
      const wait = new Promise<void>(resolve => {
        const check = () => { if (currentActor.current === id) { actorListeners.current.delete(check); resolve(); } };
        actorListeners.current.add(check); check();
        signal.addEventListener("abort", () => actorListeners.current.delete(check), { once: true });
      });
      return awaitApplicationRead(wait, signal);
    },
    freshAccess: async (id, returnUrl, signal) => {
      const keys = [permissionQueryKey(id), adminAccessQueryKey(id)];
      const read = async () => {
        await Promise.all(keys.map(queryKey => queryClient.cancelQueries({ queryKey, exact: true })));
        await Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" })));
        await Promise.all(keys.map(queryKey => queryClient.refetchQueries({ queryKey, exact: true, type: "all" }, { throwOnError: true })));
        const roles = queryClient.getQueryData<{ actorId?: string; complete?: boolean; userRoles: { code: string }[] }>(keys[0]);
        const access = queryClient.getQueryData<{ actorId?: string; complete?: boolean; rows: Parameters<typeof resolveAdminAccess>[0]; gatingEnabled: boolean }>(keys[1]);
        if (currentActor.current !== id || !roles?.complete || !access?.complete || roles.actorId !== id || access.actorId !== id
          || keys.some(queryKey => queryClient.getQueryState(queryKey)?.error)) throw new Error("RETURN_RIGHTS_UNVERIFIED");
        const superAdmin = roles.userRoles.some(role => role.code === "super_admin");
        const admin = superAdmin || roles.userRoles.some(role => role.code === "admin");
        const policy = resolveAdminAccess(access.rows, access.gatingEnabled, superAdmin, admin);
        const safeRoute = normalizeAdminReturnUrl(returnUrl);
        return { allowed: !safeRoute.startsWith("/admin") || policy.canAccessPath(safeRoute), fallback: findFirstAccessibleAdminPath(policy) ?? "/dashboard" };
      };
      return awaitApplicationRead(read(), signal);
    },
  });
  const instance = controller.current;
  const view = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  useEffect(() => { actorListeners.current.forEach(check => check()); }, [user?.id]);
  useEffect(() => {
    window.addEventListener("storage", instance.sync);
    window.addEventListener(RETURN_STATE_EVENT, instance.sync);
    return () => { window.removeEventListener("storage", instance.sync); window.removeEventListener(RETURN_STATE_EVENT, instance.sync); };
  }, [instance]);
  const fenced = view.phase !== "idle";
  const manualLogin = view.phase === "manual" && location.pathname === "/auth";
  return <Context.Provider value={{ view, returnToAdmin: () => instance.returnToAdmin() }}>
    {fenced && !manualLogin ? <div className="min-h-screen flex items-center justify-center p-6 bg-background" role="status">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">{view.phase === "pending" ? "Возвращаемся в ваш аккаунт…" : "Нужно подтвердить вход"}</h1>
        <p>{view.inFlight ? "Дождитесь завершения текущего действия. Эта страница обновится автоматически." : "Не удалось подтвердить безопасный возврат. Войдите в свой аккаунт заново. Если действие ещё выполняется в другой вкладке, сначала дождитесь его завершения."}</p>
        {view.phase !== "pending" && <button className="rounded-md border px-4 py-2 disabled:opacity-50" disabled={view.inFlight} onClick={() => void instance.prepareManualLogin()}>Войти заново</button>}
      </div>
    </div> : children}
  </Context.Provider>;
}
