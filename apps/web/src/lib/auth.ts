/**
 * Supabase client — AUTH ONLY.
 *
 * The browser never queries Supabase for data (CLAUDE.md rule 5); all data
 * access flows through the Node API via api-client.ts. Session persistence is
 * handled entirely by the Supabase client (CLAUDE.md rule 8 — no manual
 * localStorage/sessionStorage token handling anywhere in this codebase).
 */
import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { useEffect, useState } from "react";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
    );
  }
  return client;
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<Session> {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

/**
 * Sends the Supabase reset email with a redirect back to /reset-password
 * (UX 1.6). Callers must NOT leak whether the address exists — show the
 * same neutral confirmation on success and failure.
 */
export async function resetPasswordForEmail(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

/** Sets a new password on the current (recovery) session. */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) throw error;
}

/** Current access token, or null when unauthenticated. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Event-aware variant for the reset-password page: Supabase delivers the
 * recovery session via the URL hash and announces it with a
 * PASSWORD_RECOVERY event once processed.
 */
export function onAuthEvent(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  const {
    data: { subscription },
  } = getSupabase().auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => subscription.unsubscribe();
}

export function onAuthStateChange(
  callback: (session: Session | null) => void,
): () => void {
  const {
    data: { subscription },
  } = getSupabase().auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => subscription.unsubscribe();
}

export interface SessionState {
  session: Session | null;
  isLoading: boolean;
}

/** Reactive session state for route guards and layouts. */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    session: null,
    isLoading: true,
  });

  useEffect(() => {
    let active = true;

    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (active) setState({ session: data.session, isLoading: false });
      });

    const unsubscribe = onAuthStateChange((session) => {
      if (active) setState({ session, isLoading: false });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}
