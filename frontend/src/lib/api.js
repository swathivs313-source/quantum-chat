import axios from "axios";

// Detect if running inside Capacitor (native mobile app)
const isCapacitor = typeof window !== "undefined" && (window.Capacitor || window.location.protocol === "capacitor:");
const BACKEND_BASE = process.env.REACT_APP_BACKEND_URL || "https://quantum-chat-api-b11e.onrender.com";

const api = axios.create({
  baseURL: BACKEND_BASE,
  headers: { "Content-Type": "application/json" },
});

// Add a request interceptor to attach the Bearer token from localStorage
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Let Axios handle boundaries for file uploads natively
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
    }
    // Bypass ngrok browser warning
    config.headers["ngrok-skip-browser-warning"] = "true";
    return config;
  },
  (error) => Promise.reject(error)
);


export function handleApiError(err) {
  // 1. Backend validation or explicit rejection
  const detail = err?.response?.data?.detail;
  if (detail) {
    let msg = "";
    if (typeof detail === "string") {
      msg = detail;
    } else if (Array.isArray(detail)) {
      msg = detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
    } else if (typeof detail.msg === "string") {
      msg = detail.msg;
    } else {
      msg = String(detail);
    }
    
    // Friendly mappings for backend errors
    const msgLower = msg.toLowerCase();
    if (msgLower.includes("value is not a valid email address")) {
      return "Invalid email address format. Please enter a valid email (e.g. name@domain.com)";
    }
    if (msgLower.includes("email already registered")) {
      return "This account is already registered! Please go back and sign in.";
    }
    if (msgLower.includes("phone number already registered")) {
      return "This phone number is already registered! Please go back and sign in.";
    }
    if (msgLower.includes("invalid email or password") || msgLower.includes("incorrect email or password")) {
      return "The password entered is incorrect or the account was not found. Please try again.";
    }
    return msg;
  }
  
  // 2. Client-side or Network errors
  if (err?.message) {
    const msgLower = err.message.toLowerCase();
    if (msgLower.includes("network error") || msgLower.includes("cors")) {
      return "Connection failed. Please check your internet connection or try refreshing.";
    }
    if (msgLower.includes("crypto") || msgLower.includes("getrandomvalues") || msgLower.includes("subtle")) {
      return "Your browser does not support secure registration. Please open this link securely (HTTPS) or use a modern browser.";
    }
    if (msgLower.includes("password entered is incorrect") || msgLower.includes("wrong password")) {
       return "Incorrect password. Please try again.";
    }
    return `Error: ${err.message}`;
  }

  return "Something went wrong. Please try again.";
}

export default api;
