import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  /** Eingeschränktes Admin-Konto: nur Aufträge + Chat. */
  isStaff: boolean;
  /** Darf den Admin-Bereich überhaupt betreten (Admin oder Admin-Mitarbeiter). */
  canAccessAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  isStaff: false,
  canAccessAdmin: false,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  // Cache: only re-check admin role when user.id actually changes
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (window.location.pathname === "/portal-designs") {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const checkRoles = async (userId: string): Promise<{ admin: boolean; staff: boolean }> => {
      try {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        const roles = (data ?? []).map((r: { role: string }) => r.role);
        return { admin: roles.includes("admin"), staff: roles.includes("admin_mitarbeiter") };
      } catch {
        return { admin: false, staff: false };
      }
    };

    const applySession = async (nextSession: Session | null) => {
      const nextUserId = nextSession?.user?.id ?? null;

      // Same user as before → just refresh the session token reference, skip role re-check.
      // This avoids tree-wide rerenders + DB roundtrips on TOKEN_REFRESHED / tab focus.
      if (nextUserId && nextUserId === lastCheckedUserIdRef.current) {
        if (cancelled) return;
        setSession(nextSession);
        if (!cancelled) setLoading(false);
        return;
      }

      if (nextSession?.user) {
        const roles = await checkRoles(nextSession.user.id);
        if (cancelled) return;
        lastCheckedUserIdRef.current = nextSession.user.id;
        setSession(nextSession);
        setIsAdmin(roles.admin);
        setIsStaff(roles.staff);
      } else {
        if (cancelled) return;
        lastCheckedUserIdRef.current = null;
        setSession(null);
        setIsAdmin(false);
        setIsStaff(false);
      }
      if (!cancelled) setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        // Filter noisy events that would otherwise rerender the whole tree
        // and resubscribe every realtime channel every few seconds:
        // - INITIAL_SESSION: handled by getSession() below
        // - TOKEN_REFRESHED: same user, no identity change
        if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
        // Fire and forget – never await inside the listener.
        void applySession(nextSession);
      }
    );

    supabase.auth.getSession()
      .then(({ data: { session: initialSession } }) => applySession(initialSession))
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        isAdmin,
        isStaff,
        canAccessAdmin: isAdmin || isStaff,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
