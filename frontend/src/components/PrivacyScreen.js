import { useState, useEffect } from "react";
import { Shield } from "lucide-react";

export default function PrivacyScreen() {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const handleHide = () => setIsHidden(true);
    const handleShow = () => setIsHidden(false);

    // 1. Standard Web APIs for when app loses focus
    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === "hidden") {
        handleHide();
      } else {
        handleShow();
      }
    };

    // 2. Aggressive Keyboard Hacks for Windows (Alt+Tab / Win+Tab)
    // We blank the screen the millisecond the user presses Alt or the Windows key, 
    // BEFORE Windows has a chance to take the screenshot!
    const handleKeyDown = (e) => {
      if (e.key === "Alt" || e.key === "Meta" || e.key === "OS") {
        handleHide();
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === "Alt" || e.key === "Meta" || e.key === "OS") {
        handleShow();
      }
    };

    // Hook up all aggressive listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleHide);
    window.addEventListener("focus", handleShow);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    // Mouse leaving the exact boundary of the website
    document.documentElement.addEventListener("mouseleave", handleHide);
    document.documentElement.addEventListener("mouseenter", handleShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleHide);
      window.removeEventListener("focus", handleShow);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.documentElement.removeEventListener("mouseleave", handleHide);
      document.documentElement.removeEventListener("mouseenter", handleShow);
    };
  }, []);

  if (!isHidden) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-[#06090D] flex flex-col items-center justify-center">
      <div className="w-24 h-24 bg-[#10B981]/10 rounded-3xl flex items-center justify-center mb-6 border border-[#10B981]/20">
        <Shield className="w-12 h-12 text-[#10B981]" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-white mb-2 font-outfit">TRUNEX</h1>
      <p className="text-[#94A3B8] text-sm font-medium">Secured Web View</p>
    </div>
  );
}
