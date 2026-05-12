import json
import os
import smtplib
import time
import urllib.parse
import urllib.request
from email.mime.text import MIMEText

import jwt

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine
import bcrypt as _bcrypt

from .models import Category, ChatRoom, CheckinRecord, KeyCode, Message, MessageTemplate, Operator, Property, Setting

Base.metadata.create_all(bind=engine)

def _hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()

def _verify_password(password: str, hashed: str) -> bool:
    return _bcrypt.checkpw(password.encode(), hashed.encode())

SECRET_KEY = os.getenv("SECRET_KEY", "changeme-set-SECRET_KEY-in-production")
BEDS24_CSV_USERNAME = os.getenv("BEDS24_CSV_USERNAME", "")
BEDS24_CSV_PASSWORD = os.getenv("BEDS24_CSV_PASSWORD", "")
BEDS24_CSV_URL = "https://www.beds24.com/api/csv/getbookingscsv"

from datetime import date as _date

# 既存テーブルへの列追加をカバーする起動時マイグレーション
def _run_migrations():
    with engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE message_templates
            ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES message_templates(id)
        """))
        conn.execute(text("""
            ALTER TABLE chat_rooms
            ADD COLUMN IF NOT EXISTS checkin_date VARCHAR
        """))
        conn.execute(text("""
            ALTER TABLE properties
            ADD COLUMN IF NOT EXISTS checkin_guide TEXT
        """))
        conn.commit()

    # ADMIN_USERNAME が存在しない場合のみ初期管理者を作成
    admin_user = os.getenv("ADMIN_USERNAME", "admin")
    admin_pass = os.getenv("ADMIN_PASSWORD")
    if admin_pass:
        with engine.connect() as conn2:
            exists = conn2.execute(
                text("SELECT COUNT(*) FROM operators WHERE username = :u"),
                {"u": admin_user},
            ).scalar()
            if exists == 0:
                hashed = _hash_password(admin_pass)
                conn2.execute(
                    text("INSERT INTO operators (username, display_name, password_hash, is_admin, is_active) "
                         "VALUES (:u, :d, :h, TRUE, TRUE)"),
                    {"u": admin_user, "d": "管理者", "h": hashed},
                )
                conn2.commit()

_run_migrations()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic スキーマ ─────────────────────────────────────────────────────────

class StartChatRequest(BaseModel):
    property_name: str
    room_number: str
    guest_contact: str | None = None


class SelectCategoryRequest(BaseModel):
    category_id: int


class SelectTemplateRequest(BaseModel):
    template_id: int


class MessageRequest(BaseModel):
    sender_type: str
    message: str


class PropertyRequest(BaseModel):
    name: str

class PropertyGuideRequest(BaseModel):
    checkin_guide: str


class SettingRequest(BaseModel):
    value: str


class CategoryRequest(BaseModel):
    name: str
    property_name: str | None = None
    is_escalation: bool = False


class TemplateRequest(BaseModel):
    property_name: str
    category: str
    title: str
    body: str
    is_emergency: str = "false"
    active: str = "true"
    parent_id: int | None = None


class CheckinVerifyRequest(BaseModel):
    booking_ref: str | None = None
    guest_name: str | None = None
    checkin_date: str | None = None


class IdentityVerifyRequest(BaseModel):
    property_name: str
    room_number: str | None = None  # 省略時は物件全体から検索
    guest_input: str  # ゲストが入力した名前 or 予約番号


class CheckinSubmitRequest(BaseModel):
    booking_id: str | None = None
    property_name: str
    room_number: str
    checkin_date: str
    checkout_date: str | None = None
    guest_name: str
    guest_name_kana: str | None = None
    guest_address: str | None = None
    guest_phone: str | None = None
    guest_nationality: str | None = None
    passport_number: str | None = None
    guest_count: int = 1


class KeyCodeRequest(BaseModel):
    property_name: str
    room_number: str
    code: str
    note: str | None = None


class UpdateRoomInfoRequest(BaseModel):
    guest_contact: str | None = None
    category: str | None = None
    assigned_operator: str | None = None
    checkin_date: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class OperatorCreateRequest(BaseModel):
    username: str
    display_name: str
    password: str
    is_admin: bool = False


class OperatorUpdateRequest(BaseModel):
    display_name: str
    password: str | None = None
    is_admin: bool = False
    is_active: bool = True


# ── ヘルパー ──────────────────────────────────────────────────────────────────

def _get_lineworks_token() -> str | None:
    client_id = os.getenv("LINEWORKS_CLIENT_ID")
    client_secret = os.getenv("LINEWORKS_CLIENT_SECRET")
    service_account = os.getenv("LINEWORKS_SERVICE_ACCOUNT")
    private_key = os.getenv("LINEWORKS_PRIVATE_KEY", "").replace("\\n", "\n")

    if not all([client_id, client_secret, service_account, private_key]):
        return None

    now = int(time.time())
    jwt_token = jwt.encode(
        {"iss": client_id, "sub": service_account, "iat": now, "exp": now + 3600},
        private_key,
        algorithm="RS256",
    )

    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "bot",
    }).encode()

    req = urllib.request.Request(
        "https://auth.worksmobile.com/oauth2/v2.0/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()).get("access_token")
    except Exception:
        return None


def _send_lineworks_notification(text: str):
    bot_id = os.getenv("LINEWORKS_BOT_ID")
    channel_id = os.getenv("LINEWORKS_CHANNEL_ID")

    if not all([bot_id, channel_id]):
        return

    try:
        token = _get_lineworks_token()
        if not token:
            return

        body = json.dumps({"content": {"type": "text", "text": text}}).encode()
        req = urllib.request.Request(
            f"https://www.worksapis.com/v1.0/bots/{bot_id}/channels/{channel_id}/messages",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        urllib.request.urlopen(req)
    except Exception:
        pass


def _send_escalation_email(
    room_id: int,
    property_name: str,
    room_number: str,
    category: str,
    guest_contact: str | None,
):
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    notify_from = os.getenv("NOTIFY_EMAIL_FROM", smtp_user)
    notify_to = os.getenv("NOTIFY_EMAIL_TO")

    if not all([smtp_host, smtp_user, smtp_password, notify_to]):
        return

    body = (
        f"エスカレーションが発生しました。\n\n"
        f"物件：{property_name}\n"
        f"部屋：{room_number}号室\n"
        f"カテゴリ：{category}\n"
        f"連絡先：{guest_contact or '未登録'}\n"
        f"チャットID：{room_id}\n"
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = f"【対応必要】チャットエスカレーション - {property_name} {room_number}号室"
    msg["From"] = notify_from
    msg["To"] = notify_to

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(notify_from, [notify_to], msg.as_string())
    except Exception:
        pass


def _normalize_name(name: str) -> str:
    return name.strip().lower().replace(" ", "").replace("　", "")


def _fetch_beds24_csv(from_date: str, to_date: str) -> list[dict]:
    if not BEDS24_CSV_USERNAME or not BEDS24_CSV_PASSWORD:
        raise HTTPException(status_code=503, detail="Beds24が設定されていません（BEDS24_CSV_USERNAME / BEDS24_CSV_PASSWORD）")

    import csv as _csv
    import io as _io

    payload = urllib.parse.urlencode({
        "username": BEDS24_CSV_USERNAME,
        "password": BEDS24_CSV_PASSWORD,
        "datefrom": from_date,
        "dateto": to_date,
    }).encode()
    req = urllib.request.Request(BEDS24_CSV_URL, data=payload, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            csv_text = resp.read().decode("utf-8-sig")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Beds24 接続エラー: {str(e)}")

    rows = list(_csv.reader(_io.StringIO(csv_text)))
    if not rows:
        return []

    header = [h.strip() for h in rows[0]]

    def col(name):
        try:
            return header.index(name)
        except ValueError:
            return -1

    idx = {
        "ref":       col("Ref"),
        "apiref":    col("ApiRef"),
        "property":  col("Property"),
        "unit":      col("Unit"),
        "first":     col("FirstNight"),
        "checkout":  col("CheckOut"),
        "firstname": col("First Name"),
        "lastname":  col("Name"),
        "adult":     col("Adult"),
        "child":     col("Child"),
        "status":    col("Status"),
        "title":     col("Title"),
    }

    bookings = []
    for row in rows[1:]:
        def g(k):
            i = idx.get(k, -1)
            return row[i].strip() if i >= 0 and i < len(row) else ""

        if g("status") == "Cancelled":
            continue
        title = g("title")
        if "ブロック" in title or "予備部屋" in title:
            continue

        ref = g("ref")
        if not ref:
            continue

        try:
            adults = int(g("adult") or 0)
        except Exception:
            adults = 0
        try:
            children = int(g("child") or 0)
        except Exception:
            children = 0

        first_name = g("firstname")
        last_name  = g("lastname")
        guest_name = f"{first_name} {last_name}".strip()

        bookings.append({
            "booking_id":    ref,
            "api_ref":       g("apiref"),
            "property_name": g("property"),
            "room_number":   g("unit"),
            "checkin_date":  g("first"),
            "checkout_date": g("checkout"),
            "guest_name":    guest_name,
            "guest_count":   adults + children or 1,
            "status":        g("status"),
        })

    return bookings


def _search_beds24_bookings(search: str | None = None, checkin_date: str | None = None) -> list:
    from_date = checkin_date or str(_date.today())
    to_date   = checkin_date or str(_date.today())
    bookings  = _fetch_beds24_csv(from_date, to_date)

    if search:
        s = _normalize_name(search)
        bookings = [
            b for b in bookings
            if s in _normalize_name(b["guest_name"])
            or s == b["booking_id"]
        ]

    return bookings


def require_auth(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return jwt.decode(authorization[7:], SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(op: dict = Depends(require_auth)) -> dict:
    if not op.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin required")
    return op


def _template_dict(t: MessageTemplate) -> dict:
    return {
        "id": t.id,
        "property_name": t.property_name,
        "category": t.category,
        "title": t.title,
        "body": t.body,
        "is_emergency": t.is_emergency,
        "active": t.active,
        "parent_id": t.parent_id,
        "created_at": t.created_at,
    }


# ── ヘルスチェック ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "healthy"}


# ── 認証 ──────────────────────────────────────────────────────────────────────

@app.get("/setup/status")
def setup_status():
    db: Session = SessionLocal()
    count = db.query(Operator).count()
    db.close()
    return {"needs_setup": count == 0}


@app.post("/setup")
def setup_first_admin(data: OperatorCreateRequest):
    db: Session = SessionLocal()
    if db.query(Operator).count() > 0:
        db.close()
        raise HTTPException(status_code=403, detail="すでに設定済みです")
    op = Operator(
        username=data.username,
        display_name=data.display_name,
        password_hash=_hash_password(data.password),
        is_admin=True,
    )
    db.add(op)
    db.commit()
    db.close()
    return {"status": "ok"}


@app.post("/auth/login")
def login(data: LoginRequest):
    db: Session = SessionLocal()
    op = db.query(Operator).filter(
        Operator.username == data.username,
        Operator.is_active != False,
    ).first()
    db.close()
    if not op or not _verify_password(data.password, op.password_hash):
        raise HTTPException(status_code=401, detail="ユーザー名またはパスワードが正しくありません")
    token = jwt.encode(
        {
            "sub": str(op.id),
            "username": op.username,
            "display_name": op.display_name,
            "is_admin": op.is_admin,
            "exp": int(time.time()) + 86400 * 7,
        },
        SECRET_KEY,
        algorithm="HS256",
    )
    return {
        "token": token,
        "operator": {
            "id": op.id,
            "username": op.username,
            "display_name": op.display_name,
            "is_admin": op.is_admin,
        },
    }


@app.get("/auth/me")
def get_me(op: dict = Depends(require_auth)):
    return op


# ── オペレーターアカウント管理（管理者のみ） ──────────────────────────────────

@app.get("/admin/operators")
def list_operators(op: dict = Depends(require_admin)):
    db: Session = SessionLocal()
    ops = db.query(Operator).order_by(Operator.id.asc()).all()
    result = [
        {
            "id": o.id,
            "username": o.username,
            "display_name": o.display_name,
            "is_admin": o.is_admin,
            "is_active": o.is_active,
            "created_at": o.created_at,
        }
        for o in ops
    ]
    db.close()
    return {"operators": result}


@app.post("/admin/operators")
def create_operator(data: OperatorCreateRequest, op: dict = Depends(require_admin)):
    db: Session = SessionLocal()
    if db.query(Operator).filter(Operator.username == data.username).first():
        db.close()
        raise HTTPException(status_code=400, detail="username already exists")
    new_op = Operator(
        username=data.username,
        display_name=data.display_name,
        password_hash=_hash_password(data.password),
        is_admin=data.is_admin,
    )
    db.add(new_op)
    db.commit()
    db.refresh(new_op)
    new_id = new_op.id
    db.close()
    return {"status": "ok", "operator_id": new_id}


@app.patch("/admin/operators/{operator_id}")
def update_operator(operator_id: int, data: OperatorUpdateRequest, op: dict = Depends(require_admin)):
    db: Session = SessionLocal()
    target = db.query(Operator).filter(Operator.id == operator_id).first()
    if not target:
        db.close()
        raise HTTPException(status_code=404, detail="operator not found")
    target.display_name = data.display_name
    target.is_admin = data.is_admin
    target.is_active = data.is_active
    if data.password:
        target.password_hash = _hash_password(data.password)
    db.commit()
    db.close()
    return {"status": "ok"}


@app.delete("/admin/operators/{operator_id}")
def delete_operator(operator_id: int, op: dict = Depends(require_admin)):
    if str(operator_id) == op.get("sub"):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    db: Session = SessionLocal()
    target = db.query(Operator).filter(Operator.id == operator_id).first()
    if not target:
        db.close()
        raise HTTPException(status_code=404, detail="operator not found")
    db.delete(target)
    db.commit()
    db.close()
    return {"status": "ok"}


# ── 物件管理 ──────────────────────────────────────────────────────────────────

@app.get("/properties")
def get_properties():
    db: Session = SessionLocal()
    props = db.query(Property).order_by(Property.name.asc()).all()
    result = [{"id": p.id, "name": p.name, "checkin_guide": p.checkin_guide, "created_at": p.created_at} for p in props]
    db.close()
    return {"properties": result}


@app.get("/checkin/guide")
def get_checkin_guide(property_name: str):
    """ゲスト向け：物件のチェックイン案内文を返す"""
    db: Session = SessionLocal()
    prop = db.query(Property).filter(Property.name == property_name).first()
    db.close()
    if not prop:
        raise HTTPException(status_code=404, detail="property not found")
    return {"property_name": prop.name, "checkin_guide": prop.checkin_guide or ""}


@app.patch("/properties/{property_id}/guide")
def update_property_guide(property_id: int, data: PropertyGuideRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        db.close()
        raise HTTPException(status_code=404, detail="property not found")
    prop.checkin_guide = data.checkin_guide
    db.commit()
    db.close()
    return {"status": "ok"}


@app.post("/properties")
def create_property(data: PropertyRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    existing = db.query(Property).filter(Property.name == data.name).first()
    if existing:
        db.close()
        raise HTTPException(status_code=400, detail="property already exists")
    prop = Property(name=data.name)
    db.add(prop)
    db.commit()
    db.refresh(prop)
    prop_id = prop.id
    db.close()
    return {"status": "ok", "property_id": prop_id}


@app.delete("/properties/{property_id}")
def delete_property(property_id: int, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        db.close()
        raise HTTPException(status_code=404, detail="property not found")
    db.delete(prop)
    db.commit()
    db.close()
    return {"status": "ok"}


# ── カテゴリ管理 ──────────────────────────────────────────────────────────────

# ── 設定管理 ──────────────────────────────────────────────────────────────────

SETTING_DEFAULTS = {
    "hours_start": "10:00",
    "hours_end": "19:00",
    "emergency_phone": "",
    "emergency_message": "時間外は緊急カテゴリのみ対応いたします。",
}

@app.get("/settings")
def get_settings():
    db: Session = SessionLocal()
    rows = db.query(Setting).all()
    result = {r.key: r.value for r in rows}
    db.close()
    # DBに未登録のキーはデフォルト値で補完
    return {**SETTING_DEFAULTS, **result}


@app.put("/settings/{key}")
def upsert_setting(key: str, data: SettingRequest, op: dict = Depends(require_auth)):
    if key not in SETTING_DEFAULTS:
        raise HTTPException(status_code=400, detail="unknown setting key")
    db: Session = SessionLocal()
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = data.value
    else:
        db.add(Setting(key=key, value=data.value))
    db.commit()
    db.close()
    return {"status": "ok"}


# ── カテゴリ管理 ──────────────────────────────────────────────────────────────

@app.get("/categories")
def get_categories(property_name: str | None = None):
    db: Session = SessionLocal()
    q = db.query(Category)
    if property_name:
        q = q.filter(
            (Category.property_name == property_name) | (Category.property_name.is_(None))
        )
    categories = q.order_by(Category.id.asc()).all()
    result = [
        {
            "id": c.id,
            "name": c.name,
            "property_name": c.property_name,
            "is_escalation": c.is_escalation,
            "created_at": c.created_at,
        }
        for c in categories
    ]
    db.close()
    return {"categories": result}


@app.post("/categories")
def create_category(data: CategoryRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    cat = Category(
        name=data.name,
        property_name=data.property_name or None,
        is_escalation=data.is_escalation,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    cat_id = cat.id
    db.close()
    return {"status": "ok", "category_id": cat_id}


@app.put("/categories/{category_id}")
def update_category(category_id: int, data: CategoryRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        db.close()
        raise HTTPException(status_code=404, detail="category not found")
    cat.name = data.name
    cat.property_name = data.property_name or None
    cat.is_escalation = data.is_escalation
    db.commit()
    db.close()
    return {"status": "ok"}


@app.delete("/categories/{category_id}")
def delete_category(category_id: int, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        db.close()
        raise HTTPException(status_code=404, detail="category not found")
    db.delete(cat)
    db.commit()
    db.close()
    return {"status": "ok"}


# ── ゲストチャット ─────────────────────────────────────────────────────────────

@app.post("/guest/chat/start")
def start_chat(data: StartChatRequest):
    db: Session = SessionLocal()

    room = ChatRoom(
        property_name=data.property_name,
        room_number=data.room_number,
        guest_contact=data.guest_contact,
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    room_id = room.id

    welcome = Message(
        chat_room_id=room_id,
        sender_type="system",
        message="お問い合わせありがとうございます。下記よりお問い合わせ内容をお選びください。",
    )
    db.add(welcome)
    db.commit()
    db.close()

    return {"chat_room_id": room_id}


@app.post("/guest/chat/{chat_room_id}/select-category")
def select_category(
    chat_room_id: int,
    data: SelectCategoryRequest,
    background_tasks: BackgroundTasks,
):
    db: Session = SessionLocal()

    room = db.query(ChatRoom).filter(ChatRoom.id == chat_room_id).first()
    if not room:
        db.close()
        raise HTTPException(status_code=404, detail="room not found")

    cat = db.query(Category).filter(Category.id == data.category_id).first()
    if not cat:
        db.close()
        raise HTTPException(status_code=404, detail="category not found")

    room.category = cat.name
    db.commit()

    # ゲストの選択をメッセージとして記録
    db.add(Message(chat_room_id=chat_room_id, sender_type="guest", message=cat.name))
    db.commit()

    if cat.is_escalation:
        # 即エスカレーション（24時間対応）
        room.mode = "operator"
        room.status = "unassigned"
        db.commit()

        db.add(Message(
            chat_room_id=chat_room_id,
            sender_type="system",
            message="担当スタッフに接続しています。しばらくお待ちください。",
        ))
        db.commit()

        property_name = room.property_name
        room_number = room.room_number
        category_name = cat.name
        guest_contact = room.guest_contact
        db.close()

        background_tasks.add_task(
            _send_escalation_email,
            chat_room_id,
            property_name,
            room_number,
            category_name,
            guest_contact,
        )
        lw_text = (
            f"【緊急対応が必要です】\n"
            f"物件：{property_name}\n"
            f"部屋：{room_number}号室\n"
            f"カテゴリ：{category_name}\n"
            f"連絡先：{guest_contact or '未登録'}\n"
            f"チャットID：{chat_room_id}"
        )
        background_tasks.add_task(_send_lineworks_notification, lw_text)

        return {"escalated": True, "templates": []}

    # 該当カテゴリのルートテンプレートを返す
    templates = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.property_name == room.property_name)
        .filter(MessageTemplate.category == cat.name)
        .filter(MessageTemplate.active == "true")
        .filter(MessageTemplate.parent_id.is_(None))
        .order_by(MessageTemplate.id.asc())
        .all()
    )
    result = [{"id": t.id, "title": t.title, "body": t.body} for t in templates]
    db.close()

    return {"escalated": False, "templates": result}


@app.post("/guest/chat/{chat_room_id}/select-template")
def select_template(chat_room_id: int, data: SelectTemplateRequest):
    db: Session = SessionLocal()

    room = db.query(ChatRoom).filter(ChatRoom.id == chat_room_id).first()
    if not room:
        db.close()
        raise HTTPException(status_code=404, detail="room not found")

    template = db.query(MessageTemplate).filter(MessageTemplate.id == data.template_id).first()
    if not template:
        db.close()
        raise HTTPException(status_code=404, detail="template not found")

    # ゲストの選択を記録
    db.add(Message(chat_room_id=chat_room_id, sender_type="guest", message=template.title))
    db.commit()

    # ボットが返信
    db.add(Message(chat_room_id=chat_room_id, sender_type="system", message=template.body))
    db.commit()

    # 子テンプレートを返す
    children = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.parent_id == template.id)
        .filter(MessageTemplate.active == "true")
        .order_by(MessageTemplate.id.asc())
        .all()
    )
    result = [{"id": c.id, "title": c.title, "body": c.body} for c in children]
    db.close()

    return {"children": result}


@app.post("/guest/chat/{chat_room_id}/messages")
def send_message(chat_room_id: int, data: MessageRequest):
    db: Session = SessionLocal()

    room = db.query(ChatRoom).filter(ChatRoom.id == chat_room_id).first()
    if not room:
        db.close()
        raise HTTPException(status_code=404, detail="room not found")

    db.add(Message(
        chat_room_id=chat_room_id,
        sender_type=data.sender_type,
        message=data.message,
    ))
    db.commit()
    db.close()

    return {"status": "ok"}


@app.get("/guest/chat/{chat_room_id}/messages")
def get_messages(chat_room_id: int):
    db: Session = SessionLocal()

    messages = (
        db.query(Message)
        .filter(Message.chat_room_id == chat_room_id)
        .order_by(Message.id.asc())
        .all()
    )
    result = [
        {
            "id": m.id,
            "chat_room_id": m.chat_room_id,
            "sender_type": m.sender_type,
            "message": m.message,
            "created_at": m.created_at,
        }
        for m in messages
    ]
    db.close()

    return {"messages": result}


# ── オペレーター ───────────────────────────────────────────────────────────────

@app.get("/guest/chat/history")
def get_guest_history(contact: str, exclude_id: int | None = None):
    db: Session = SessionLocal()
    q = db.query(ChatRoom).filter(ChatRoom.guest_contact == contact)
    if exclude_id:
        q = q.filter(ChatRoom.id != exclude_id)
    rooms = q.order_by(ChatRoom.created_at.desc()).limit(10).all()
    result = []
    for room in rooms:
        last_msg = (
            db.query(Message)
            .filter(Message.chat_room_id == room.id)
            .order_by(Message.id.desc())
            .first()
        )
        result.append({
            "id": room.id,
            "property_name": room.property_name,
            "room_number": room.room_number,
            "category": room.category,
            "status": room.status,
            "created_at": room.created_at,
            "last_message": last_msg.message if last_msg else None,
        })
    db.close()
    return {"history": result}


@app.get("/operator/chat-rooms")
def get_chat_rooms(op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    rooms = db.query(ChatRoom).order_by(ChatRoom.id.desc()).all()
    result = [
        {
            "id": r.id,
            "property_name": r.property_name,
            "room_number": r.room_number,
            "guest_contact": r.guest_contact,
            "category": r.category,
            "status": r.status,
            "mode": r.mode,
            "assigned_operator": r.assigned_operator,
            "checkin_date": r.checkin_date,
        }
        for r in rooms
    ]
    db.close()
    return {"chat_rooms": result}


@app.patch("/operator/chat-rooms/{chat_room_id}/info")
def update_room_info(chat_room_id: int, data: UpdateRoomInfoRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    room = db.query(ChatRoom).filter(ChatRoom.id == chat_room_id).first()
    if not room:
        db.close()
        raise HTTPException(status_code=404, detail="room not found")
    room.guest_contact = data.guest_contact or None
    room.category = data.category or None
    room.assigned_operator = data.assigned_operator or None
    room.checkin_date = data.checkin_date or None
    db.commit()
    db.close()
    return {"status": "ok"}


@app.patch("/operator/chat-rooms/{chat_room_id}/status")
def update_status(chat_room_id: int, status: str, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    room = db.query(ChatRoom).filter(ChatRoom.id == chat_room_id).first()
    if not room:
        db.close()
        raise HTTPException(status_code=404, detail="room not found")
    room.status = status
    db.commit()
    db.close()
    return {"status": "ok"}


@app.get("/operator/templates")
def get_templates(
    property_name: str | None = None,
    category: str | None = None,
    parent_id: int | None = None,
    root_only: bool = False,
    op: dict = Depends(require_auth),
):
    db: Session = SessionLocal()
    q = db.query(MessageTemplate)
    if property_name:
        q = q.filter(MessageTemplate.property_name == property_name)
    if category:
        q = q.filter(MessageTemplate.category == category)
    if parent_id is not None:
        q = q.filter(MessageTemplate.parent_id == parent_id)
    elif root_only:
        q = q.filter(MessageTemplate.parent_id.is_(None))
    templates = q.order_by(MessageTemplate.id.desc()).all()
    result = [_template_dict(t) for t in templates]
    db.close()
    return {"templates": result}


@app.post("/operator/templates")
def create_template(data: TemplateRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    template = MessageTemplate(
        property_name=data.property_name,
        category=data.category,
        title=data.title,
        body=data.body,
        is_emergency=data.is_emergency,
        active=data.active,
        parent_id=data.parent_id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    template_id = template.id
    db.close()
    return {"status": "ok", "template_id": template_id}


@app.patch("/operator/templates/{template_id}")
def update_template(template_id: int, data: TemplateRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    template = db.query(MessageTemplate).filter(MessageTemplate.id == template_id).first()
    if not template:
        db.close()
        raise HTTPException(status_code=404, detail="template not found")
    template.property_name = data.property_name
    template.category = data.category
    template.title = data.title
    template.body = data.body
    template.is_emergency = data.is_emergency
    template.active = data.active
    template.parent_id = data.parent_id
    db.commit()
    db.close()
    return {"status": "ok"}


@app.delete("/operator/templates/{template_id}")
def delete_template(template_id: int, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    template = db.query(MessageTemplate).filter(MessageTemplate.id == template_id).first()
    if not template:
        db.close()
        raise HTTPException(status_code=404, detail="template not found")
    db.delete(template)
    db.commit()
    db.close()
    return {"status": "ok"}


# ── 自動チェックイン ───────────────────────────────────────────────────────────

@app.get("/checkin/today-booking")
def get_today_booking(property_name: str, room_number: str):
    """部屋QRコード用：今日のチェックイン予約の存在確認のみ（キーコードは返さない）"""
    today = _date.today().isoformat()
    bookings = _search_beds24_bookings(checkin_date=today)
    active = [b for b in bookings if b.get("status", "") not in ("-1", "cancelled", "2", "Cancelled")]

    matched = [
        b for b in active
        if b["property_name"].strip().startswith(property_name.strip())
        and b["room_number"].strip() == room_number.strip()
    ]

    if not matched:
        raise HTTPException(status_code=404, detail="本日のご予約が見つかりません")

    return {"exists": True, "property_name": property_name, "room_number": room_number}


@app.post("/checkin/verify-identity")
def verify_identity(data: IdentityVerifyRequest):
    """物件の本日チェックイン予約からゲストを照合し、一致した場合のみ予約情報を返す"""
    today = _date.today().isoformat()
    bookings = _search_beds24_bookings(checkin_date=today)
    active = [b for b in bookings if b.get("status", "") not in ("-1", "cancelled", "2", "Cancelled")]

    # 物件でフィルタ（Beds24のProperty列は「美野島401」のように物件名+部屋が混在するため startswith で照合）
    property_matched = [
        b for b in active
        if b["property_name"].strip().startswith(data.property_name.strip())
    ]
    if data.room_number:
        property_matched = [
            b for b in property_matched
            if b["room_number"].strip() == data.room_number.strip()
        ]

    if not property_matched:
        raise HTTPException(status_code=404, detail="本日のご予約が見つかりません")

    # 名前または予約番号（Beds24 Ref / Airbnb ApiRef 両対応）で照合
    normalized_input = _normalize_name(data.guest_input)
    input_stripped = data.guest_input.strip()
    matched_booking = None
    for b in property_matched:
        name_match = normalized_input and (
            normalized_input in _normalize_name(b["guest_name"])
            or _normalize_name(b["guest_name"]) in normalized_input
        )
        ref_match = (
            input_stripped == b["booking_id"].strip()
            or input_stripped == b.get("api_ref", "").strip()
        )
        if name_match or ref_match:
            matched_booking = b
            break

    if not matched_booking:
        raise HTTPException(
            status_code=403,
            detail="お名前が予約情報と一致しませんでした。ご確認の上、再度お試しください。",
        )

    return {"booking": matched_booking}


@app.get("/admin/checkin/today")
def get_admin_today_checkins(op: dict = Depends(require_auth)):
    """管理者用：今日のチェックイン一覧＋各部屋のキーコード"""
    today = _date.today().isoformat()
    bookings = _search_beds24_bookings(checkin_date=today)
    active = [b for b in bookings if b.get("status", "") not in ("-1", "cancelled", "2", "Cancelled")]

    db: Session = SessionLocal()
    result = []
    for b in active:
        key = (
            db.query(KeyCode)
            .filter(KeyCode.property_name == b["property_name"], KeyCode.room_number == b["room_number"])
            .first()
        )
        result.append({**b, "key_code": key.code if key else None, "key_note": key.note if key else None})
    db.close()

    return {"date": today, "checkins": result}


@app.post("/checkin/verify")
def checkin_verify(data: CheckinVerifyRequest):
    if not data.booking_ref and not data.guest_name:
        raise HTTPException(status_code=400, detail="予約番号またはお名前を入力してください")

    search = data.booking_ref or data.guest_name
    bookings = _search_beds24_bookings(search=search, checkin_date=data.checkin_date)

    # キャンセルを除外
    active = [b for b in bookings if b.get("status", "") not in ("-1", "cancelled", "2", "Cancelled")]
    if not active:
        raise HTTPException(status_code=404, detail="予約が見つかりません。予約番号・お名前・日付をご確認ください。")

    return {"bookings": active[:5]}


@app.post("/checkin/submit")
def checkin_submit(data: CheckinSubmitRequest):
    db: Session = SessionLocal()
    record = CheckinRecord(
        booking_id=data.booking_id,
        property_name=data.property_name,
        room_number=data.room_number,
        checkin_date=data.checkin_date,
        checkout_date=data.checkout_date,
        guest_name=data.guest_name,
        guest_name_kana=data.guest_name_kana,
        guest_address=data.guest_address,
        guest_phone=data.guest_phone,
        guest_nationality=data.guest_nationality,
        passport_number=data.passport_number,
        guest_count=data.guest_count,
    )
    db.add(record)
    db.commit()

    key = (
        db.query(KeyCode)
        .filter(KeyCode.property_name == data.property_name, KeyCode.room_number == data.room_number)
        .first()
    )
    key_code = key.code if key else None
    key_note = key.note if key else None
    db.close()

    return {
        "status": "ok",
        "key_code": key_code,
        "key_note": key_note,
        "checkin_date": data.checkin_date,
        "checkout_date": data.checkout_date,
    }


# ── キーコード管理 ─────────────────────────────────────────────────────────────

@app.get("/admin/key-codes")
def list_key_codes(op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    codes = db.query(KeyCode).order_by(KeyCode.property_name, KeyCode.room_number).all()
    result = [
        {
            "id": k.id,
            "property_name": k.property_name,
            "room_number": k.room_number,
            "code": k.code,
            "note": k.note,
            "created_at": k.created_at,
        }
        for k in codes
    ]
    db.close()
    return {"key_codes": result}


@app.post("/admin/key-codes")
def create_key_code(data: KeyCodeRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    key = KeyCode(
        property_name=data.property_name,
        room_number=data.room_number,
        code=data.code,
        note=data.note,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    key_id = key.id
    db.close()
    return {"status": "ok", "id": key_id}


@app.put("/admin/key-codes/{key_id}")
def update_key_code(key_id: int, data: KeyCodeRequest, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    key = db.query(KeyCode).filter(KeyCode.id == key_id).first()
    if not key:
        db.close()
        raise HTTPException(status_code=404, detail="not found")
    key.property_name = data.property_name
    key.room_number = data.room_number
    key.code = data.code
    key.note = data.note
    db.commit()
    db.close()
    return {"status": "ok"}


@app.delete("/admin/key-codes/{key_id}")
def delete_key_code(key_id: int, op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    key = db.query(KeyCode).filter(KeyCode.id == key_id).first()
    if not key:
        db.close()
        raise HTTPException(status_code=404, detail="not found")
    db.delete(key)
    db.commit()
    db.close()
    return {"status": "ok"}


# ── 宿泊者名簿（管理者向け） ──────────────────────────────────────────────────

@app.get("/admin/checkin-records")
def list_checkin_records(op: dict = Depends(require_auth)):
    db: Session = SessionLocal()
    records = db.query(CheckinRecord).order_by(CheckinRecord.id.desc()).all()
    result = [
        {
            "id": r.id,
            "booking_id": r.booking_id,
            "property_name": r.property_name,
            "room_number": r.room_number,
            "checkin_date": r.checkin_date,
            "checkout_date": r.checkout_date,
            "guest_name": r.guest_name,
            "guest_name_kana": r.guest_name_kana,
            "guest_address": r.guest_address,
            "guest_phone": r.guest_phone,
            "guest_nationality": r.guest_nationality,
            "passport_number": r.passport_number,
            "guest_count": r.guest_count,
            "created_at": r.created_at,
        }
        for r in records
    ]
    db.close()
    return {"checkin_records": result}