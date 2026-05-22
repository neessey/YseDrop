import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface AuthUser {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  isSupabaseConfigured: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const u = session.user;
          const mappedUser = {
            uid: u.id,
            email: u.email || '',
            displayName: u.user_metadata?.display_name || u.user_metadata?.full_name || 'Demo User',
            photoURL: u.user_metadata?.photo_url || u.user_metadata?.avatar_url || '',
          };

          setUser(mappedUser);

          // Synchronize user to Database (upsert)
          await supabase.from('users').upsert({
            id: u.id,
            email: u.email,
            display_name: mappedUser.displayName,
            photo_url: mappedUser.photoURL,
          });
        }
      } catch (err) {
        console.error('Error fetching initial session:', err);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    // 2. Listen to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, session: { user: any; }) => {
      setLoading(true);
      if (session?.user) {
        const u = session.user;
        const mappedUser = {
          uid: u.id,
          email: u.email || '',
          displayName: u.user_metadata?.display_name || u.user_metadata?.full_name || 'Demo User',
          photoURL: u.user_metadata?.photo_url || u.user_metadata?.avatar_url || '',
        };

        setUser(mappedUser);

        try {
          await supabase.from('users').upsert({
            id: u.id,
            email: u.email,
            display_name: mappedUser.displayName,
            photo_url: mappedUser.photoURL,
          });
        } catch (dbErr) {
          console.error('Error writing user session database sync:', dbErr);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async () => {
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, logout, isSupabaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within a SupabaseProvider');
  }
  return context;
}
