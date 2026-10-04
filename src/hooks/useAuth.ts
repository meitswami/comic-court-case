import { useState, useEffect } from 'react';
import { getApiUrl } from '@/utils/apiUrl';

interface User {
  id: string;
  email: string;
  email_verified: boolean;
  raw_user_meta_data?: any;
  created_at: string;
  updated_at: string;
}

export interface Session {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

// Returned by signIn for an ADMIN account: the password was correct, but no
// session exists until an authenticator code is verified (AuthenticatorModal).
export interface TwoFactorChallenge {
  challengeToken: string;
  setupRequired: boolean;
}

interface SignInResult {
  data: any;
  error: Error | null;
  twoFactor?: TwoFactorChallenge;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session in localStorage
    const checkSession = () => {
      try {
        const stored = localStorage.getItem('auth_session');
        if (stored) {
          const parsedSession = JSON.parse(stored);
          setSession(parsedSession);
          setUser(parsedSession.user);
        }
      } catch (error) {
        console.error('Error checking session:', error);
        localStorage.removeItem('auth_session');
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  const signUp = async (email: string, password: string, displayName?: string) => {
    try {
      const API_URL = getApiUrl(true); // Get API base URL with /api path at runtime
      const response = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, metadata: { display_name: displayName } }),
      });

      // Check content type before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        
        if (response.status === 404) {
          return { 
            data: null, 
            error: new Error('Backend API not found. Please configure VITE_API_URL to point to your backend server.') 
          };
        }
        
        return { 
          data: null, 
          error: new Error(`Backend returned ${response.status}. Please ensure the API server is running and VITE_API_URL is configured correctly.`) 
        };
      }

      const data = await response.json();
      
      if (response.ok && data.session) {
        setSession(data.session);
        setUser(data.session.user);
        localStorage.setItem('auth_session', JSON.stringify(data.session));
        return { data, error: null };
      } else {
        const errorMessage = data?.error || 'Sign up failed';
        return { data: null, error: new Error(errorMessage) };
      }
    } catch (error: any) {
      console.error('Sign up error:', error);
      
      // Handle JSON parse errors specifically
      if (error instanceof SyntaxError && error.message.includes('JSON')) {
        return { 
          data: null, 
          error: new Error('Backend API not configured. Please set VITE_API_URL environment variable to your backend server URL.') 
        };
      }
      
      return { 
        data: null, 
        error: error instanceof Error ? error : new Error('Network error. Please check if the server is running.') 
      };
    }
  };

  const signIn = async (email: string, password: string): Promise<SignInResult> => {
    try {
      const API_URL = getApiUrl(true); // Get API base URL with /api path at runtime
      const response = await fetch(`${API_URL}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      // Check content type before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        
        if (response.status === 404) {
          return { 
            data: null, 
            error: new Error('Backend API not found. Please configure VITE_API_URL to point to your backend server.') 
          };
        }
        
        return { 
          data: null, 
          error: new Error(`Backend returned ${response.status}. Please ensure the API server is running and VITE_API_URL is configured correctly.`) 
        };
      }

      const data = await response.json();
      
      if (response.ok && data.session) {
        setSession(data.session);
        setUser(data.session.user);
        localStorage.setItem('auth_session', JSON.stringify(data.session));
        return { data, error: null };
      } else if (response.ok && data.requires2FA) {
        // Admin account: authenticator code still needed. No session yet -
        // the caller shows the authenticator dialog.
        return {
          data: null,
          error: null,
          twoFactor: {
            challengeToken: data.challengeToken,
            setupRequired: data.setupRequired === true,
          },
        };
      } else {
        const errorMessage = data?.error || 'Sign in failed';
        return { data: null, error: new Error(errorMessage) };
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      
      // Handle JSON parse errors specifically
      if (error instanceof SyntaxError && error.message.includes('JSON')) {
        return { 
          data: null, 
          error: new Error('Backend API not configured. Please set VITE_API_URL environment variable to your backend server URL.') 
        };
      }
      
      return { 
        data: null, 
        error: error instanceof Error ? error : new Error('Network error. Please check if the server is running.') 
      };
    }
  };

  const signOut = async () => {
    try {
      setSession(null);
      setUser(null);
      localStorage.removeItem('auth_session');
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  // Stores the session an admin receives after passing the authenticator check.
  const completeTwoFactor = (newSession: Session) => {
    setSession(newSession);
    setUser(newSession.user);
    localStorage.setItem('auth_session', JSON.stringify(newSession));
  };

  return {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    completeTwoFactor,
    isAuthenticated: !!user,
  };
};
