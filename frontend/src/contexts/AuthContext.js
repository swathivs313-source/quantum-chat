import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/api/auth/me");
      setUser(data.user);
      const accessToken = data.access_token || localStorage.getItem("access_token");
      if (accessToken) {
        localStorage.setItem("access_token", accessToken);
        setToken(accessToken);
      }
      // Persist PQC keys for legacy/migrated users
      if (data.user?.kyber_pubkey) {
        // Since we generated these on the server for legacy users, 
        // they might not have the private keys yet. 
        // For now, we store the public keys so the UI badges appear.
        localStorage.setItem(`pqc_pub_${data.user.id}`, JSON.stringify({
          kyber: data.user.kyber_pubkey,
          dilithium: data.user.dilithium_pubkey
        }));
      }
    } catch {
      setUser(null);
      setToken(null);
      localStorage.removeItem("access_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = (userData, accessToken) => {
    setUser(userData);
    setToken(accessToken);
    if (accessToken) {
      localStorage.setItem("access_token", accessToken);
    }
    // Persist PQC keys for legacy/migrated users
    if (userData?.kyber_pubkey) {
      localStorage.setItem(`pqc_pub_${userData.id}`, JSON.stringify({
        kyber: userData.kyber_pubkey,
        dilithium: userData.dilithium_pubkey
      }));
    }
  };

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // ignore
    }
    setUser(null);
    setToken(null);
    localStorage.removeItem("access_token");
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
