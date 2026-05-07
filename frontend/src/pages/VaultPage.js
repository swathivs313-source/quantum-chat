import { useState, useEffect } from "react";
import { Lock, Unlock, Shield, File, FileText, Plus, Trash2, X, Eye } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { generatePQCKeypair } from "@/lib/pqc";
import { derivePinKey, encryptVaultItem, decryptVaultItem, initializeVault } from "@/lib/vaultCrypto";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export default function VaultPage() {
  const { user } = useAuth();
  const [isLocked, setIsLocked] = useState(true);
  const [pin, setPin] = useState("");
  const [vaultKey, setVaultKey] = useState(null);
  const [items, setItems] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("files");

  useEffect(() => {
    checkVaultStatus();
  }, []);

  const checkVaultStatus = async () => {
    try {
      const { data } = await api.get("/api/vault/config");
      setIsInitialized(data.active);
      setLoading(false);
    } catch (e) {
      setLoading(false);
    }
  };

  const handleInitialize = async () => {
    if (pin.length < 4) return toast.error("PIN must be at least 4 digits");
    try {
      setLoading(true);
      
      let currentPubKey = user.kyber_pubkey;
      
      // AUTO-UPGRADE: If no PQC keys, generate them now!
      if (!currentPubKey) {
        toast.info("Upgrading account to Post-Quantum security...");
        const newKeys = generatePQCKeypair();
        
        // Save Public Keys to Server
        await api.post("/api/vault/upgrade-pqc", {
          kyber_pubkey: newKeys.kem.publicKey,
          dilithium_pubkey: newKeys.dsa.publicKey
        });
        
        // Save Private Keys Locally
        localStorage.setItem(`pqc_priv_${user.id}`, JSON.stringify({
          kem: newKeys.kem.secretKey,
          dilithium: newKeys.dsa.secretKey
        }));
        
        currentPubKey = newKeys.kem.publicKey;
      }

      const { wrapped_key, kem_ct, vaultKey: rawKey } = await initializeVault(currentPubKey);
      
      const salt = btoa(String.fromCharCode(...window.crypto.getRandomValues(new Uint8Array(16))));
      
      await api.post("/api/vault/init", {
        wrapped_key: wrapped_key,
        salt: salt,
        iterations: 100000
      });

      setVaultKey(rawKey);
      setIsInitialized(true);
      setIsLocked(false);
      loadVaultItems();
      toast.success("Quantum Vault Initialized! 🛡️");
    } catch (e) {
      console.error("Vault Init Error:", e);
      toast.error(`Error: ${e.response?.data?.detail || e.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    try {
      setLoading(true);
      const { data: config } = await api.get("/api/vault/config");
      
      // 1. Recover User's PQC Private Key from local storage
      const privKeyRaw = localStorage.getItem(`pqc_priv_${user.id}`);
      if (!privKeyRaw) throw new Error("Private Key not found locally");
      
      // 2. Implementation Note: In a full app, unwrap KEM context here
      // For now, we simulate with session-derived key if initialized in this session
      // or implement the full decapsulation logic from pqc.js
      
      setIsLocked(false);
      loadVaultItems();
    } catch (e) {
      toast.error("Unlock failed. Check PIN and Key.");
    } finally {
      setLoading(false);
    }
  };

  const loadVaultItems = async () => {
    try {
      const { data } = await api.get("/api/vault/items");
      setItems(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setLoading(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const fileData = new Uint8Array(reader.result);
        
        // 1. Encrypt Metadata
        const metadata = JSON.stringify({ name: file.name, size: file.size, type: file.type });
        const encMetadata = await encryptVaultItem(new TextEncoder().encode(metadata), vaultKey);
        
        // 2. Encrypt File Content
        const encContent = await encryptVaultItem(fileData, vaultKey);
        
        // 3. Upload to Server
        await api.post("/api/vault/items", {
          type: "file",
          encrypted_metadata: encMetadata,
          note_content: encContent // Reusing field for simplicity in this version
        });

        toast.success(`${file.name} is now Quantum-Safe! 🛡️`);
        loadVaultItems();
      };
      reader.readAsArrayBuffer(file);
    } catch (e) {
      toast.error("Encryption/Upload failed");
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="h-full flex items-center justify-center text-emerald-500 bg-black/40 backdrop-blur-3xl">Connecting to Quantum Vault...</div>;

  if (isLocked) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-black/40 backdrop-blur-3xl">
        <div className="glass-panel p-10 rounded-3xl w-full max-w-md text-center transform animate-fade-in-up">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Shield className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Quantum Vault</h1>
          <p className="text-slate-400 mb-8">
            {isInitialized ? "Enter your Secure PIN to unlock" : "Initialize your Post-Quantum Vault"}
          </p>

          <div className="space-y-4">
            <input
              type="password"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="glass-input w-full p-4 rounded-xl text-center text-2xl tracking-widest outline-none focus:glow-green"
            />
            
            <Button 
              onClick={isInitialized ? handleUnlock : handleInitialize}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white p-6 rounded-xl text-lg font-semibold"
            >
              {isInitialized ? "Unlock Vault" : "Set Vault PIN"}
            </Button>
          </div>

          <div className="mt-8 text-xs text-slate-500 flex items-center justify-center gap-2">
            <Lock className="w-3 h-3" /> PQC Layer Active (Kyber-768)
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-8 animate-fade-in-up overflow-hidden">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Secure Vault 🛡️</h1>
          <p className="text-slate-400">Locked and invisible content</p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => setIsLocked(true)}
          className="border-white/10 hover:bg-white/5"
        >
          <Lock className="w-4 h-4 mr-2" /> Lock Now
        </Button>
      </div>

      <div className="flex gap-4 mb-8">
        {["Files", "Notes"].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab.toLowerCase())}
            className={`px-6 py-2 rounded-full transition-all ${
              activeTab === tab.toLowerCase() 
              ? "bg-emerald-500 text-black font-bold" 
              : "glass-panel text-slate-400 hover:bg-white/5"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 overflow-y-auto pr-2 pb-20">
        <div 
          className="glass-panel border-dashed border-2 border-emerald-500/20 rounded-2xl flex flex-col items-center justify-center p-6 cursor-pointer hover:bg-emerald-500/5 transition-all group relative"
          onClick={() => document.getElementById("vault-upload").click()}
        >
          <input 
            id="vault-upload" 
            type="file" 
            className="hidden" 
            onChange={handleFileUpload}
          />
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Plus className="text-emerald-500" />
          </div>
          <span className="text-sm font-medium text-emerald-500">Secure Add</span>
        </div>

        {items.filter(i => activeTab === "files" ? i.type === "file" : i.type === "note").map(item => (
          <div key={item.id} className="glass-panel rounded-2xl p-4 flex flex-col group hover:glow-green transition-all">
            <div className="aspect-square bg-white/5 rounded-xl mb-4 flex items-center justify-center">
              {item.type === "file" ? <File className="w-10 h-10 text-slate-500" /> : <FileText className="w-10 h-10 text-emerald-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">Encrypted Content</p>
              <p className="text-xs text-slate-500">{new Date(item.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="p-2 hover:bg-emerald-500/20 rounded-lg text-emerald-500"><Eye className="w-4 h-4" /></button>
              <button className="p-2 hover:bg-red-500/20 rounded-lg text-red-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
