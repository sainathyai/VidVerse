import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";
import { Logo } from "../components/Logo";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { signIn, signUp, confirmSignUp } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isSignUp) {
        await signUp(username, password, email);
      } else {
        await signIn(username, password);
        navigate("/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await confirmSignUp(username, confirmationCode);
      setIsSignUp(false);
      setError("");
      alert("Account confirmed! You can now sign in.");
    } catch (err: any) {
      setError(err.message || "Invalid confirmation code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e27] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Starry background */}
      <div className="fixed inset-0 bg-[#0a0e27]">
        {/* Animated stars - only render on client */}
        {mounted && [...Array(50)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full animate-pulse"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
              opacity: Math.random() * 0.7 + 0.3,
            }}
          />
        ))}
        
        {/* Colored sparkles - only render on client */}
        {mounted && [...Array(20)].map((_, i) => (
          <div
            key={`color-${i}`}
            className="absolute w-1 h-1 rounded-full animate-pulse"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              backgroundColor: i % 3 === 0 ? '#14b8a6' : i % 3 === 1 ? '#ec4899' : '#8b5cf6',
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${3 + Math.random() * 2}s`,
              opacity: 0.6,
            }}
          />
        ))}
      </div>

      {/* Large radial glow effect behind card */}
      <div className="fixed inset-0 flex items-center justify-center">
        <div 
          className="w-[800px] h-[800px] rounded-full opacity-40"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.4) 0%, rgba(147,51,234,0.3) 40%, rgba(236,72,153,0.2) 70%, transparent 100%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      {/* Login Card */}
      <div className="w-full max-w-lg relative z-10">
        <div className="relative rounded-3xl border border-white/20 bg-white/5 backdrop-blur-2xl p-10 shadow-2xl">
          {/* Glass reflection */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
          
          <div className="relative">
            {/* Spacer above logo */}
            <div className="h-12"></div>
            
            {/* Logo Section */}
            <div className="flex flex-col items-center mb-10">
              <div className="w-40 h-40 mb-5 relative">
                <div className="absolute inset-0 bg-gradient-to-br from-teal-500/20 to-orange-500/20 rounded-2xl blur-xl" />
                <div className="relative rounded-2xl p-2 bg-transparent">
                  <Logo width={144} height={144} />
                </div>
              </div>
              <div className="text-center">
                <h1 className="text-3xl font-bold mb-1">
                  <span className="text-white">Vid</span>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-500">Verse</span>
                </h1>
                <p className="text-white/50 text-xs tracking-wide uppercase">Intelligent Video Generation</p>
              </div>
            </div>

            {/* Spacer above welcome section */}
            <div className="h-12"></div>

            {/* Welcome Section */}
            <div className="text-center mb-6">
              <h2 className="text-4xl font-bold text-white mb-3 tracking-tight">
                {isSignUp ? "Create Account" : "Welcome back"}
              </h2>
              <p className="text-white/60 text-base">
                {isSignUp 
                  ? "Start creating amazing videos with AI" 
                  : "Sign in to continue creating amazing videos."}
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm backdrop-blur-sm">
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="w-full mb-10 mt-4">
              <div className="flex flex-col items-center gap-6">
                {isSignUp && (
                  <div className="w-full max-w-xs">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                      className="w-full rounded-xl border-2 border-white/20 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-md text-white text-base placeholder-white/40 focus:border-teal-400/50 focus:outline-none focus:ring-2 focus:ring-teal-400/30 hover:border-white/30 transition-all duration-300 shadow-lg"
                      placeholder="Email"
                    />
                  </div>
                )}

                {/* Spacer above username */}
                <div className="h-6"></div>

                <div className="w-full max-w-xs">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                    className="w-full rounded-xl border-2 border-white/20 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-md text-white text-base placeholder-white/40 focus:border-teal-400/50 focus:outline-none focus:ring-2 focus:ring-teal-400/30 hover:border-white/30 transition-all duration-300 shadow-lg"
                    placeholder="Username"
                  />
                </div>

                <div className="w-full max-w-xs space-y-3">
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', paddingLeft: '1.5rem' }}
                    className="w-full rounded-xl border-2 border-white/20 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-md pr-12 text-white text-base placeholder-white/40 focus:border-teal-400/50 focus:outline-none focus:ring-2 focus:ring-teal-400/30 hover:border-white/30 transition-all duration-300 shadow-lg"
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
                
                  {!isSignUp && (
                    <div className="text-left mt-2" style={{ paddingLeft: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => alert("Forgot password functionality coming soon!")}
                        className="text-sm text-white/60 hover:text-teal-400 transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}
                </div>

                {/* Sign In Button with glow */}
                <div className="w-full max-w-xs mt-4">
                <button
                  type="submit"
                  disabled={loading}
                  style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
                  className="group relative w-full bg-gradient-to-r from-purple-600 via-purple-500 to-teal-400 text-white rounded-full font-semibold text-lg shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-teal-400/60 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
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

            {/* Spacer */}
            <div className="h-8"></div>

            {/* Social Login */}
            <div className="w-full flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => alert("Google sign in coming soon!")}
                style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', minWidth: '180px' }}
                className="flex items-center justify-center gap-2 px-4 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-white/15 hover:border-white/30 transition-all duration-300 shadow-md"
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
                onClick={() => alert("Apple sign in coming soon!")}
                style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem', minWidth: '180px' }}
                className="flex items-center justify-center gap-2 px-4 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-white/15 hover:border-white/30 transition-all duration-300 shadow-md"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                <span className="text-sm font-medium">Apple</span>
              </button>
            </div>

            {/* Spacer below social login */}
            <div className="h-6"></div>

            {/* Create Account */}
            <div className="text-center w-full max-w-md mx-auto">
              <span className="text-white/50 text-sm">Don't have your account? </span>
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError("");
                }}
                className="text-white font-semibold hover:text-teal-400 transition-colors text-sm ml-1"
              >
                {isSignUp ? "Sign in" : "Create account"}
              </button>
            </div>

            {/* Spacer below create account */}
            <div className="h-12"></div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {isSignUp && confirmationCode !== "" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-white/5 backdrop-blur-xl rounded-2xl border border-white/20 p-8 shadow-2xl">
            <h3 className="text-2xl font-bold text-white mb-6">Verify Email</h3>
            <form onSubmit={handleConfirm} className="space-y-5">
              <input
                type="text"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm px-4 py-3 text-white placeholder-white/50 focus:border-white/30 focus:outline-none"
                placeholder="Enter 6-digit code"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-purple-600 to-teal-400 text-white py-3 rounded-full font-semibold"
              >
                {loading ? "Verifying..." : "Verify"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
