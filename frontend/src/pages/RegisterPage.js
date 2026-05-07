import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "@/Quantum.css";
import { useAuth } from "@/contexts/AuthContext";
import api, { handleApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, User, Mail, Phone, Lock, Loader2, Zap, Eye, Fingerprint } from "lucide-react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { toast } from "sonner";
import { x25519 } from "@noble/curves/ed25519.js";
import { generatePQCKeypair } from "@/lib/pqc";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", phone_number: "", password: "", confirmPassword: "" });
  const [userId, setUserId] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countryCode, setCountryCode] = useState("+91");

  const COUNTRY_CODES = [
    { code: "+91", label: "🇮🇳 +91 (India)" },
    { code: "+1", label: "🇺🇸 +1 (USA)" },
    { code: "+44", label: "🇬🇧 +44 (UK)" },
    { code: "+971", label: "🇦🇪 +971 (UAE)" },
    { code: "+61", label: "🇦🇺 +61 (Australia)" },
    { code: "+65", label: "🇸🇬 +65 (Singapore)" },
    { code: "+1", label: "🇨🇦 +1 (Canada)" },
    { code: "+49", label: "🇩🇪 +49 (Germany)" },
    { code: "+33", label: "🇫🇷 +33 (France)" },
  ];

  if (user) {
    navigate("/chat", { replace: true });
    return null;
  }

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      // ── HYBRID PQC KEY GENERATION ──────────────────────────────────────────
      const xPriv = crypto.getRandomValues(new Uint8Array(32));
      const xPub = x25519.getPublicKey(xPriv);
      const pqcKeys = generatePQCKeypair();

      const public_key = btoa(String.fromCharCode(...xPub));
      const private_key = btoa(String.fromCharCode(...xPriv));

      const full_phone = countryCode + form.phone_number.replace(/^\+/, "");
      
      const { data } = await api.post("/api/auth/register", {
        name: form.name, email: form.email, phone_number: full_phone, password: form.password,
        public_key: public_key,
        kyber_pubkey: pqcKeys.kem.publicKey,
        dilithium_pubkey: pqcKeys.dsa.publicKey,
      });

      // Securely store private keys locally (True E2EE)
      localStorage.setItem(`pqc_priv_${data.user_id}`, JSON.stringify({
        x25519: private_key,
        kyber: pqcKeys.kem.secretKey,
        dilithium: pqcKeys.dsa.secretKey
      }));

      setUserId(data.user_id);
      setStep(2);
      if (data.demo_otp) {
        toast.info(`Demo OTP: ${data.demo_otp}`, { duration: 30000, description: "OTP delivery failed, using demo mode" });
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
      const { data } = await api.post("/api/auth/verify-otp", { user_id: userId, otp_code: otp });
      login(data.user, data.access_token);
      toast.success("Account created successfully");
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
          <p className="auth-hero-subtitle">Join the Quantum Frontier</p>
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
            <h2 className="auth-form-title">Create Account</h2>
            <p className="auth-form-desc">Set up your quantum-secure identity</p>
          </div>

          {step === 1 ? (
            <form onSubmit={handleRegister} className="auth-form" data-testid="register-form">
              <div className="auth-field">
                <Label className="auth-label">Name</Label>
                <div className="relative">
                  <User className="auth-field-icon" />
                  <Input
                    data-testid="register-name-input"
                    className="auth-input"
                    placeholder="Your full name"
                    value={form.name}
                    onChange={(e) => updateForm("name", e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="auth-field">
                <Label className="auth-label">Email</Label>
                <div className="relative">
                  <Mail className="auth-field-icon" />
                  <Input
                    data-testid="register-email-input"
                    className="auth-input"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(e) => updateForm("email", e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="auth-field">
                <Label className="auth-label">Phone Number</Label>
                <div className="flex gap-2">
                  <div className="w-[110px] shrink-0">
                    <Select value={countryCode} onValueChange={setCountryCode}>
                      <SelectTrigger className="auth-input h-11 pl-3">
                        <SelectValue placeholder="+91" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-[#E2E8F0] text-[#334155]">
                        {COUNTRY_CODES.map((c) => (
                          <SelectItem key={c.label} value={c.code} className="hover:bg-[#F4F5F7] focus:bg-[#F4F5F7] cursor-pointer">
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative flex-1">
                    <Phone className="auth-field-icon" />
                    <Input
                      data-testid="register-phone-input"
                      className="auth-input"
                      placeholder="9988776655"
                      value={form.phone_number}
                      onChange={(e) => updateForm("phone_number", e.target.value.replace(/\D/g, ""))}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="auth-field">
                  <Label className="auth-label">Password</Label>
                  <div className="relative">
                    <Lock className="auth-field-icon" />
                    <Input
                      data-testid="register-password-input"
                      className="auth-input"
                      type="password"
                      placeholder="Min 6 chars"
                      value={form.password}
                      onChange={(e) => updateForm("password", e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="auth-field">
                  <Label className="auth-label">Confirm</Label>
                  <div className="relative">
                    <Lock className="auth-field-icon" />
                    <Input
                      data-testid="register-confirm-input"
                      className="auth-input"
                      type="password"
                      placeholder="Repeat"
                      value={form.confirmPassword}
                      onChange={(e) => updateForm("confirmPassword", e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              {error && <p className="auth-error" data-testid="register-error">{error}</p>}

              <Button
                data-testid="register-submit-button"
                className="auth-submit-btn"
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Account"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="auth-form" data-testid="register-otp-form">
              <div className="auth-field">
                <div className="flex justify-center" data-testid="register-otp-input-group">
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

              {error && <p className="auth-error" data-testid="register-otp-error">{error}</p>}

              <Button type="submit" className="auth-submit-btn" disabled={loading}>
                {loading ? "Initializing PQC..." : "Verify & Create Account"}
              </Button>
              <Button
                data-testid="register-otp-back-button"
                type="button"
                className="w-full bg-[#F4F5F7] hover:bg-[#E2E8F0] text-[#475569] font-bold h-[3rem] mt-3 rounded-[0.75rem] border border-[#E2E8F0] shadow-sm transition-all"
                onClick={() => { setStep(1); setOtp(""); setError(""); }}
              >
                Back
              </Button>
            </form>
          )}

          <div className="auth-switch">
            <p>
              Already have an account?{" "}
              <button onClick={() => navigate("/login")} className="auth-switch-link">
                Sign In
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
