from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env', override=True)

import os
# Log environment state for debugging
print(f"DEBUG: APP_START - SMTP_EMAIL: {os.environ.get('SMTP_EMAIL')}")
print(f"DEBUG: APP_START - SMTP_PASSWORD length: {len(os.environ.get('SMTP_PASSWORD', ''))}")

import logging
import uuid
import secrets
import base64
import random
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict

import bcrypt
import jwt
from fastapi import (
    FastAPI, APIRouter, HTTPException, Request, Response,
    WebSocket, WebSocketDisconnect, Query, UploadFile, File, Header, Depends
)
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
import io
import json as json_mod
from otp_service import deliver_otp
from storage_service import init_storage as init_obj_storage, put_object, get_object, generate_storage_path
from redis_store import redis_store
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from bson import ObjectId

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

# ── CONFIG ────────────────────────────────────────────────────────────────────
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE = 60
REFRESH_TOKEN_EXPIRE = 7
OTP_EXPIRY_MINUTES = 5
MAX_OTP_RETRIES = 3
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

# ── MONGODB ───────────────────────────────────────────────────────────────────
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ── APP ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Trunex", version="1.0.0", redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api", redirect_slashes=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ── WEBSOCKET MANAGER ────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        await redis_store.sadd("online_users", user_id)
        await self.broadcast_presence(user_id, "online")

    async def disconnect(self, user_id: str):
        self.active_connections.pop(user_id, None)
        await redis_store.srem("online_users", user_id)
        await self.broadcast_presence(user_id, "offline")

    async def send_to_user(self, user_id: str, data: dict) -> bool:
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
                return True
            except Exception:
                self.active_connections.pop(user_id, None)
        return False

    async def broadcast_presence(self, user_id: str, status: str):
        for uid, ws in list(self.active_connections.items()):
            if uid != user_id:
                try:
                    await ws.send_json({"type": "presence", "user_id": user_id, "status": status})
                except Exception:
                    pass

    async def broadcast_to_chat(self, participants: List[str], data: dict, exclude: str = None):
        for uid in participants:
            if uid != exclude:
                await self.send_to_user(uid, data)

    def get_online_users(self) -> List[str]:
        return list(self.active_connections.keys())


manager = ConnectionManager()


# ── AUTH UTILITIES ────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str, role: str = "user") -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE),
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE),
        "type": "refresh"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user["_id"])
        del user["_id"]
        user.pop("password_hash", None)
        user.pop("encrypted_private_key", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── CRYPTO UTILITIES ─────────────────────────────────────────────────────────
def generate_x25519_keypair():
    private_key = X25519PrivateKey.generate()
    public_key = private_key.public_key()
    priv_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption()
    )
    pub_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )
    return base64.b64encode(priv_bytes).decode(), base64.b64encode(pub_bytes).decode()


def encrypt_private_key(private_key_b64: str) -> str:
    key = HKDF(algorithm=hashes.SHA256(), length=32,
               salt=b"quantum-safe-chat", info=b"key-storage").derive(JWT_SECRET.encode())
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    encrypted = aesgcm.encrypt(nonce, private_key_b64.encode(), None)
    return base64.b64encode(nonce + encrypted).decode()


def decrypt_private_key(encrypted_key: str) -> str:
    key = HKDF(algorithm=hashes.SHA256(), length=32,
               salt=b"quantum-safe-chat", info=b"key-storage").derive(JWT_SECRET.encode())
    data = base64.b64decode(encrypted_key)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(data[:12], data[12:], None).decode()


def derive_shared_secret(private_key_b64: str, peer_public_key_b64: str) -> bytes:
    private_key = X25519PrivateKey.from_private_bytes(base64.b64decode(private_key_b64))
    public_key = X25519PublicKey.from_public_bytes(base64.b64decode(peer_public_key_b64))
    return private_key.exchange(public_key)


def encrypt_message(plaintext: str, shared_secret: bytes) -> dict:
    key = HKDF(algorithm=hashes.SHA256(), length=32,
               salt=b"quantum-safe-msg", info=b"message").derive(shared_secret)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    encrypted = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return {"ciphertext": base64.b64encode(encrypted).decode(), "nonce": base64.b64encode(nonce).decode()}


def decrypt_message(encrypted_data: dict, shared_secret: bytes) -> str:
    key = HKDF(algorithm=hashes.SHA256(), length=32,
               salt=b"quantum-safe-msg", info=b"message").derive(shared_secret)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(
        base64.b64decode(encrypted_data["nonce"]),
        base64.b64decode(encrypted_data["ciphertext"]),
        None
    ).decode()


def generate_otp() -> str:
    return str(random.randint(100000, 999999))


def generate_group_key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def encrypt_group_message(plaintext: str, group_key_b64: str) -> dict:
    group_key = base64.b64decode(group_key_b64)
    aesgcm = AESGCM(group_key)
    nonce = os.urandom(12)
    encrypted = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return {"ciphertext": base64.b64encode(encrypted).decode(), "nonce": base64.b64encode(nonce).decode()}


def decrypt_group_message(encrypted_data: dict, group_key_b64: str) -> str:
    group_key = base64.b64decode(group_key_b64)
    aesgcm = AESGCM(group_key)
    return aesgcm.decrypt(
        base64.b64decode(encrypted_data["nonce"]),
        base64.b64decode(encrypted_data["ciphertext"]),
        None
    ).decode()


# ── PYDANTIC MODELS ──────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    phone_number: str
    password: str
    public_key: str
    kyber_pubkey: Optional[str] = ""
    dilithium_pubkey: Optional[str] = ""

class VaultInitRequest(BaseModel):
    wrapped_key: str
    salt: str
    iterations: int

class VaultItemCreate(BaseModel):
    type: str # 'file' or 'note'
    encrypted_metadata: str # Base64 of encrypted JSON {name, size, type}
    encrypted_blob_id: Optional[str] = None
    note_content: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class VerifyOTPRequest(BaseModel):
    user_id: str
    otp_code: str


class CreateChatRequest(BaseModel):
    participant_id: str


class SendMessageRequest(BaseModel):
    chat_id: str
    content: str
    message_type: str = "text"
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    file_duration: Optional[int] = None
    signature: Optional[str] = None
    dilithium_signature: Optional[str] = None


class CreateGroupRequest(BaseModel):
    name: str
    member_ids: List[str]


class UpdateGroupMembersRequest(BaseModel):
    action: str
    user_ids: List[str]


# ── AUTH ROUTES ───────────────────────────────────────────────────────────────
@api_router.post("/auth/register")
async def register(req: RegisterRequest):
    email = req.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    existing_phone = await db.users.find_one({"phone_number": req.phone_number})
    if existing_phone:
        raise HTTPException(status_code=400, detail="Phone number already registered")

    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    private_key_b64, public_key_b64 = generate_x25519_keypair()
    encrypted_private = encrypt_private_key(private_key_b64)

    user_doc = {
        "name": req.name,
        "email": email,
        "phone_number": req.phone_number,
        "password_hash": hash_password(req.password),
        "is_verified": False,
        "role": "user",
        "avatar_color": f"#{secrets.token_hex(3)}",
        "public_key": req.public_key,
        "kyber_pubkey": req.kyber_pubkey,
        "dilithium_pubkey": req.dilithium_pubkey,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)

    otp_code = generate_otp()
    await redis_store.setex(f"otp:{user_id}", OTP_EXPIRY_MINUTES * 60,
                            json_mod.dumps({"code": otp_code, "type": "registration", "retries": 0}))

    delivery = deliver_otp(req.phone_number, email, otp_code)
    logger.info(f"Registration OTP for {email}: method={delivery.get('method')}, code={otp_code}")

    result = {"user_id": user_id, "message": "Registration successful. Please verify OTP.", "otp_method": delivery.get("method", "demo")}
    if delivery.get("demo_otp"):
        result["demo_otp"] = delivery["demo_otp"]
    return result


@api_router.post("/auth/verify-otp")
async def verify_otp(req: VerifyOTPRequest, response: Response):
    otp_raw = await redis_store.get(f"otp:{req.user_id}")
    if not otp_raw:
        raise HTTPException(status_code=400, detail="No pending OTP found or OTP expired")
    otp_info = json_mod.loads(otp_raw)
    if otp_info.get("retries", 0) >= MAX_OTP_RETRIES:
        await redis_store.delete(f"otp:{req.user_id}")
        raise HTTPException(status_code=429, detail="Too many OTP attempts. Request a new one.")
    if otp_info["code"] != req.otp_code:
        otp_info["retries"] = otp_info.get("retries", 0) + 1
        await redis_store.set(f"otp:{req.user_id}", json_mod.dumps(otp_info), ex=OTP_EXPIRY_MINUTES * 60)
        raise HTTPException(status_code=400, detail="Invalid OTP")
    await redis_store.delete(f"otp:{req.user_id}")
    await db.users.update_one({"_id": ObjectId(req.user_id)}, {"$set": {"is_verified": True}})

    user = await db.users.find_one({"_id": ObjectId(req.user_id)})
    user_id = str(user["_id"])

    access_token = create_access_token(user_id, user["email"], user.get("role", "user"))
    refresh_token = create_refresh_token(user_id)

    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE * 60, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=REFRESH_TOKEN_EXPIRE * 86400, path="/")

    await db.login_logs.insert_one({
        "user_id": user_id, "email": user["email"],
        "action": "register_verify", "timestamp": datetime.now(timezone.utc).isoformat(), "success": True,
    })

    return {
        "user": {
            "id": user_id, "name": user["name"], "email": user["email"],
            "phone_number": user.get("phone_number", ""), "role": user.get("role", "user"),
            "is_verified": True, "avatar_color": user.get("avatar_color", "#10B981"),
            "public_key": user.get("public_key", ""),
            "kyber_pubkey": user.get("kyber_pubkey", ""),
            "dilithium_pubkey": user.get("dilithium_pubkey", ""),
        },
        "access_token": access_token,
    }


@api_router.post("/auth/login")
async def login(req: LoginRequest, request: Request):
    email = req.email.lower()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"

    attempts = await db.login_attempts.find_one({"identifier": identifier})
    if attempts and attempts.get("count", 0) >= MAX_LOGIN_ATTEMPTS:
        locked_at = datetime.fromisoformat(attempts["locked_at"])
        if datetime.now(timezone.utc) < locked_at + timedelta(minutes=LOCKOUT_MINUTES):
            raise HTTPException(status_code=429, detail=f"Account locked. Try again in {LOCKOUT_MINUTES} minutes.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"locked_at": datetime.now(timezone.utc).isoformat()},
             "$setOnInsert": {"identifier": identifier}},
            upsert=True
        )
        await db.login_logs.insert_one({
            "email": email, "action": "login_failed",
            "timestamp": datetime.now(timezone.utc).isoformat(), "success": False, "ip": ip,
        })
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id = str(user["_id"])
    otp_code = generate_otp()
    await redis_store.setex(f"otp:{user_id}", OTP_EXPIRY_MINUTES * 60,
                            json_mod.dumps({"code": otp_code, "type": "login", "retries": 0}))

    phone = user.get("phone_number", "")
    delivery = deliver_otp(phone, email, otp_code)
    logger.info(f"Login OTP for {email}: method={delivery.get('method')}, code={otp_code}")

    result = {"user_id": user_id, "message": "Credentials verified. Please enter OTP.",
              "otp_method": delivery.get("method", "demo")}
    if delivery.get("demo_otp"):
        result["demo_otp"] = delivery["demo_otp"]
    return result


@api_router.post("/auth/verify-login-otp")
async def verify_login_otp(req: VerifyOTPRequest, request: Request, response: Response):
    otp_raw = await redis_store.get(f"otp:{req.user_id}")
    if not otp_raw:
        raise HTTPException(status_code=400, detail="No pending OTP found or OTP expired")
    otp_info = json_mod.loads(otp_raw)
    if otp_info.get("retries", 0) >= MAX_OTP_RETRIES:
        await redis_store.delete(f"otp:{req.user_id}")
        raise HTTPException(status_code=429, detail="Too many OTP attempts")
    if otp_info["code"] != req.otp_code:
        otp_info["retries"] = otp_info.get("retries", 0) + 1
        await redis_store.set(f"otp:{req.user_id}", json_mod.dumps(otp_info), ex=OTP_EXPIRY_MINUTES * 60)
        raise HTTPException(status_code=400, detail="Invalid OTP")
    await redis_store.delete(f"otp:{req.user_id}")

    user = await db.users.find_one({"_id": ObjectId(req.user_id)})
    user_id = str(user["_id"])

    ip = request.client.host if request.client else "unknown"
    await db.login_attempts.delete_one({"identifier": f"{ip}:{user['email']}"})

    access_token = create_access_token(user_id, user["email"], user.get("role", "user"))
    refresh_token = create_refresh_token(user_id)

    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE * 60, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=REFRESH_TOKEN_EXPIRE * 86400, path="/")

    await db.login_logs.insert_one({
        "user_id": user_id, "email": user["email"],
        "action": "login_success", "timestamp": datetime.now(timezone.utc).isoformat(),
        "success": True, "ip": ip,
    })

    return {
        "user": {
            "id": user_id, "name": user["name"], "email": user["email"],
            "phone_number": user.get("phone_number", ""), "role": user.get("role", "user"),
            "is_verified": user.get("is_verified", False), "avatar_color": user.get("avatar_color", "#10B981"),
            "public_key": user.get("public_key", ""),
            "kyber_pubkey": user.get("kyber_pubkey", ""),
            "dilithium_pubkey": user.get("dilithium_pubkey", ""),
        },
        "access_token": access_token,
    }


@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    access_token = create_access_token(user["id"], user["email"], user.get("role", "user"))
    return {"user": user, "access_token": access_token}


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}


@api_router.post("/auth/refresh")
async def refresh_token_route(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user_id = str(user["_id"])
        access_token = create_access_token(user_id, user["email"], user.get("role", "user"))
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE * 60, path="/")
        return {"access_token": access_token}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


# ── USER ROUTES ───────────────────────────────────────────────────────────────
@api_router.get("/users/search")
async def search_users(request: Request, q: str = Query("", min_length=0)):
    current_user = await get_current_user(request)
    print(f"DEBUG: Search request from {current_user['email']} with query: '{q}'")
    query = {}
    if q:
        query = {"$or": [
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]}

    users = await db.users.find(
        query,
        {"password_hash": 0, "encrypted_private_key": 0}
    ).to_list(100)
    
    print(f"DEBUG: Found {len(users)} matching users in DB")

    online_users = set(manager.get_online_users())
    result = []
    for u in users:
        uid = str(u["_id"])
        result.append({
            "id": uid, "name": u.get("name", ""), "email": u.get("email", ""),
            "phone_number": u.get("phone_number", ""),
            "is_online": uid in online_users,
            "avatar_color": u.get("avatar_color", "#10B981"),
            "public_key": u.get("public_key", ""),
            "kyber_pubkey": u.get("kyber_pubkey", ""),
            "dilithium_pubkey": u.get("dilithium_pubkey", ""),
        })
    return {"users": result}


@api_router.get("/users/online")
async def get_online_users(request: Request):
    await get_current_user(request)
    return {"online_users": manager.get_online_users()}


# ── CHAT ROUTES ───────────────────────────────────────────────────────────────
@api_router.get("/chats")
async def get_chats(request: Request):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    chats = await db.chats.find({"participants": user_id}).sort("last_message_at", -1).to_list(100)
    online_users = set(manager.get_online_users())
    result = []
    for chat in chats:
        chat_id = str(chat["_id"])
        is_group = chat.get("is_group", False)
        if is_group:
            result.append({
                "id": chat_id, "is_group": True,
                "group_name": chat.get("group_name", "Group"),
                "group_admin": chat.get("group_admin", ""),
                "participant_count": len(chat.get("participants", [])),
                "participants": chat.get("participants", []),
                "last_message": chat.get("last_message", ""),
                "last_message_at": chat.get("last_message_at", ""),
                "unread_count": chat.get(f"unread_{user_id}", 0),
            })
        else:
            other_id = [p for p in chat["participants"] if p != user_id]
            other_id = other_id[0] if other_id else user_id
            other_user = await db.users.find_one({"_id": ObjectId(other_id)})
            result.append({
                "id": chat_id, "is_group": False,
                "participant": {
                    "id": other_id,
                    "name": other_user.get("name", "Unknown") if other_user else "Unknown",
                    "email": other_user.get("email", "") if other_user else "",
                    "is_online": other_id in online_users,
                    "avatar_color": other_user.get("avatar_color", "#10B981") if other_user else "#10B981",
                    "public_key": other_user.get("public_key", "") if other_user else "",
                    "kyber_pubkey": other_user.get("kyber_pubkey", "") if other_user else "",
                    "dilithium_pubkey": other_user.get("dilithium_pubkey", "") if other_user else "",
                },
                "last_message": chat.get("last_message", ""),
                "last_message_at": chat.get("last_message_at", ""),
                "unread_count": chat.get(f"unread_{user_id}", 0),
            })
    return {"chats": result}


@api_router.post("/chats")
async def create_chat(req: CreateChatRequest, request: Request):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    existing = await db.chats.find_one({
        "is_group": {"$ne": True},
        "participants": {"$all": [user_id, req.participant_id], "$size": 2}
    })
    if existing:
        chat_id = str(existing["_id"])
    else:
        chat_doc = {
            "participants": [user_id, req.participant_id], "is_group": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_message": "", "last_message_at": datetime.now(timezone.utc).isoformat(),
        }
        r = await db.chats.insert_one(chat_doc)
        chat_id = str(r.inserted_id)
    other_user = await db.users.find_one({"_id": ObjectId(req.participant_id)})
    online_users = set(manager.get_online_users())
    return {
        "chat": {
            "id": chat_id, "is_group": False,
            "participant": {
                "id": req.participant_id,
                "name": other_user.get("name", "Unknown") if other_user else "Unknown",
                "email": other_user.get("email", "") if other_user else "",
                "is_online": req.participant_id in online_users,
                "avatar_color": other_user.get("avatar_color", "#10B981") if other_user else "#10B981",
            },
            "last_message": "", "last_message_at": "", "unread_count": 0,
        }
    }


# ── GROUP CHAT ROUTES ─────────────────────────────────────────────────────────
@api_router.post("/groups")
async def create_group(req: CreateGroupRequest, request: Request):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    if len(req.member_ids) > 49:
        raise HTTPException(status_code=400, detail="Group max 50 members")
    all_members = list(set([user_id] + req.member_ids))
    group_key = generate_group_key()
    encrypted_gk = encrypt_private_key(group_key)
    chat_doc = {
        "is_group": True, "group_name": req.name, "group_admin": user_id,
        "participants": all_members, "encrypted_group_key": encrypted_gk,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_message": "", "last_message_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.chats.insert_one(chat_doc)
    chat_id = str(r.inserted_id)
    for mid in all_members:
        if mid != user_id:
            await manager.send_to_user(mid, {"type": "group_created", "data": {"chat_id": chat_id, "group_name": req.name}})
    return {"chat": {"id": chat_id, "is_group": True, "group_name": req.name,
                      "group_admin": user_id, "participant_count": len(all_members),
                      "participants": all_members, "last_message": "", "last_message_at": "", "unread_count": 0}}


@api_router.get("/groups/{chat_id}/members")
async def get_group_members(chat_id: str, request: Request):
    current_user = await get_current_user(request)
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "is_group": True})
    if not chat or current_user["id"] not in chat.get("participants", []):
        raise HTTPException(status_code=403, detail="Access denied")
    members = []
    online_users = set(manager.get_online_users())
    for mid in chat["participants"]:
        u = await db.users.find_one({"_id": ObjectId(mid)}, {"password_hash": 0, "encrypted_private_key": 0})
        if u:
            members.append({"id": str(u["_id"]), "name": u.get("name", ""), "email": u.get("email", ""),
                            "is_online": mid in online_users, "avatar_color": u.get("avatar_color", "#10B981"),
                            "is_admin": mid == chat.get("group_admin")})
    return {"members": members, "group_admin": chat.get("group_admin")}


@api_router.put("/groups/{chat_id}/members")
async def update_group_members(chat_id: str, req: UpdateGroupMembersRequest, request: Request):
    current_user = await get_current_user(request)
    chat = await db.chats.find_one({"_id": ObjectId(chat_id), "is_group": True})
    if not chat:
        raise HTTPException(status_code=404, detail="Group not found")
    if chat.get("group_admin") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Only group admin can manage members")
    if req.action == "add":
        new_members = [uid for uid in req.user_ids if uid not in chat["participants"]]
        if len(chat["participants"]) + len(new_members) > 50:
            raise HTTPException(status_code=400, detail="Group max 50 members")
        await db.chats.update_one({"_id": ObjectId(chat_id)}, {"$addToSet": {"participants": {"$each": new_members}}})
        for mid in new_members:
            await manager.send_to_user(mid, {"type": "group_created", "data": {"chat_id": chat_id, "group_name": chat.get("group_name")}})
    elif req.action == "remove":
        remove_ids = [uid for uid in req.user_ids if uid != chat.get("group_admin")]
        await db.chats.update_one({"_id": ObjectId(chat_id)}, {"$pull": {"participants": {"$in": remove_ids}}})
    return {"message": "Members updated"}


# ── FILE ROUTES ───────────────────────────────────────────────────────────────
@api_router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    max_size = 25 * 1024 * 1024
    data = await file.read()
    if len(data) > max_size:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    path = generate_storage_path(user_id, file.filename)
    try:
        result = put_object(path, data, file.content_type or "application/octet-stream")
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail="File upload failed")
    file_doc = {
        "storage_path": result["path"], "original_filename": file.filename,
        "content_type": file.content_type, "size": len(data),
        "uploader_id": user_id, "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.files.insert_one(file_doc)
    return {"file_id": str(r.inserted_id), "path": result["path"],
            "filename": file.filename, "content_type": file.content_type, "size": len(data)}


@api_router.get("/files/{file_id}")
async def download_file(file_id: str, request: Request, auth: str = Query(None)):
    token = None
    if auth:
        token = auth
    else:
        token = request.cookies.get("access_token")
        if not token:
            ah = request.headers.get("Authorization", "")
            if ah.startswith("Bearer "):
                token = ah[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    record = await db.files.find_one({"_id": ObjectId(file_id), "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, ct = get_object(record["storage_path"])
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail="File download failed")
    return Response(content=data, media_type=record.get("content_type", ct),
                    headers={"Content-Disposition": f'inline; filename="{record.get("original_filename", "file")}"'})


@api_router.get("/chats/{chat_id}/messages")
async def get_messages(chat_id: str, request: Request):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    chat = await db.chats.find_one({"_id": ObjectId(chat_id)})
    if not chat or user_id not in chat.get("participants", []):
        raise HTTPException(status_code=403, detail="Access denied")
    is_group = chat.get("is_group", False)
    messages = await db.messages.find({"chat_id": chat_id}).sort("timestamp", 1).to_list(200)
    result = []
    for msg in messages:
        if user_id in msg.get("deleted_for", []):
            continue
        content = ""
        msg_type = msg.get("message_type", "text")
        if msg_type == "text" and "encrypted_data" in msg:
            try:
                if is_group:
                    gk = decrypt_private_key(chat["encrypted_group_key"])
                    content = decrypt_group_message(msg["encrypted_data"], gk)
                else:
                    other_id = [p for p in chat["participants"] if p != user_id]
                    other_id = other_id[0] if other_id else user_id
                    other_user = await db.users.find_one({"_id": ObjectId(other_id)})
                    cu_full = await db.users.find_one({"_id": ObjectId(user_id)})
                    pk = decrypt_private_key(cu_full["encrypted_private_key"])
                    ss = derive_shared_secret(pk, other_user["public_key"])
                    content = decrypt_message(msg["encrypted_data"], ss)
            except Exception as e:
                logger.error(f"Decrypt failed: {e}")
                content = "[Decryption failed]"
        elif msg_type in ("file", "image", "audio"):
            content = msg.get("file_name", "Voice Message" if msg_type == "audio" else "File")
        entry = {
            "id": str(msg["_id"]), "chat_id": msg["chat_id"], "sender_id": msg["sender_id"],
            "sender_name": msg.get("sender_name", ""), "content": content,
            "message_type": msg_type, "status": msg.get("status", "sent"),
            "read_by": msg.get("read_by", []), "played_by": msg.get("played_by", []), "timestamp": msg.get("timestamp", ""), "encrypted": True,
        }
        if msg_type in ("file", "image", "audio"):
            entry.update({"file_id": msg.get("file_id"), "file_name": msg.get("file_name"),
                          "file_type": msg.get("file_type"), "file_size": msg.get("file_size"),
                          "file_duration": msg.get("file_duration")})
        result.append(entry)
    await db.messages.update_many(
        {"chat_id": chat_id, "sender_id": {"$ne": user_id}, "status": {"$ne": "read"}},
        {"$set": {"status": "delivered"}, "$addToSet": {"read_by": user_id}}
    )
    await db.chats.update_one({"_id": ObjectId(chat_id)}, {"$set": {f"unread_{user_id}": 0}})
    return {"messages": result}


@api_router.post("/messages")
async def send_message(req: SendMessageRequest, request: Request):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    chat = await db.chats.find_one({"_id": ObjectId(req.chat_id)})
    if not chat or user_id not in chat.get("participants", []):
        raise HTTPException(status_code=403, detail="Access denied")
    is_group = chat.get("is_group", False)
    timestamp = datetime.now(timezone.utc).isoformat()
    msg_doc = {"chat_id": req.chat_id, "sender_id": user_id, "sender_name": current_user.get("name", ""),
               "message_type": req.message_type, "status": "sent", "read_by": [user_id], "timestamp": timestamp}
    
    # Store client-side PQC signatures
    if req.signature: msg_doc["signature"] = req.signature
    if req.dilithium_signature: msg_doc["dilithium_signature"] = req.dilithium_signature

    if req.message_type == "text":
        # Check if the client already sent encrypted data (Frontend E2EE)
        # If content starts with {"ciphertext": ..., "nonce": ...}, it's already encrypted
        try:
            potential_json = json_mod.loads(req.content)
            if isinstance(potential_json, dict) and "ciphertext" in potential_json:
                msg_doc["encrypted_data"] = potential_json
            else:
                # Fallback to server-side encryption for legacy/non-updated clients
                if is_group:
                    gk = decrypt_private_key(chat["encrypted_group_key"])
                    encrypted_data = encrypt_group_message(req.content, gk)
                else:
                    other_id = [p for p in chat["participants"] if p != user_id][0]
                    other_user = await db.users.find_one({"_id": ObjectId(other_id)})
                    cu_full = await db.users.find_one({"_id": ObjectId(user_id)})
                    pk = decrypt_private_key(cu_full["encrypted_private_key"])
                    ss = derive_shared_secret(pk, other_user["public_key"])
                    encrypted_data = encrypt_message(req.content, ss)
                msg_doc["encrypted_data"] = encrypted_data
        except (json_mod.JSONDecodeError, TypeError, KeyError):
            # Same fallback
            if is_group:
                gk = decrypt_private_key(chat["encrypted_group_key"])
                encrypted_data = encrypt_group_message(req.content, gk)
            else:
                other_id = [p for p in chat["participants"] if p != user_id][0]
                other_user = await db.users.find_one({"_id": ObjectId(other_id)})
                cu_full = await db.users.find_one({"_id": ObjectId(user_id)})
                pk = decrypt_private_key(cu_full["encrypted_private_key"])
                ss = derive_shared_secret(pk, other_user["public_key"])
                encrypted_data = encrypt_message(req.content, ss)
            msg_doc["encrypted_data"] = encrypted_data
    elif req.message_type in ("file", "image", "audio"):
        msg_doc.update({"file_id": req.file_id, "file_name": req.file_name,
                        "file_type": req.file_type, "file_size": req.file_size,
                        "file_duration": req.file_duration})
    r = await db.messages.insert_one(msg_doc)
    msg_id = str(r.inserted_id)
    display_content = req.content if req.message_type == "text" else (req.file_name or "Voice Message" if req.message_type == "audio" else "File")
    await db.chats.update_one(
        {"_id": ObjectId(req.chat_id)},
        {"$set": {"last_message": display_content[:50], "last_message_at": timestamp},
         **{"$inc": {f"unread_{p}": 1 for p in chat["participants"] if p != user_id}}}
    )
    ws_data = {
        "type": "message", "data": {
            "id": msg_id, "chat_id": req.chat_id, "sender_id": user_id,
            "sender_name": current_user.get("name", ""), "content": display_content,
            "message_type": req.message_type, "status": "sent", "read_by": [user_id],
            "timestamp": timestamp, "encrypted": True,
        }
    }
    if req.message_type in ("file", "image", "audio"):
        ws_data["data"].update({"file_id": req.file_id, "file_name": req.file_name,
                                "file_type": req.file_type, "file_size": req.file_size,
                                "file_duration": req.file_duration})
    recipients = [p for p in chat["participants"] if p != user_id]
    delivered_to_any = False
    for rid in recipients:
        if await manager.send_to_user(rid, ws_data):
            delivered_to_any = True
    if delivered_to_any:
        await db.messages.update_one({"_id": r.inserted_id}, {"$set": {"status": "delivered"}})
        await manager.send_to_user(user_id, {"type": "status_update", "data": {"message_id": msg_id, "status": "delivered"}})
    return {"message": {**ws_data["data"], "status": "delivered" if delivered_to_any else "sent"}}


@api_router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    current_user = await get_current_user(request)
    file_bytes = await file.read()
    storage_path = generate_storage_path(current_user["id"], file.filename)
    
    try:
        put_object(storage_path, file_bytes, file.content_type)
        has_remote = True
    except Exception as e:
        logger.warning(f"Object storage failed, falling back to local DB: {e}")
        has_remote = False

    doc = {
        "filename": file.filename,
        "content_type": file.content_type,
        "size": len(file_bytes),
        "uploader_id": current_user["id"],
        "storage_path": storage_path,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    if not has_remote:
        doc["data"] = file_bytes

    r = await db.files.insert_one(doc)
    return {"file_id": str(r.inserted_id), "filename": file.filename}


@api_router.get("/files/{file_id}")
async def get_file(file_id: str, auth: str = Query(None)):
    if not auth:
        raise HTTPException(status_code=401, detail="Missing auth token")
    try:
        payload = jwt.decode(auth, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    f = await db.files.find_one({"_id": ObjectId(file_id)})
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
        
    try:
        data, ctype = get_object(f["storage_path"])
        return Response(content=data, media_type=ctype)
    except Exception:
        if "data" in f:
            return Response(content=f["data"], media_type=f["content_type"])
        raise HTTPException(status_code=500, detail="File could not be retrieved")


@api_router.delete("/messages/{msg_id}")
async def delete_message(msg_id: str, request: Request, for_everyone: bool = False):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    msg = await db.messages.find_one({"_id": ObjectId(msg_id)})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    chat = await db.chats.find_one({"_id": ObjectId(msg["chat_id"])})
    if not chat or user_id not in chat.get("participants", []):
        raise HTTPException(status_code=403, detail="Access denied")

    if for_everyone:
        if msg["sender_id"] != user_id:
            raise HTTPException(status_code=403, detail="Only the sender can delete for everyone")
        await db.messages.delete_one({"_id": ObjectId(msg_id)})
        recipients = [p for p in chat["participants"]]
        for rid in recipients:
            await manager.send_to_user(rid, {"type": "message_deleted", "data": {"message_id": msg_id, "chat_id": msg["chat_id"]}})
    else:
        await db.messages.update_one({"_id": ObjectId(msg_id)}, {"$addToSet": {"deleted_for": user_id}})
        await manager.send_to_user(user_id, {"type": "message_deleted", "data": {"message_id": msg_id, "chat_id": msg["chat_id"]}})

    return {"status": "Message deleted"}


@api_router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, request: Request):
    current_user = await get_current_user(request)
    user_id = current_user["id"]
    chat = await db.chats.find_one({"_id": ObjectId(chat_id)})
    if not chat or user_id not in chat.get("participants", []):
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Completely wipe the chat history
    await db.messages.delete_many({"chat_id": chat_id})
    await db.chats.delete_one({"_id": ObjectId(chat_id)})
    
    recipients = [p for p in chat["participants"]]
    for rid in recipients:
        await manager.send_to_user(rid, {"type": "chat_deleted", "data": {"chat_id": chat_id}})

    return {"status": "Chat completely deleted"}


# ── ADMIN ROUTES ──────────────────────────────────────────────────────────────
@api_router.get("/admin/stats")
async def admin_stats(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    total_users = await db.users.count_documents({})
    online_count = len(manager.get_online_users())
    total_messages = await db.messages.count_documents({})
    failed_logins = await db.login_logs.count_documents({"success": False})

    yesterday = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    recent_failures = await db.login_logs.count_documents({"success": False, "timestamp": {"$gte": yesterday}})

    return {
        "total_users": total_users, "online_users": online_count,
        "total_messages": total_messages, "total_failed_logins": failed_logins,
        "recent_failed_logins_24h": recent_failures,
        "online_user_ids": manager.get_online_users(),
    }


@api_router.get("/admin/users")
async def admin_users(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    users = await db.users.find({}, {"password_hash": 0, "encrypted_private_key": 0}).to_list(100)
    online_users = set(manager.get_online_users())

    result = []
    for u in users:
        uid = str(u["_id"])
        result.append({
            "id": uid, "name": u.get("name", ""), "email": u.get("email", ""),
            "phone_number": u.get("phone_number", ""), "role": u.get("role", "user"),
            "is_verified": u.get("is_verified", False), "is_online": uid in online_users,
            "created_at": u.get("created_at", ""),
        })
    return {"users": result}


@api_router.get("/admin/login-logs")
async def admin_login_logs(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    logs = await db.login_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    return {"logs": logs}


# ── WEBSOCKET ─────────────────────────────────────────────────────────────────
@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload["sub"]
    except Exception:
        await websocket.close(code=4001, reason="Invalid token")
        return
    await manager.connect(user_id, websocket)
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"last_seen": datetime.now(timezone.utc).isoformat(), "is_online": True}})
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "typing":
                chat_id = data.get("chat_id")
                if chat_id:
                    chat = await db.chats.find_one({"_id": ObjectId(chat_id)})
                    if chat:
                        recipients = [p for p in chat["participants"] if p != user_id]
                        for rid in recipients:
                            await manager.send_to_user(rid, {"type": "typing", "data": {"chat_id": chat_id, "user_id": user_id}})
            elif msg_type == "read":
                chat_id = data.get("chat_id")
                if chat_id:
                    await db.messages.update_many(
                        {"chat_id": chat_id, "sender_id": {"$ne": user_id}},
                        {"$set": {"status": "read"}, "$addToSet": {"read_by": user_id}}
                    )
                    await db.chats.update_one({"_id": ObjectId(chat_id)}, {"$set": {f"unread_{user_id}": 0}})
                    chat = await db.chats.find_one({"_id": ObjectId(chat_id)})
                    if chat:
                        for p in chat["participants"]:
                            if p != user_id:
                                await manager.send_to_user(p, {"type": "read_receipt", "data": {"chat_id": chat_id, "user_id": user_id}})
            elif msg_type == "voice_played":
                msg_id = data.get("message_id")
                chat_id = data.get("chat_id")
                if msg_id and chat_id:
                    await db.messages.update_one(
                        {"_id": ObjectId(msg_id)},
                        {"$addToSet": {"played_by": user_id}}
                    )
                    msg_doc = await db.messages.find_one({"_id": ObjectId(msg_id)})
                    if msg_doc:
                        sender_id = msg_doc.get("sender_id")
                        if sender_id and sender_id != user_id:
                            await manager.send_to_user(sender_id, {
                                "type": "voice_played_ack",
                                "data": {"message_id": msg_id, "chat_id": chat_id, "played_by": user_id}
                            })
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await manager.disconnect(user_id)
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"last_seen": datetime.now(timezone.utc).isoformat(), "is_online": False}})


# ── HEALTH ────────────────────────────────────────────────────────────────────
@api_router.get("/")
async def root():
    return {"message": "Quantum-Safe Secure Chat API", "version": "1.0.0"}


@api_router.get("/health")
async def health():
    return {"status": "healthy"}


# ── STARTUP / SHUTDOWN ────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("phone_number", unique=True, sparse=True)
    await db.chats.create_index("participants")
    await db.messages.create_index("chat_id")
    await db.login_attempts.create_index("identifier")
    await db.login_logs.create_index("timestamp")
    await db.files.create_index("storage_path")

    try:
        init_obj_storage()
    except Exception as e:
        logger.warning(f"Object storage init deferred: {e}")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@quantumsafe.chat")
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@123")

    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        priv, pub = generate_x25519_keypair()
        await db.users.insert_one({
            "name": "System Admin", "email": admin_email, "phone_number": "+1000000000",
            "password_hash": hash_password(admin_password), "is_verified": True, "role": "admin",
            "avatar_color": "#10B981", "public_key": pub, "encrypted_private_key": encrypt_private_key(priv),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Admin created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    demo_users = [
        {"name": "Alice Johnson", "email": "alice@example.com", "phone": "+1111111111", "pw": "test123"},
        {"name": "Bob Smith", "email": "bob@example.com", "phone": "+2222222222", "pw": "test123"},
        {"name": "Charlie Davis", "email": "charlie@example.com", "phone": "+3333333333", "pw": "test123"},
    ]
    for demo in demo_users:
        if not await db.users.find_one({"email": demo["email"]}):
            priv, pub = generate_x25519_keypair()
            await db.users.insert_one({
                "name": demo["name"], "email": demo["email"], "phone_number": demo["phone"],
                "password_hash": hash_password(demo["pw"]), "is_verified": True, "role": "user",
                "avatar_color": f"#{secrets.token_hex(3)}", "public_key": pub,
                "encrypted_private_key": encrypt_private_key(priv),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

    memory_dir = os.path.join(ROOT_DIR, "memory")
    os.makedirs(memory_dir, exist_ok=True)
    with open(os.path.join(memory_dir, "test_credentials.md"), "w") as f:
        f.write("# Test Credentials\n\n")
        f.write(f"## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n")
        f.write("## Demo Users\n")
        for demo in demo_users:
            f.write(f"- Email: {demo['email']}, Password: {demo['pw']}, Role: user\n")
        f.write("\n## Auth Endpoints\n")
        f.write("- POST /api/auth/register\n- POST /api/auth/verify-otp\n")
        f.write("- POST /api/auth/login\n- POST /api/auth/verify-login-otp\n")
        f.write("- GET /api/auth/me\n- POST /api/auth/logout\n")

    logger.info("Quantum-Safe Secure Chat started")


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ── INCLUDE ROUTER & CORS ────────────────────────────────────────────────────
# ── QUANTUM VAULT ENDPOINTS ──────────────────────────────────────────────────

# ── QUANTUM VAULT ENDPOINTS ──────────────────────────────────────────────────

@api_router.post("/vault/upgrade-pqc")
async def upgrade_pqc(req: dict, user: dict = Depends(get_current_user)):
    logger.info(f"VAULT: Upgrading PQC for user {user['id']}")
    await db.users.update_one(
        {"_id": user["id"]},
        {"$set": {
            "kyber_pubkey": req.get("kyber_pubkey"),
            "dilithium_pubkey": req.get("dilithium_pubkey")
        }}
    )
    return {"status": "success"}

@api_router.post("/vault/init")
async def init_vault(req: VaultInitRequest, user: dict = Depends(get_current_user)):
    logger.info(f"VAULT: Initializing vault for user {user['id']}")
    await db.users.update_one(
        {"_id": user["id"]},
        {"$set": {
            "vault_config": {
                "wrapped_key": req.wrapped_key,
                "salt": req.salt,
                "iterations": req.iterations,
                "active": True
            }
        }}
    )
    return {"status": "success"}

@api_router.get("/vault/config")
async def get_vault_config(user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"_id": user["id"]})
    if not u or "vault_config" not in u:
        return {"active": False}
    return u["vault_config"]

@api_router.post("/vault/items")
async def create_vault_item(req: VaultItemCreate, user: dict = Depends(get_current_user)):
    logger.info(f"VAULT: Creating item for user {user['id']}")
    item = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "type": req.type,
        "encrypted_metadata": req.encrypted_metadata,
        "encrypted_blob_id": req.encrypted_blob_id,
        "note_content": req.note_content,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.vault_items.insert_one(item)
    return item

@api_router.get("/vault/items")
async def list_vault_items(user: dict = Depends(get_current_user)):
    items = await db.vault_items.find({"user_id": user["id"]}).sort("created_at", -1).to_list(1000)
    for i in items:
        i["_id"] = str(i["_id"])
    return items

@api_router.delete("/vault/items/{item_id}")
async def delete_vault_item(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.vault_items.find_one({"id": item_id, "user_id": user["id"]})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.vault_items.delete_one({"id": item_id})
    return {"status": "success"}
app.include_router(api_router)

@app.middleware("http")
async def add_ngrok_skip_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["ngrok-skip-browser-warning"] = "true"
    return response

frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", frontend_url, "http://localhost:3000", "http://192.168.0.105:3000", "http://192.168.0.105:8001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── STATIC FILE SERVING ────────────────────────────────────────────────────────
# This serves the production React frontend from the /static folder
frontend_build_path = os.path.join(os.path.dirname(__file__), "static")

if os.path.exists(frontend_build_path):
    app.mount("/", StaticFiles(directory=frontend_build_path, html=True), name="static")

@app.exception_handler(404)
async def custom_404_handler(request: Request, __):
    if os.path.exists(os.path.join(frontend_build_path, "index.html")):
        return FileResponse(os.path.join(frontend_build_path, "index.html"))
    return JSONResponse({"detail": "Not Found"}, status_code=404)
