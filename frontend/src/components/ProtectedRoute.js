import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Shield } from "lucide-react";

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0F14]" data-testid="loading-screen">
        <div className="text-center">
          <Shield className="w-12 h-12 text-[#10B981] mx-auto animate-pulse mb-3" />
          <p className="text-[#94A3B8] text-sm font-manrope">Establishing secure connection...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/chat" replace />;
  return children;
}
