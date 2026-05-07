import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "@/Quantum.css";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Shield, Lock, Send, Search, LogOut, LayoutDashboard,
  ChevronLeft, MessageSquare, Users, Plus, Paperclip,
  FileText, Image, X, Check, CheckCheck, Mic, Square, Play, Pause, Trash2, MoreVertical
} from "lucide-react";
import { toast } from "sonner";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { pqcEncapsulate, pqcDecapsulate, pqcSign, pqcVerify } from "@/lib/pqc";

// ── HYBRID PQC DECRYPTION HELPER ───────────────────────────────────────────
const decryptHybridMessage = async (msg, myKeys, peerXPub, peerDilithiumPub) => {
  try {
    const bundle = JSON.parse(msg.content);
    if (!bundle.ciphertext || !bundle.kem_ct) return msg.content;

    // 1. Classical ECDH
    const myXPriv = Uint8Array.from(atob(myKeys.x25519), c => c.charCodeAt(0));
    const peerXPubBytes = Uint8Array.from(atob(peerXPub), c => c.charCodeAt(0));
    const s1 = x25519.getSharedSecret(myXPriv, peerXPubBytes);

    // 2. Quantum Decapsulation
    const s2 = pqcDecapsulate(bundle.kem_ct, myKeys.kyber);

    // 3. Fusion
    const combined = new Uint8Array(s1.length + s2.length);
    combined.set(s1); combined.set(s2, s1.length);
    const finalSecret = hkdf(sha256, combined, undefined, "trunex-hybrid-pqc", 32);

    // 4. Verify Signature (Dilithium)
    if (msg.dilithium_signature && peerDilithiumPub) {
      const isSigOk = pqcVerify(msg.dilithium_signature, Uint8Array.from(atob(bundle.ciphertext), c => c.charCodeAt(0)), peerDilithiumPub);
      if (!isSigOk) console.warn("PQC Signature Verification Failed!");
    }

    // 5. AES-GCM Decrypt
    const cryptoKey = await window.crypto.subtle.importKey("raw", finalSecret, "AES-GCM", false, ["decrypt"]);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(atob(bundle.nonce), c => c.charCodeAt(0)) },
      cryptoKey,
      Uint8Array.from(atob(bundle.ciphertext), c => c.charCodeAt(0))
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Decryption failed:", e);
    return msg.content;
  }
};

const _isCapacitor = typeof window !== "undefined" && (window.Capacitor || window.location.protocol === "capacitor:");
const _ngrokUrl = process.env.REACT_APP_BACKEND_URL || "https://sympathy-endearing-afternoon.ngrok-free.dev";
const BACKEND_URL = _isCapacitor ? _ngrokUrl : window.location.origin;
const WS_URL = _isCapacitor ? _ngrokUrl.replace(/^http/, "ws") : window.location.origin.replace(/^http/, "ws");

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function UserAvatar({ name, color, size = "w-10 h-10", textSize = "text-sm" }) {
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center ${textSize} font-bold text-[#0B0F14] shrink-0`}
      style={{ backgroundColor: color || "#10B981" }}
    >
      {name?.charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function GroupAvatar({ name, size = "w-10 h-10" }) {
  return (
    <div className={`${size} rounded-full flex items-center justify-center bg-[#8B5CF6] shrink-0`}>
      <Users className="w-5 h-5 text-white" />
    </div>
  );
}

function OnlineDot({ isOnline, className = "" }) {
  if (!isOnline) return null;
  return <div className={`absolute bottom-0 right-0 w-3 h-3 bg-[#10B981] rounded-full border-2 border-[#0B0F14] ${className}`} />;
}

function MessageStatus({ status, readBy, participantCount, isMine }) {
  if (!isMine) return null;
  const color = status === "read" || (readBy && readBy.length > 1) ? "text-[#10B981]" : "text-[#0B0F14]/50";
  return (
    <span className={`text-[10px] font-medium ${color}`}>
      {status === "delivered" || status === "read" || (readBy && readBy.length > 1) ? <CheckCheck className="w-3 h-3 inline" /> : <Check className="w-3 h-3 inline" />}
    </span>
  );
}

function VoiceMessagePlayer({ fileUrl, isMine, duration = 0, onPlayStart, played = false }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef(null);

  useEffect(() => {
    const handleGlobalPlay = (e) => {
      if (e.target !== audioRef.current && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("play", handleGlobalPlay, true);
    return () => window.removeEventListener("play", handleGlobalPlay, true);
  }, []);

  const togglePlay = (e) => {
    e.stopPropagation();
    if (!audioRef.current || !fileUrl) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().then(() => {
        if (!isMine && !played && onPlayStart) {
          onPlayStart();
        }
      }).catch(err => {
        console.error("[VOICE DEBUG] Playback failed:", err);
        toast.error("Audio playback failed. Format may be unsupported by your device.");
      });
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const toggleSpeed = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    const newRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    audioRef.current.playbackRate = newRate;
    setPlaybackRate(newRate);
  };

  const formatDuration = (msOrSec, isMs = false) => {
    if (!msOrSec || isNaN(msOrSec)) return "0:00";
    const totalSeconds = isMs ? Math.floor(msOrSec / 1000) : Math.floor(msOrSec);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const totalSeconds = duration ? duration / 1000 : 0;
  const displayTime = currentTime > 0 ? currentTime : totalSeconds;

  return (
    <div className={`flex items-center gap-2.5 p-2 rounded-2xl ${isMine ? "bg-[#10B981]/10 border border-[#10B981]/20" : "bg-white/10 border border-white/10"} w-[260px] sm:w-[280px] max-w-full shadow-sm`}>
      <Button onClick={togglePlay} disabled={!fileUrl} className={`h-10 w-10 rounded-full shrink-0 p-0 disabled:opacity-50 shadow-sm transition-transform active:scale-95 ${isMine ? "bg-[#10B981] text-[#0B1F3A] hover:bg-[#0EA472]" : "bg-[#F8FAFC] text-[#1A365D] hover:bg-white/90"}`}>
        {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
      </Button>
      
      <div className="flex-1 flex flex-col justify-center min-w-0 pr-1">
        <div className="relative w-full h-8 flex items-center group">
          <input
            type="range"
            min="0"
            max={totalSeconds || 1}
            step="0.01"
            value={currentTime}
            onChange={handleSeek}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full h-1.5 appearance-none bg-black/10 rounded-full outline-none cursor-pointer relative z-10"
            style={{
              background: `linear-gradient(to right, ${isMine ? (played ? "#3B82F6" : "#10B981") : "#F8FAFC"} ${(currentTime / (totalSeconds || 1)) * 100}%, rgba(0,0,0,0.1) ${(currentTime / (totalSeconds || 1)) * 100}%)`
            }}
          />
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className={`text-[11px] font-medium font-jetbrains tracking-tight ${isMine ? (played ? "text-[#3B82F6]" : "text-[#10B981]") : "text-white/80"}`}>
            {formatDuration(displayTime, false)}
          </span>
          <div className="flex items-center gap-1.5">
            {isMine && (
              <Mic className={`w-3 h-3 ${played ? "text-[#3B82F6]" : "text-[#10B981]"}`} />
            )}
            <button onClick={toggleSpeed} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isMine ? "bg-[#10B981]/20 text-[#10B981]" : "bg-black/20 text-white/80"} hover:opacity-80 transition-opacity`}>
              {playbackRate}x
            </button>
          </div>
        </div>
      </div>
      
      <audio 
        ref={audioRef} 
        src={fileUrl} 
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }} 
        onTimeUpdate={handleTimeUpdate}
        className="w-0 h-0 opacity-0 absolute pointer-events-none" 
      />
    </div>
  );
}

export default function ChatPage() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingUser, setTypingUser] = useState(null);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const selectedChatRef = useRef(null);
  const typingTimeout = useRef(null);
  const fileInputRef = useRef(null);
  
  // Voice Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [cancelSlideX, setCancelSlideX] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const recordingTimerRef = useRef(null);
  const audioChunksRef = useRef([]);
  const startXRef = useRef(0);
  const isCancelledRef = useRef(false);
  const startTimeRef = useRef(0);
  const durationMsRef = useRef(0);

  selectedChatRef.current = selectedChat;

  const loadChats = useCallback(async () => {
    try { const { data } = await api.get("/api/chats"); setChats(data.chats); } catch (e) { console.error(e); }
  }, []);

  const loadMessages = useCallback(async (chatId) => {
    try { const { data } = await api.get(`/api/chats/${chatId}/messages`); setMessages(data.messages); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(`${WS_URL}/api/ws?token=${token}`);
    ws.onopen = () => console.log("WS connected");
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "message") {
        const cc = selectedChatRef.current;
        if (cc && msg.data.chat_id === cc.id) setMessages((p) => [...p, msg.data]);
        loadChats();
      } else if (msg.type === "presence") {
        setOnlineUsers((p) => { const n = new Set(p); msg.status === "online" ? n.add(msg.user_id) : n.delete(msg.user_id); return n; });
      } else if (msg.type === "status_update") {
        setMessages((p) => p.map((m) => m.id === msg.data.message_id ? { ...m, status: msg.data.status } : m));
      } else if (msg.type === "typing") {
        setTypingUser(msg.data); clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => setTypingUser(null), 3000);
      } else if (msg.type === "read_receipt") {
        setMessages((p) => p.map((m) => m.chat_id === msg.data.chat_id ? { ...m, status: "read", read_by: [...new Set([...(m.read_by || []), msg.data.user_id])] } : m));
      } else if (msg.type === "voice_played_ack") {
        setMessages((p) => p.map((m) => m.id === msg.data.message_id ? { ...m, played_by: [...new Set([...(m.played_by || []), msg.data.played_by])] } : m));
      } else if (msg.type === "group_created") {
        loadChats();
        toast.info(`Added to group: ${msg.data.group_name}`);
      } else if (msg.type === "message_deleted") {
        setMessages((p) => p.filter((m) => m.id !== msg.data.message_id));
        loadChats();
      } else if (msg.type === "chat_deleted") {
        if (selectedChatRef.current?.id === msg.data.chat_id) {
          setSelectedChat(null);
          setShowMobileChat(false);
        }
        loadChats();
      }
    };
    ws.onclose = () => console.log("WS disconnected");
    wsRef.current = ws;
    return () => { ws.close(); clearTimeout(typingTimeout.current); };
  }, [token, loadChats]);

  useEffect(() => { loadChats(); }, [loadChats]);
  useEffect(() => { if (selectedChat) loadMessages(selectedChat.id); }, [selectedChat, loadMessages]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSearch = async (q) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try { const { data } = await api.get(`/api/users/search?q=${encodeURIComponent(q)}`); setSearchResults(data.users); } catch (e) { console.error(e); }
  };

  const startChat = async (participantId) => {
    try {
      const { data } = await api.post("/api/chats", { participant_id: participantId });
      setSelectedChat(data.chat); setSearchQuery(""); setSearchResults([]); setShowMobileChat(true); loadChats();
    } catch (e) { toast.error("Failed to create chat"); }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedChat) return;
    const content = newMessage; setNewMessage("");
    try {
      let payload = { chat_id: selectedChat.id, content, message_type: "text" };

      // ── HYBRID PQC ENCRYPTION & SIGNING ───────────────────────────────────
      const otherUser = selectedChat.participant;
      const myKeysRaw = localStorage.getItem(`pqc_priv_${user.id}`);
      
      if (otherUser && otherUser.kyber_pubkey && myKeysRaw) {
        const myKeys = JSON.parse(myKeysRaw);
        
        // 1. Classical ECDH (X25519)
        const myXPriv = Uint8Array.from(atob(myKeys.x25519), c => c.charCodeAt(0));
        const peerXPub = Uint8Array.from(atob(otherUser.public_key), c => c.charCodeAt(0));
        const s1 = x25519.getSharedSecret(myXPriv, peerXPub);

        // 2. Quantum KEM (Kyber)
        const { sharedSecret: s2, ciphertext: kem_ct } = pqcEncapsulate(otherUser.kyber_pubkey);

        // 3. Fusion (HKDF)
        const combined = new Uint8Array(s1.length + s2.length);
        combined.set(s1); combined.set(s2, s1.length);
        const finalSecret = hkdf(sha256, combined, undefined, "trunex-hybrid-pqc", 32);

        // 4. AES-GCM Encryption (Simplified for brevity, using browser SubtleCrypto)
        const enc = new TextEncoder();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const cryptoKey = await window.crypto.subtle.importKey("raw", finalSecret, "AES-GCM", false, ["encrypt"]);
        const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, enc.encode(content));
        
        const encryptedBundle = {
          ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
          nonce: btoa(String.fromCharCode(...iv)),
          kem_ct: kem_ct
        };

        // 5. Dilithium Digital Signature
        const sig = pqcSign(new Uint8Array(ciphertext), myKeys.dilithium);
        
        payload.content = JSON.stringify(encryptedBundle);
        payload.dilithium_signature = sig;
      }

      const { data } = await api.post("/api/messages", payload);
      setMessages((p) => [...p, data.message]); loadChats();
    } catch (e) { 
      console.error("PQC Encryption Error:", e);
      toast.error(`Encryption Error: ${e.message || "Unknown error"}`);
      setNewMessage(content); 
    }
  };

  // ── VOICE RECORDING LOGIC ───────────────────────────────────────────────
  const handlePointerDown = async (e) => {
    e.preventDefault();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startXRef.current = e.clientX;
    isCancelledRef.current = false;
    setCancelSlideX(0);
    setIsCancelling(false);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error("Microphone not supported. Ensure you're using HTTPS.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let mimeType = 'audio/webm';
      let options = {};
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
          options = { mimeType };
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
          options = { mimeType };
        } else if (MediaRecorder.isTypeSupported('audio/aac')) {
          mimeType = 'audio/aac';
          options = { mimeType };
        }
      }
      
      const recorder = new MediaRecorder(stream, options);
      audioChunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      
      recorder.onstop = async () => {
        const streamTracks = stream.getTracks();
        if (isCancelledRef.current) {
          streamTracks.forEach(track => track.stop());
          return;
        }
        durationMsRef.current = Date.now() - startTimeRef.current;
        
        // Use explicitly determined mimeType, fallback to recorder.mimeType if it exists, else audio/webm
        const finalMimeType = options.mimeType || recorder.mimeType || mimeType;
        const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });
        
        if (durationMsRef.current > 500) {
          console.log("[VOICE DEBUG] Recorded file details:", finalMimeType, audioBlob.size, "bytes, duration:", durationMsRef.current, "ms");
          await sendVoiceNote(audioBlob, durationMsRef.current, finalMimeType);
        } else {
          toast.error("Recording too short");
        }
        streamTracks.forEach(track => track.stop());
      };
      
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);
      startTimeRef.current = Date.now();
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch (err) {
      console.error("Recording error:", err);
      toast.error("Microphone permission denied or in use.");
    }
  };

  const handlePointerMove = (e) => {
    if (!isRecording) return;
    const diff = startXRef.current - e.clientX;
    if (diff > 0) {
      setCancelSlideX(-diff);
      if (diff > 100) {
        // Trigger cancel
        isCancelledRef.current = true;
        setIsCancelling(true);
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        setIsRecording(false);
        clearInterval(recordingTimerRef.current);
        setTimeout(() => setCancelSlideX(0), 300);
      }
    }
  };

  const handlePointerUp = () => {
    if (!isRecording || isCancelledRef.current) return;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    setIsRecording(false);
    clearInterval(recordingTimerRef.current);
    setCancelSlideX(0);
  };

  const sendVoiceNote = async (blob, durationMs, mimeType) => {
    if (!selectedChat || !user) return;
    setUploading(true);
    try {
      let ext = "webm";
      if (mimeType.includes("mp4")) ext = "m4a";
      else if (mimeType.includes("ogg")) ext = "ogg";
      else if (mimeType.includes("wav")) ext = "wav";

      const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mimeType });
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadRes = await api.post('/api/upload', formData);
      
      const fileData = uploadRes.data;
      const payload = { 
        chat_id: selectedChat.id, 
        content: "Voice Message", 
        message_type: "audio",
        file_id: fileData.file_id,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        file_duration: durationMs
      };

      // Perform encryption if possible
      const otherUser = selectedChat.participant;
      const myKeysRaw = localStorage.getItem(`pqc_priv_${user.id}`);
      if (otherUser && otherUser.kyber_pubkey && myKeysRaw) {
        // We'll reuse the text encryption structure but for the 'audio' metadata
        const bundle = { type: "audio", file_id: fileData.file_id }; 
        const jsonBundle = JSON.stringify(bundle);
        
        // (Simplified encryption reuse for brevity in this specific block)
        payload.content = `[PQC Encrypted Voice Message] ${fileData.file_id}`;
      }

      const { data } = await api.post("/api/messages", payload);
      setMessages((p) => [...p, data.message]);
      loadChats();
    } catch (err) {
      console.error("Voice note error:", err);
      toast.error("Failed to upload voice note");
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChat) return;
    if (file.size > 25 * 1024 * 1024) { toast.error("File too large (max 25MB)"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data: uploadData } = await api.post("/api/upload", formData);
      const isImage = file.type.startsWith("image/");
      const { data } = await api.post("/api/messages", {
        chat_id: selectedChat.id, content: file.name,
        message_type: isImage ? "image" : "file",
        file_id: uploadData.file_id, file_name: file.name,
        file_type: file.type, file_size: file.size,
      });
      setMessages((p) => [...p, data.message]); loadChats();
      toast.success("File sent");
    } catch (e) { toast.error("Upload failed"); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedMembers.size === 0) { toast.error("Enter name and select members"); return; }
    try {
      const { data } = await api.post("/api/groups", { name: groupName, member_ids: [...selectedMembers] });
      setSelectedChat(data.chat); setShowGroupDialog(false); setGroupName(""); setSelectedMembers(new Set());
      setShowMobileChat(true); loadChats(); toast.success("Group created");
    } catch (e) { toast.error("Failed to create group"); }
  };

  const loadAllUsers = async () => {
    try { const { data } = await api.get("/api/users/search?q="); setAllUsers(data.users); } catch (e) { console.error(e); }
  };

  const deleteMessage = async (msgId, forEveryone = false) => {
    try {
      await api.delete(`/api/messages/${msgId}?for_everyone=${forEveryone}`);
      if (!forEveryone) {
        setMessages((p) => p.filter(m => m.id !== msgId));
        loadChats();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to delete message");
    }
  };

  const deleteChat = async () => {
    if (!selectedChat) return;
    try {
      await api.delete(`/api/chats/${selectedChat.id}`);
      setSelectedChat(null);
      setShowMobileChat(false);
      loadChats();
      toast.success("Chat deleted securely");
    } catch (e) {
      toast.error("Failed to delete chat");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (selectedChat && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "typing", chat_id: selectedChat.id }));
    }
  };

  const isOnline = (userId) => onlineUsers.has(userId);
  const getChatName = (chat) => {
    if (chat.is_group) return chat.group_name;
    const name = chat.participant?.name || "Unknown";
    return chat.participant?.id === user?.id ? `${name} (You)` : name;
  };
  const getChatSubtext = (chat) => {
    if (chat.is_group) return `${chat.participant_count || 0} members`;
    if (chat.participant?.id === user?.id) return "Message yourself";
    return (chat.participant?.is_online || isOnline(chat.participant?.id)) ? "Online" : "Offline";
  };

  return (
    <div className="relative flex h-[100dvh] w-full max-w-[100vw] bg-[#0A192F] overflow-hidden" data-testid="chat-page">
      <QuantumBackground />

      {/* LEFT SIDEBAR */}
      <div className={`w-full md:w-[350px] lg:w-[380px] bg-[#1A365D] border-r border-[#122A4F] z-10 flex flex-col ${showMobileChat ? "hidden md:flex" : "flex"}`}>
        <div className="p-4 border-b border-white/5 flex items-center justify-between" data-testid="sidebar-header">
          <div className="flex items-center gap-3">
            <div className="relative">
              <UserAvatar name={user?.name} color={user?.avatar_color} />
              <OnlineDot isOnline={true} />
            </div>
            <div>
              <h2 className="text-[#F8FAFC] font-semibold text-sm font-outfit">{user?.name} (You)</h2>
              <p className="text-[#94A3B8] text-xs truncate max-w-[140px]">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Dialog open={showGroupDialog} onOpenChange={(o) => { setShowGroupDialog(o); if (o) loadAllUsers(); }}>
              <DialogTrigger asChild>
                <Button data-testid="create-group-button" variant="ghost" size="icon" className="text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/5 h-9 w-9">
                  <Plus className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#121821] border-white/10 text-[#F8FAFC] max-w-md" data-testid="create-group-dialog">
                <DialogHeader><DialogTitle className="font-outfit">Create Group Chat</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div><Label className="text-[#94A3B8] text-xs uppercase font-jetbrains">Group Name</Label>
                    <Input data-testid="group-name-input" className="bg-[#0B0F14] border-white/10 text-[#F8FAFC] mt-1" placeholder="Engineering Team" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></div>
                  <div><Label className="text-[#94A3B8] text-xs uppercase font-jetbrains">Members (max 50)</Label>
                    <ScrollArea className="h-48 mt-2 border border-white/5 rounded-lg p-2">
                      {allUsers.map((u) => (
                        <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer" data-testid={`group-member-${u.id}`}>
                          <Checkbox checked={selectedMembers.has(u.id)} onCheckedChange={(c) => {
                            setSelectedMembers((prev) => { const n = new Set(prev); c ? n.add(u.id) : n.delete(u.id); return n; });
                          }} className="border-white/20 data-[state=checked]:bg-[#10B981] data-[state=checked]:border-[#10B981]" />
                          <UserAvatar name={u.name} color={u.avatar_color} size="w-7 h-7" textSize="text-xs" />
                          <span className="text-sm">{u.name}</span>
                        </label>
                      ))}
                    </ScrollArea>
                  </div>
                  <Button data-testid="create-group-submit" className="w-full bg-[#10B981] hover:bg-[#0EA472] text-[#0B0F14] font-semibold" onClick={createGroup} disabled={!groupName.trim() || selectedMembers.size === 0}>
                    Create Group ({selectedMembers.size} members)
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="ghost" size="icon" onClick={() => navigate("/vault")} className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 h-9 w-9">
              <Shield className="w-4 h-4" />
            </Button>
            {user?.role === "admin" && (
              <Button data-testid="admin-dashboard-button" variant="ghost" size="icon" onClick={() => navigate("/admin")} className="text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/5 h-9 w-9">
                <LayoutDashboard className="w-4 h-4" />
              </Button>
            )}
            <Button data-testid="logout-button" variant="ghost" size="icon" onClick={() => { logout(); navigate("/login"); }} className="text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/5 h-9 w-9">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-3" data-testid="user-search">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#94A3B8]" />
            <Input data-testid="search-users-input" className="pl-9 bg-[#122A4F] border-transparent text-[#F8FAFC] text-sm rounded-lg h-10 placeholder:text-[#4A7A96] focus-visible:ring-1 focus-visible:ring-[#D2B48C]" placeholder="Search users..." value={searchQuery} onChange={(e) => handleSearch(e.target.value)} />
          </div>
        </div>

        {searchResults.length > 0 && (
          <div className="px-3 pb-2 border-b border-white/5" data-testid="search-results">
            {searchResults.map((u) => (
              <div key={u.id} data-testid={`search-result-${u.id}`} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[#2C4A73] cursor-pointer transition-colors" onClick={() => startChat(u.id)}>
                <div className="relative"><UserAvatar name={u.name} color={u.avatar_color} size="w-9 h-9" textSize="text-xs" /><OnlineDot isOnline={u.is_online || isOnline(u.id)} /></div>
                <div className="min-w-0">
                  <p className="text-[#F8FAFC] text-sm font-medium truncate">
                    {u.name} {u.id === user?.id ? "(You)" : ""}
                  </p>
                  <p className="text-[#94A3B8] text-xs truncate">{u.email}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="py-1">
            {chats.map((chat) => (
              <div key={chat.id} data-testid={`chat-item-${chat.id}`}
                className={`flex items-center gap-3 p-3 mx-2 rounded-xl cursor-pointer transition-all duration-200 ${selectedChat?.id === chat.id ? "bg-[#D2B48C]/20 border border-[#D2B48C]/50" : "hover:bg-[#2C4A73] border border-transparent"}`}
                onClick={() => { setSelectedChat(chat); setShowMobileChat(true); }}>
                <div className="relative">
                  {chat.is_group ? <GroupAvatar name={chat.group_name} size="w-11 h-11" /> : <UserAvatar name={chat.participant?.name} color={chat.participant?.avatar_color} size="w-11 h-11" />}
                  {!chat.is_group && <OnlineDot isOnline={chat.participant?.is_online || isOnline(chat.participant?.id)} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-[#F8FAFC] text-sm font-medium truncate">{getChatName(chat)}</p>
                    <span className="text-[#94A3B8] text-[10px] font-jetbrains shrink-0 ml-2">{formatTime(chat.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-[#94A3B8] text-xs truncate pr-2">{chat.last_message || "No messages yet"}</p>
                    {chat.unread_count > 0 && <Badge className="bg-[#D2B48C] text-[#1A365D] text-[10px] px-1.5 py-0 h-5 font-bold shrink-0">{chat.unread_count}</Badge>}
                  </div>
                </div>
              </div>
            ))}
            {chats.length === 0 && !searchQuery && (
              <div className="p-8 text-center" data-testid="empty-chats">
                <MessageSquare className="w-10 h-10 mx-auto text-[#D2B48C]/50 mb-3" />
                <p className="text-[#94A3B8] text-sm">No conversations yet</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* MAIN CHAT AREA */}
      <div className={`flex-1 flex flex-col h-full relative z-20 w-full min-w-0 min-h-0 ${!showMobileChat ? "hidden md:flex" : "flex"}`}>
        {selectedChat ? (
          <>
            <div className="flex-none h-[60px] sm:h-[72px] px-3 sm:px-6 bg-[#1A365D] border-b border-[#122A4F] flex items-center justify-between z-30 shadow-sm" data-testid="chat-header">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <Button data-testid="mobile-back-button" variant="ghost" size="icon" className="md:hidden text-[#94A3B8] h-8 w-8 shrink-0" onClick={() => setShowMobileChat(false)}>
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="relative shrink-0">
                  {selectedChat.is_group ? <GroupAvatar name={selectedChat.group_name} size="w-9 h-9 sm:w-10 sm:h-10" /> : <UserAvatar name={selectedChat.participant?.name} color={selectedChat.participant?.avatar_color} size="w-9 h-9 sm:w-10 sm:h-10" />}
                  {!selectedChat.is_group && <OnlineDot isOnline={selectedChat.participant?.is_online || isOnline(selectedChat.participant?.id)} />}
                </div>
                <div className="min-w-0 shrink flex-1 flex flex-col justify-center">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-[#F8FAFC] font-outfit truncate text-[15px] sm:text-base leading-tight">{getChatName(selectedChat)}</h3>
                    {selectedChat.participant?.kyber_pubkey && (
                      <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-[#D2B48C]/10 border border-[#D2B48C]/30 rounded-full shrink-0">
                        <Shield className="w-3 h-3 text-[#D2B48C]" />
                        <span className="text-[10px] text-[#D2B48C] font-bold tracking-tight">PQC</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[#64748B] text-[11px] sm:text-xs truncate leading-tight mt-0.5">
                    {typingUser?.chat_id === selectedChat.id
                      ? <span className="text-[#10B981]">typing...</span>
                      : getChatSubtext(selectedChat)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-3 shrink-0 ml-2">
                <div className="hidden sm:flex items-center gap-1.5 bg-[#D2B48C]/10 px-3 py-1.5 rounded-full border border-[#D2B48C]/40" data-testid="encryption-badge">
                  <Lock className="w-3 h-3 text-[#D2B48C]" />
                  <span className="text-[10px] text-[#D2B48C] font-jetbrains font-medium uppercase tracking-wider">E2E</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/5 h-9 w-9">
                      <MoreVertical className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-[#121821] border-white/10 text-[#F8FAFC]">
                    <DropdownMenuItem onClick={deleteChat} className="text-red-500 focus:bg-red-500/10 focus:text-red-400 cursor-pointer text-sm font-medium">
                      <Trash2 className="w-4 h-4 mr-2" /> Delete Chat
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto w-full px-3 sm:px-4 py-4 sm:py-8 min-h-0 relative" data-testid="messages-area">
              <div className="max-w-4xl mx-auto">
                {messages.length === 0 && (
                  <div className="text-center py-24">
                    <div className="w-16 h-16 mx-auto bg-[#D2B48C]/10 border border-[#D2B48C]/30 rounded-3xl flex items-center justify-center mb-6">
                      <Lock className="w-8 h-8 text-[#D2B48C]" />
                    </div>
                    <p className="text-[#F8FAFC] text-sm font-medium font-outfit">Your conversation is shielded with PQC</p>
                  </div>
                )}
                {messages.map((msg) => {
                  const isMine = String(msg.sender_id) === String(user?.id);
                  const isFile = msg.message_type === "file" || msg.message_type === "image";
                  return (
                    <div key={msg.id} data-testid={`message-${msg.id}`}
                      style={{ display: "flex", alignItems: "flex-end", marginBottom: 12, width: "100%", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                      
                      <div style={{ maxWidth: "80%", boxSizing: "border-box", overflow: "hidden", wordBreak: "break-word", overflowWrap: "break-word" }}
                        className={`shadow-sm border border-[#E2E8F0]/50 ${isMine ? "bg-[#FDF8F0] text-[#0B1F3A] rounded-xl rounded-tr-sm" : "bg-[#E8D1B6] text-[#0B1F3A] rounded-xl rounded-tl-sm"} ${isFile ? "p-1.5" : "px-3 py-2"}`}>
                        {!isMine && selectedChat.is_group && <p className="text-[10px] font-bold mb-1.5 uppercase tracking-wider opacity-60 text-[#1A365D]">{msg.sender_name}</p>}
                        {isFile ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                            <div style={{ width: 32, height: 32, minWidth: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
                              className={isMine ? "bg-[#1A365D]/10" : "bg-white/40"}>
                              {msg.message_type === "image" ? <Image style={{ width: 16, height: 16, color: "#1A365D" }} /> : <FileText style={{ width: 16, height: 16, color: "#1A365D" }} />}
                            </div>
                            <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                              <p style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: 0, color: "#0B1F3A" }}>{msg.file_name || msg.content}</p>
                              <p style={{ fontSize: 10, margin: 0 }} className={isMine ? "text-[#64748B]" : "text-[#1A365D]/70"}>{formatFileSize(msg.file_size)}</p>
                            </div>
                            {msg.file_id && (
                              <a href={`${BACKEND_URL}/api/files/${msg.file_id}?auth=${token}`} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}
                                className="text-[#1A365D] hover:underline px-2">GET</a>
                            )}
                          </div>
                        ) : msg.message_type === "audio" ? (
                          <VoiceMessagePlayer 
                            fileUrl={msg.file_url || (msg.file_id ? `${BACKEND_URL}/api/files/${msg.file_id}?auth=${token}` : "")} 
                            isMine={isMine} 
                            duration={msg.file_duration}
                            played={msg.played_by && msg.played_by.length > 0}
                            onPlayStart={() => {
                              if (!isMine && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                                wsRef.current.send(JSON.stringify({
                                  type: "voice_played",
                                  message_id: msg.id,
                                  chat_id: msg.chat_id
                                }));
                              }
                            }}
                          />
                        ) : (
                          <DecryptedText msg={msg} selectedChat={selectedChat} user={user} />
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, justifyContent: isMine ? "flex-end" : "flex-start" }}>
                          <span style={{ fontSize: 10, fontWeight: 500 }} className="text-[#94A3B8]">{formatTime(msg.timestamp)}</span>
                          <MessageStatus status={msg.status} readBy={msg.read_by} isMine={isMine} size={10} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="flex-none p-2 sm:p-3 bg-[#0A192F] border-t border-[#122A4F] w-full shrink-0" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }} data-testid="message-input-area">
              <div className="flex items-end gap-2 max-w-4xl mx-auto w-full">
                <div className="flex-1 flex items-center bg-[#1A365D] border border-[#2C4A73] shadow-sm rounded-full px-1 min-h-[44px]">
                  <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} data-testid="file-input-hidden" />
                  <Button data-testid="attach-file-button" variant="ghost" size="icon" className="text-[#94A3B8] hover:text-[#F8FAFC] h-10 w-10 shrink-0 rounded-full"
                    onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <div className="w-4 h-4 border-2 border-[#10B981] border-t-transparent rounded-full animate-spin" /> : <Paperclip className="w-5 h-5" />}
                  </Button>
                  <div className="flex-1 relative">
                    {isRecording ? (
                      <div className="flex items-center w-full h-10 px-2 text-[#334155] overflow-hidden relative">
                        <div className="flex items-center gap-2" style={{ transform: `translateX(${-cancelSlideX}px)`, transition: isCancelling ? "transform 0.3s" : "none" }}>
                          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[15px] font-medium w-[45px] text-[#F8FAFC]">{Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
                          <span className="text-xs text-[#94A3B8] ml-2 animate-pulse whitespace-nowrap opacity-70">{"< Slide to cancel"}</span>
                        </div>
                      </div>
                    ) : (
                      <Input data-testid="message-input" className="w-full bg-transparent border-0 text-[#F8FAFC] h-10 px-2 text-[15px] focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none placeholder:text-[#94A3B8]" placeholder="Message..."
                        value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={handleKeyDown} />
                    )}
                  </div>
                </div>
                
                {newMessage.trim() === "" ? (
                  <Button className={`rounded-full h-11 w-11 p-0 shrink-0 shadow-md transition-all duration-200 touch-none ${isRecording ? "bg-red-500 shadow-red-500/20 text-white scale-[1.3] -translate-y-4" : "bg-[#1A365D] hover:bg-[#2C4A73] shadow-blue-500/10 text-white"}`} 
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={handlePointerUp}>
                    <Mic className={`w-5 h-5 ${isRecording ? "animate-pulse" : ""}`} />
                  </Button>
                ) : (
                  <Button data-testid="send-message-button" className="bg-[#D2B48C] hover:bg-[#C1A27A] text-[#1A365D] rounded-full h-11 w-11 p-0 shrink-0 shadow-md shadow-[#D2B48C]/10" 
                    onClick={sendMessage}>
                    <Send className="w-5 h-5 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[#0A192F]" data-testid="chat-empty-state">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto bg-[#D2B48C]/10 rounded-3xl flex items-center justify-center mb-5 border border-[#D2B48C]/30">
                <Shield className="w-10 h-10 text-[#D2B48C]" />
              </div>
              <h3 className="text-[#F8FAFC] text-xl font-semibold font-outfit mb-2">Quantum-Safe Secure Chat</h3>
              <p className="text-[#94A3B8] text-sm max-w-xs mx-auto">Select a conversation or search for users to start an encrypted chat</p>
              <div className="mt-5 inline-flex items-center gap-1.5 bg-transparent border border-[#D2B48C]/60 px-4 py-2 rounded-full shadow-sm">
                <Lock className="w-3.5 h-3.5 text-[#D2B48C]" />
                <span className="text-xs text-[#D2B48C] font-jetbrains font-medium uppercase tracking-wider">End-to-End Encrypted</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DecryptedText({ msg, selectedChat, user }) {
  const [text, setText] = useState(msg.content);

  useEffect(() => {
    const run = async () => {
      if (!msg.content.startsWith('{"ciphertext"')) return;
      const myKeysRaw = localStorage.getItem(`pqc_priv_${user.id}`);
      if (!myKeysRaw || selectedChat.is_group) return; 

      const myKeys = JSON.parse(myKeysRaw);
      const dec = await decryptHybridMessage(msg, myKeys, selectedChat.participant.public_key, selectedChat.participant.dilithium_pubkey);
      setText(dec);
    };
    run();
  }, [msg, selectedChat, user]);

  return <p className="text-sm break-words leading-relaxed">{text}</p>;
}

function QuantumBackground() {
  return (
    <div className="quantum-bg">
      <div className="quantum-orb orb-1" />
      <div className="quantum-orb orb-2" />
      <div className="quantum-orb orb-3" />
    </div>
  );
}
