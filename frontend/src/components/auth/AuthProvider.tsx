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
      if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) {
        setLoading(false);
        return;
      }

      const currentUser = await getCurrentUser();
      setUser({
        userId: currentUser.userId,
        username: currentUser.username,
        email: currentUser.signInDetails?.loginId,
      });
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (username: string, password: string) => {
    if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) {
      throw new Error("Authentication is not configured. Please set up Cognito.");
    }

    await signIn({ username, password });
    await checkUser();
  };

  const handleSignOut = async () => {
    if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) {
      return;
    }

    await signOut();
    setUser(null);
  };

  const handleSignUp = async (username: string, password: string, email: string) => {
    if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) {
      throw new Error("Authentication is not configured. Please set up Cognito.");
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
    if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) {
      throw new Error("Authentication is not configured. Please set up Cognito.");
    }

    await confirmSignUp({ username, confirmationCode: code });
  };

  const handleResendSignUpCode = async (username: string) => {
    if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) {
      throw new Error("Authentication is not configured. Please set up Cognito.");
    }

    await resendSignUpCode({ username });
  };

  const getAccessToken = async (): Promise<string | null> => {
    try {
      if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) {
        return null;
      }

      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() || null;
    } catch (error) {
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

