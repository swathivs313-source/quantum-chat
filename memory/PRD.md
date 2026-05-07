# Quantum-Safe Secure Chat System - PRD

## Original Problem Statement
Build a production-ready full-stack web app "Quantum-Safe Secure Chat System" with JWT+MFA auth, post-quantum crypto simulation (AES-256+X25519), real-time encrypted chat, admin dashboard, group chat, file sharing, and Redis-based OTP/presence.

## Architecture
- **Frontend**: React.js + Tailwind CSS + Shadcn UI
- **Backend**: FastAPI (async) + WebSocket
- **Database**: MongoDB (Motor async)
- **Auth**: JWT + httpOnly cookies + bcrypt + OTP (Twilio SMS / Gmail SMTP / demo fallback)
- **Crypto**: X25519 key exchange + AES-256-GCM (1:1), AES-256-GCM symmetric key (groups)
- **Storage**: Emergent Object Storage for file uploads
- **Real-time**: Native WebSocket with group broadcast support
- **Cache**: In-memory Redis store (TTL support) for OTP + presence

## Implemented Features (April 16, 2026)
### Phase 1 (MVP)
- [x] JWT auth with MFA OTP verification
- [x] X25519 + AES-256-GCM message encryption
- [x] Real-time WebSocket messaging
- [x] WhatsApp-like chat UI (dark cybersecurity theme)
- [x] Admin dashboard with monitoring
- [x] Message status (sent/delivered)
- [x] Online/offline presence tracking
- [x] Brute force protection

### Phase 2 (Current)
- [x] Real Twilio SMS OTP with fallback chain (SMS → Email → Demo)
- [x] Gmail SMTP email OTP delivery
- [x] Group chat (max 50 members, admin roles, member management)
- [x] File sharing via Emergent Object Storage (25MB max)
- [x] File/image message types in chat
- [x] Read receipts with per-user tracking
- [x] In-memory Redis for OTP storage with TTL
- [x] Redis-based presence tracking
- [x] Group message encryption (AES-256 symmetric key)
- [x] WebSocket group broadcast

## Test Credentials
- Admin: admin@quantumsafe.chat / Admin@123
- Demo: alice@example.com / test123, bob@example.com / test123, charlie@example.com / test123

## Backlog
### P1
- True client-side E2EE (Web Crypto API in browser)
- Redis server integration (replace in-memory)
- Password reset flow

### P2
- Voice/video calling
- Message search
- User blocking
- Profile management
