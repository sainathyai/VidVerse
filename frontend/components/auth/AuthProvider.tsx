"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getCurrentUser, signIn, signOut, signUp, confirmSignUp, resendSignUpCode, fetchAuthSession } from "aws-amplify/auth";
import "@/lib/amplify";

interface User {
  userId: string;
  username: string;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (username: string, password: string, email: string) => Promise<void>;
  confirmSignUp: (username: string, code: string) => Promise<void>;
  resendSignUpCode: (username: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      // Check if Amplify is configured before trying to get current user
      const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
      if (!userPoolId) {
        // Amplify not configured, skip auth check
        setUser(null);
        setLoading(false);
        return;
      }
      
      const currentUser = await getCurrentUser();
      setUser({
        userId: currentUser.userId,
        username: currentUser.username,
      });
    } catch (error) {
      // User not authenticated or Amplify not configured
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (username: string, password: string) => {
    const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      throw new Error('Authentication is not configured. Please set up Cognito credentials.');
    }
    await signIn({ username, password });
    await checkUser();
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
  };

  const handleSignUp = async (username: string, password: string, email: string) => {
    const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      throw new Error('Authentication is not configured. Please set up Cognito credentials.');
    }
    await signUp({
      username,
      password,
      options: {
        userAttributes: {
          email,
        },
      },
    });
  };

  const handleConfirmSignUp = async (username: string, code: string) => {
    const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      throw new Error('Authentication is not configured. Please set up Cognito credentials.');
    }
    await confirmSignUp({ username, confirmationCode: code });
  };

  const handleResendSignUpCode = async (username: string) => {
    const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      throw new Error('Authentication is not configured. Please set up Cognito credentials.');
    }
    await resendSignUpCode({ username });
  };

  const getAccessToken = async (): Promise<string | null> => {
    try {
      const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
      if (!userPoolId) {
        return null;
      }
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() || null;
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn: handleSignIn,
        signOut: handleSignOut,
        signUp: handleSignUp,
        confirmSignUp: handleConfirmSignUp,
        resendSignUpCode: handleResendSignUpCode,
        getAccessToken,
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

