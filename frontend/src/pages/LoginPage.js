import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "@/Quantum.css";
import { useAuth } from "@/contexts/AuthContext";
import api, { handleApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, Lock, Mail, Loader2, Zap, Eye, Fingerprint } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (user) {
    navigate("/chat", { replace: true });
    return null;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/api/auth/login", { email, password });
      setUserId(data.user_id);
      setStep(2);
      if (data.demo_otp) {
        toast.info(`Demo OTP: ${data.demo_otp}`, { duration: 30000, description: "OTP delivery failed, using demo mode" });
        // Fallback for mobile where toast might be hidden behind notches/safe-areas
        if (typeof window !== "undefined" && window.Capacitor) {
          alert(`Your Demo OTP is: ${data.demo_otp}`);
        }
      } else {
        toast.success(`OTP sent via ${data.otp_method === "sms" ? "SMS" : "email"}`, { duration: 10000 });
      }
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/api/auth/verify-login-otp", { user_id: userId, otp_code: otp });
      login(data.user, data.access_token);
      toast.success("Login successful");
      navigate("/chat");
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-fullscreen">
      {/* ── LEFT HERO PANEL (Desktop Only) ── */}
      <div className="auth-hero">
        <div className="auth-hero-bg">
          <div className="quantum-orb orb-1" />
          <div className="quantum-orb orb-2" />
          <div className="quantum-orb orb-3" />
        </div>
        <div className="auth-hero-content">
          <div className="auth-hero-shield">
            <Shield className="w-16 h-16 text-[#D2B48C]" />
          </div>
          <h1 className="auth-hero-title">TRUNEX</h1>
          <p className="auth-hero-subtitle">Quantum-Safe Communication</p>
          <div className="auth-hero-features">
            <div className="auth-hero-feature">
              <Zap className="w-5 h-5 text-[#D2B48C]" />
              <span>Post-Quantum Encryption</span>
            </div>
            <div className="auth-hero-feature">
              <Eye className="w-5 h-5 text-[#D2B48C]" />
              <span>Zero-Knowledge Architecture</span>
            </div>
            <div className="auth-hero-feature">
              <Fingerprint className="w-5 h-5 text-[#D2B48C]" />
              <span>Biometric-Ready Security</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT FORM PANEL ── */}
      <div className="auth-form-panel">
        <div className="auth-form-container">
          {/* Mobile-only branding */}
          <div className="auth-mobile-brand">
            <Shield className="w-8 h-8 text-[#1A365D]" />
            <span className="auth-mobile-brand-text">TRUNEX</span>
          </div>

          <div className="auth-form-header">
            <h2 className="auth-form-title">Welcome Back</h2>
            <p className="auth-form-desc">Sign in to your quantum-secure account</p>
          </div>

          {step === 1 ? (
            <form onSubmit={handleLogin} className="auth-form" data-testid="login-form">
              <div className="auth-field">
                <Label className="auth-label">Email</Label>
                <div className="relative">
                  <Mail className="auth-field-icon" />
                  <Input
                    data-testid="login-email-input"
                    className="auth-input"
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="auth-field">
                <Label className="auth-label">Password</Label>
                <div className="relative">
                  <Lock className="auth-field-icon" />
                  <Input
                    data-testid="login-password-input"
                    className="auth-input"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && <p className="auth-error" data-testid="login-error">{error}</p>}

              <Button type="submit" className="auth-submit-btn" disabled={loading}>
                {loading ? "Authenticating..." : "Start Secure Session"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="auth-form" data-testid="otp-form">
              <div className="auth-field">
                <div className="flex justify-center" data-testid="otp-input-group">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} className="auth-otp-slot" />
                      <InputOTPSlot index={1} className="auth-otp-slot" />
                      <InputOTPSlot index={2} className="auth-otp-slot" />
                      <InputOTPSlot index={3} className="auth-otp-slot" />
                      <InputOTPSlot index={4} className="auth-otp-slot" />
                      <InputOTPSlot index={5} className="auth-otp-slot" />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <p className="text-xs text-center text-[#94A3B8] mt-3">
                  Enter the 6-digit verification code
                </p>
              </div>

              {error && <p className="auth-error" data-testid="otp-error">{error}</p>}

              <Button
                data-testid="otp-verify-button"
                className="auth-submit-btn"
                disabled={loading || otp.length < 6}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Login"}
              </Button>
              <Button
                data-testid="otp-back-button"
                type="button"
                className="w-full bg-[#F4F5F7] hover:bg-[#E2E8F0] text-[#475569] font-bold h-[3rem] mt-3 rounded-[0.75rem] border border-[#E2E8F0] shadow-sm transition-all"
                onClick={() => { setStep(1); setOtp(""); setError(""); }}
              >
                Back to login
              </Button>
            </form>
          )}

          <div className="auth-switch">
            <p>
              New to Trunex?{" "}
              <button onClick={() => navigate("/register")} className="auth-switch-link">
                Create Account
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
