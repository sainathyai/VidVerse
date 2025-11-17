import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";
import { Logo } from "../components/Logo";

/**
 * Converts Cognito password policy errors to user-friendly messages
 */
const formatPasswordError = (errorMessage: string): string => {
  if (!errorMessage) return "An error occurred";
  
  const message = errorMessage.toLowerCase();
  
  // Handle "Password did not conform with policy: Password must have symbol characters"
  // Extract the part after the colon if present
  const colonIndex = errorMessage.indexOf(":");
  const actualRequirement = colonIndex > -1 
    ? errorMessage.substring(colonIndex + 1).trim()
    : errorMessage;
  
  const requirementLower = actualRequirement.toLowerCase();
  
  // Check for specific requirements in the actual requirement text
  if (requirementLower.includes("symbol") || message.includes("symbol")) {
    return "Password must include at least one symbol (!@#$%^&*)";
  }
  if (requirementLower.includes("uppercase") || message.includes("uppercase") || message.includes("upper case")) {
    return "Password must include at least one uppercase letter";
  }
  if (requirementLower.includes("lowercase") || message.includes("lowercase") || message.includes("lower case")) {
    return "Password must include at least one lowercase letter";
  }
  if (requirementLower.includes("number") || requirementLower.includes("numeric") || message.includes("number") || message.includes("numeric")) {
    return "Password must include at least one number";
  }
  if (requirementLower.includes("length") || requirementLower.includes("minimum") || message.includes("length") || message.includes("minimum")) {
    const lengthMatch = errorMessage.match(/\d+/);
    if (lengthMatch) {
      return `Password must be at least ${lengthMatch[0]} characters long`;
    }
    return "Password is too short";
  }
  
  // If it's a policy error but we couldn't parse the specific requirement
  if (message.includes("conform") || message.includes("policy")) {
    // Try to extract from the full message
    if (message.includes("symbol")) {
      return "Password must include at least one symbol (!@#$%^&*)";
    }
    if (message.includes("uppercase")) {
      return "Password must include at least one uppercase letter";
    }
    if (message.includes("lowercase")) {
      return "Password must include at least one lowercase letter";
    }
    if (message.includes("number")) {
      return "Password must include at least one number";
    }
    return "Password doesn't meet requirements";
  }
  
  // Return a cleaned version of the original message if we can't parse it
  // Remove "Password did not conform with policy:" prefix if present
  if (colonIndex > -1) {
    return actualRequirement.charAt(0).toUpperCase() + actualRequirement.slice(1);
  }
  
  return errorMessage;
};

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [retypePassword, setRetypePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRetypePassword, setShowRetypePassword] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [forgotPasswordUsername, setForgotPasswordUsername] = useState("");
  const [forgotPasswordCode, setForgotPasswordCode] = useState("");
  const [forgotPasswordNewPassword, setForgotPasswordNewPassword] = useState("");
  const [forgotPasswordStep, setForgotPasswordStep] = useState<"email" | "code">("email");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const { signIn, signUp, confirmSignUp, resendSignUpCode, forgotPassword, confirmForgotPassword } = useAuth();
  const navigate = useNavigate();

  // Load remembered username on mount
  useEffect(() => {
    const rememberedUsername = localStorage.getItem("remembered_username");
    if (rememberedUsername) {
      setUsername(rememberedUsername);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isSignUp) {
        // Validate password match
        if (password !== retypePassword) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }
        // Use email as username for Cognito
        await signUp(email, password, email);
        // Show confirmation modal after successful signup
        setShowConfirmationModal(true);
        setConfirmationCode("");
      } else {
        // Handle remember me
        if (rememberMe) {
          localStorage.setItem("remembered_username", username);
        } else {
          localStorage.removeItem("remembered_username");
        }
        
        await signIn(username, password);
        navigate("/dashboard");
      }
    } catch (err: any) {
      const errorMsg = err.message || "An error occurred";
      setError(formatPasswordError(errorMsg));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Use email as username for confirmation
      await confirmSignUp(email, confirmationCode);
      setIsSignUp(false);
      setShowConfirmationModal(false);
      setError("");
      setEmail("");
      setPassword("");
      setRetypePassword("");
      setConfirmationCode("");
      alert("Account confirmed! You can now sign in.");
    } catch (err: any) {
      const errorMsg = err.message || "Invalid confirmation code";
      setError(formatPasswordError(errorMsg));
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError("");
    setResendLoading(true);
    setResendSuccess(false);

    try {
      await resendSignUpCode(email);
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 3000);
    } catch (err: any) {
      const errorMsg = err.message || "Failed to resend code";
      setError(formatPasswordError(errorMsg));
    } finally {
      setResendLoading(false);
    }
  };

  const handleCloseConfirmationModal = () => {
    setShowConfirmationModal(false);
    setError("");
    setConfirmationCode("");
    setResendSuccess(false);
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await forgotPassword(forgotPasswordUsername);
      setForgotPasswordStep("code");
      setError("");
    } catch (err: any) {
      const errorMsg = err.message || "Failed to send password reset code";
      setError(formatPasswordError(errorMsg));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await confirmForgotPassword(forgotPasswordUsername, forgotPasswordCode, forgotPasswordNewPassword);
      setShowForgotPasswordModal(false);
      setForgotPasswordUsername("");
      setForgotPasswordCode("");
      setForgotPasswordNewPassword("");
      setForgotPasswordStep("email");
      setError("");
      alert("Password reset successfully! You can now sign in.");
    } catch (err: any) {
      const errorMsg = err.message || "Failed to reset password";
      setError(formatPasswordError(errorMsg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">
      {/* Animated Textured Background */}
      <div className="fixed inset-0 z-0">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950" />
        
        {/* Animated gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/20 via-purple-950/20 to-pink-950/20 animate-gradient-shift" />
        
        {/* Texture pattern */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
        
        {/* Animated orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float-delayed" />
        <div className="absolute top-1/2 right-1/3 w-72 h-72 bg-pink-500/10 rounded-full blur-3xl animate-float-slow" />
      </div>

      {/* Large central circular radial glow effect behind card */}
      <div className="fixed inset-0 flex items-center justify-center z-0 pointer-events-none">
        <div 
          className="w-[900px] h-[900px] rounded-full opacity-55"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.5) 0%, rgba(147,51,234,0.4) 30%, rgba(236,72,153,0.3) 60%, rgba(236,72,153,0.15) 80%, transparent 100%)',
            filter: 'blur(80px)',
          }}
        />
      </div>

      {/* Login Card */}
      <div className="w-full max-w-lg relative z-10 animate-fade-in">
        <div className="relative rounded-3xl border border-white/20 bg-white/5 backdrop-blur-2xl p-8 shadow-2xl hover:border-white/30 transition-all">
          {/* Enhanced glass reflection */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/10 via-white/5 to-transparent pointer-events-none" />
          {/* Additional glow effect */}
          <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 blur-xl opacity-50 pointer-events-none" />
          
          <div className="relative">
            {/* Logo Section */}
            <div className="flex flex-col items-center mb-8 animate-fade-in">
              <div className="w-36 h-36 mb-1 relative flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500/30 via-yellow-500/30 to-teal-500/30 rounded-full blur-2xl animate-pulse-slow" />
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full blur-xl animate-pulse-slow" />
                <div className="relative">
                  <Logo width={120} height={120} />
                </div>
              </div>
              <div className="text-center">
                <h1 className="text-3xl font-bold mb-2">
                  <span className="text-white">Vid</span>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-yellow-400 to-teal-400">Verse</span>
                </h1>
                <p className="text-white/70 text-xs tracking-wider uppercase font-medium">Intelligent Video Generation</p>
              </div>
            </div>

            {/* Welcome text centered between logo and form */}
            <div className="text-center mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <h2 className="text-4xl font-bold mb-3 text-white">
                {isSignUp ? "Create Account" : "Welcome back"}
              </h2>
              <p className="text-white/70 text-sm">
                {isSignUp 
                  ? "Start creating amazing videos with AI" 
                  : "Sign in to continue creating amazing videos."}
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm backdrop-blur-sm animate-fade-in flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="flex-1">{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="w-full mb-4">
              <div className="flex flex-col items-center gap-4">
                {isSignUp ? (
                  <>
                    {/* Email field for signup */}
                    <div className="w-full max-w-xs animate-fade-in" style={{ animationDelay: '0.2s' }}>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                        className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-md text-white text-base placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 hover:border-white/30 hover:bg-white/15 transition-all duration-300 shadow-lg shadow-black/20"
                        placeholder="Email"
                      />
                    </div>

                    {/* Password field for signup */}
                    <div className="w-full max-w-xs animate-fade-in" style={{ animationDelay: '0.25s' }}>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                          className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-md pr-12 text-white text-base placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 hover:border-white/30 hover:bg-white/15 transition-all duration-300 shadow-lg shadow-black/20"
                          placeholder="Password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                        >
                          {showPassword ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Retype Password field for signup */}
                    <div className="w-full max-w-xs animate-fade-in" style={{ animationDelay: '0.3s' }}>
                      <div className="relative">
                        <input
                          type={showRetypePassword ? "text" : "password"}
                          value={retypePassword}
                          onChange={(e) => setRetypePassword(e.target.value)}
                          required
                          style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                          className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-md pr-12 text-white text-base placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 hover:border-white/30 hover:bg-white/15 transition-all duration-300 shadow-lg shadow-black/20"
                          placeholder="Retype Password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRetypePassword(!showRetypePassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                        >
                          {showRetypePassword ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Username field for signin */}
                    <div className="w-full max-w-xs animate-fade-in" style={{ animationDelay: '0.2s' }}>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                        className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-md text-white text-base placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 hover:border-white/30 hover:bg-white/15 transition-all duration-300 shadow-lg shadow-black/20"
                        placeholder="Username"
                      />
                    </div>

                    {/* Password field for signin */}
                    <div className="w-full max-w-xs animate-fade-in" style={{ animationDelay: '0.25s' }}>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                          className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-md pr-12 text-white text-base placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 hover:border-white/30 hover:bg-white/15 transition-all duration-300 shadow-lg shadow-black/20"
                          placeholder="Password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                        >
                          {showPassword ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                      {/* Remember me and Forgot password row */}
                      <div className="flex items-center justify-between mt-2 px-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="w-4 h-4 rounded border-white/20 bg-white/10 text-purple-500 focus:ring-2 focus:ring-purple-400/30 focus:ring-offset-0 cursor-pointer"
                          />
                          <span className="text-xs text-white/70 hover:text-white transition-colors">Remember me</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setForgotPasswordUsername(username);
                            setShowForgotPasswordModal(true);
                            setForgotPasswordStep("email");
                            setError("");
                          }}
                          className="text-xs text-white/60 hover:text-teal-400 transition-colors"
                        >
                          Forgot password?
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Sign In Button with glow */}
                <div className="w-full max-w-xs mt-4 animate-fade-in" style={{ animationDelay: '0.35s' }}>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ paddingTop: '0.875rem', paddingBottom: '0.875rem' }}
                  className="group relative w-full bg-gradient-to-r from-purple-600 via-purple-500 to-teal-400 text-white rounded-full font-semibold text-lg shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-teal-400/60 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 overflow-hidden"
                >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <span>{isSignUp ? "Create Account" : "Sign In"}</span>
                      <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </span>
                  {/* Animated glow effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-teal-300 opacity-0 group-hover:opacity-100 blur-md transition-opacity duration-300" />
                </button>
                </div>
              </div>
            </form>

            {/* Social Login */}
            <div className="w-full flex items-center justify-center gap-3 mt-6 animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <button
                type="button"
                onClick={() => {
                  // Redirect to backend OAuth route with Google provider to bypass Cognito hosted UI
                  const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
                  const backendUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com');
                  window.location.href = `${backendUrl}/api/auth/login?provider=Google`;
                }}
                style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', minWidth: '180px' }}
                className="flex items-center justify-center gap-2 px-4 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-white/15 hover:border-white/30 transition-all duration-300 shadow-md hover:scale-[1.02]"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span className="text-sm font-medium">Google</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  // Redirect to backend OAuth route with Apple provider
                  const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
                  const backendUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com');
                  window.location.href = `${backendUrl}/api/auth/login?provider=Apple`;
                }}
                style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', minWidth: '180px' }}
                className="flex items-center justify-center gap-2 px-4 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-white/15 hover:border-white/30 transition-all duration-300 shadow-md hover:scale-[1.02]"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                <span className="text-sm font-medium">Apple</span>
              </button>
            </div>

            {/* Create Account */}
            <div className="text-center w-full max-w-md mx-auto mt-6 animate-fade-in" style={{ animationDelay: '0.45s' }}>
              <span className="text-white/60 text-sm">Don't have your account? </span>
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setShowConfirmationModal(false);
                  setError("");
                  // Clear form fields when switching
                  if (isSignUp) {
                    setEmail("");
                    setPassword("");
                    setRetypePassword("");
                    setConfirmationCode("");
                  } else {
                    setUsername("");
                    setPassword("");
                  }
                }}
                className="text-white font-semibold hover:text-teal-400 transition-colors text-sm ml-1"
              >
                {isSignUp ? "Sign in" : "Create account"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {isSignUp && showConfirmationModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-md relative rounded-3xl border border-white/20 bg-white/5 backdrop-blur-2xl p-8 shadow-2xl animate-scale-in hover:border-white/30 transition-all">
            {/* Enhanced glass reflection */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/10 via-white/5 to-transparent pointer-events-none" />
            {/* Additional glow effect */}
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 blur-xl opacity-50 pointer-events-none" />
            
            <div className="relative">
              {/* Header with close button */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-white">Verify Email</h3>
                <button
                  onClick={handleCloseConfirmationModal}
                  className="text-white/60 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Description */}
              <p className="text-white/70 text-sm mb-6">
                We've sent a verification code to <span className="text-white font-medium">{email}</span>
              </p>

              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm backdrop-blur-sm flex items-start gap-2">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1">{error}</span>
                </div>
              )}

              {/* Success Message */}
              {resendSuccess && (
                <div className="mb-4 p-3.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-300 text-sm backdrop-blur-sm flex items-start gap-2">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1">Verification code sent successfully!</span>
                </div>
              )}

              <form onSubmit={handleConfirm} className="space-y-5">
                <div>
                  <input
                    type="text"
                    value={confirmationCode}
                    onChange={(e) => setConfirmationCode(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-md px-4 py-3 text-white text-base placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 hover:border-white/30 hover:bg-white/15 transition-all duration-300 shadow-lg shadow-black/20"
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                  />
                </div>
                
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full bg-gradient-to-r from-purple-600 via-purple-500 to-teal-400 text-white rounded-full font-semibold text-lg shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-teal-400/60 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 overflow-hidden"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <span>Verify</span>
                        <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </>
                    )}
                  </span>
                  {/* Animated glow effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-teal-300 opacity-0 group-hover:opacity-100 blur-md transition-opacity duration-300" />
                </button>

                {/* Resend Code Button */}
                <div className="flex items-center justify-center gap-2 pt-2">
                  <span className="text-white/60 text-sm">Didn't receive the code?</span>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={resendLoading || resendSuccess}
                    className="text-sm font-semibold text-teal-400 hover:text-teal-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {resendLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Sending...</span>
                      </>
                    ) : resendSuccess ? (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Sent!</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Resend Code</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Forgot Password Modal */}
      {showForgotPasswordModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-md bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-8 shadow-2xl animate-scale-in hover:border-white/20 transition-all">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-white">
                {forgotPasswordStep === "email" ? "Reset Password" : "Enter Reset Code"}
              </h3>
              <button
                onClick={() => {
                  setShowForgotPasswordModal(false);
                  setForgotPasswordUsername("");
                  setForgotPasswordCode("");
                  setForgotPasswordNewPassword("");
                  setForgotPasswordStep("email");
                  setError("");
                }}
                className="text-white/60 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {error && (
              <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm backdrop-blur-sm flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="flex-1">{error}</span>
              </div>
            )}

            {forgotPasswordStep === "email" ? (
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-5">
                <input
                  type="text"
                  value={forgotPasswordUsername}
                  onChange={(e) => setForgotPasswordUsername(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm px-4 py-3 text-white placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 transition-all"
                  placeholder="Enter your username or email"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-purple-600 via-purple-500 to-teal-400 text-white py-3 rounded-full font-semibold hover:shadow-lg hover:shadow-purple-500/30 hover:scale-[1.02] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {loading ? "Sending..." : "Send Reset Code"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleConfirmForgotPassword} className="space-y-5">
                <input
                  type="text"
                  value={forgotPasswordCode}
                  onChange={(e) => setForgotPasswordCode(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm px-4 py-3 text-white placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 transition-all"
                  placeholder="Enter reset code"
                />
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={forgotPasswordNewPassword}
                    onChange={(e) => setForgotPasswordNewPassword(e.target.value)}
                    required
                    className="w-full rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm px-4 py-3 pr-12 text-white placeholder-white/50 focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-400/30 transition-all"
                    placeholder="Enter new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-purple-600 via-purple-500 to-teal-400 text-white py-3 rounded-full font-semibold hover:shadow-lg hover:shadow-purple-500/30 hover:scale-[1.02] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {loading ? "Resetting..." : "Reset Password"}
                </button>
                <button
                  type="button"
                  onClick={() => setForgotPasswordStep("email")}
                  className="w-full text-white/60 hover:text-white text-sm transition-colors"
                >
                  Back to email
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
