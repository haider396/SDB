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

/** Current access token, or null when unauthenticated. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
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
