import os
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash

from app.database import get_db
from app.models import User

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY environment variable is not set")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

password_hash = PasswordHash.recommended()
security = HTTPBearer()

# Used to keep login timing similar when the email doesn't exist
DUMMY_HASH = password_hash.hash("dummy-password-for-timing")


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_hash.verify(plain_password, hashed_password)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )
    header = _b64url_encode(json.dumps({"alg": ALGORITHM, "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url_encode(
        json.dumps(
            {"sub": str(user_id), "exp": int(expires.timestamp())},
            separators=(",", ":"),
        ).encode()
    )
    signing_input = f"{header}.{payload}"
    signature = hmac.new(
        SECRET_KEY.encode(), signing_input.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def _decode_access_token(token: str) -> dict:
    try:
        header_part, payload_part, signature_part = token.split(".")
        signing_input = f"{header_part}.{payload_part}"
        expected_signature = hmac.new(
            SECRET_KEY.encode(), signing_input.encode("ascii"), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(_b64url_decode(signature_part), expected_signature):
            raise ValueError("Invalid token signature")

        header = json.loads(_b64url_decode(header_part))
        payload = json.loads(_b64url_decode(payload_part))
        if not isinstance(header, dict) or header.get("alg") != ALGORITHM:
            raise ValueError("Invalid token algorithm")
        if not isinstance(payload, dict):
            raise ValueError("Invalid token payload")
        expires = payload.get("exp")
        if isinstance(expires, bool) or not isinstance(expires, (int, float)):
            raise ValueError("Invalid token expiration")
        if datetime.now(timezone.utc).timestamp() >= expires:
            raise ValueError("Expired token")
        return payload
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ValueError("Invalid or expired token") from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db=Depends(get_db),
) -> User:
    """Reusable dependency: add `Depends(get_current_user)` to protect any route."""
    try:
        payload = _decode_access_token(credentials.credentials)
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=401,
            detail="User not found",
        )
    return user


@router.post("/register", status_code=201)
def register(data: RegisterRequest, db=Depends(get_db)):
    email = data.email.lower()
    username = data.username.strip()

    existing_user = db.query(User).filter(
        (User.email == email) | (User.username == username)
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Email or username already registered",
        )

    user = User(
        username=username,
        email=email,
        hashed_password=hash_password(data.password),
    )

    try:
        db.add(user)
        db.commit()
    except Exception as exc:
        db.rollback()
        if exc.__class__.__name__ != "IntegrityError":
            raise
        raise HTTPException(
            status_code=409,
            detail="Email or username already registered",
        )

    db.refresh(user)

    return {
        "message": "User registered successfully",
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
    }


@router.post("/login")
def login(data: LoginRequest, db=Depends(get_db)):
    email = data.email.lower()

    user = db.query(User).filter(User.email == email).first()

    hashed = user.hashed_password if user else DUMMY_HASH
    password_ok = verify_password(data.password, hashed)

    if not user or not password_ok:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    token = create_access_token(user.id)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
        },
    }


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
    }