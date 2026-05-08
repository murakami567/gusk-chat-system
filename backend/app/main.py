import os
import smtplib
from email.mime.text import MIMEText

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine
from .models import Category, ChatRoom, Message, MessageTemplate, Property, Setting

Base.metadata.create_all(bind=engine)

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
        conn.commit()

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


class UpdateRoomInfoRequest(BaseModel):
    guest_contact: str | None = None
    category: str | None = None
    assigned_operator: str | None = None
    checkin_date: str | None = None


# ── ヘルパー ──────────────────────────────────────────────────────────────────

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


# ── 物件管理 ──────────────────────────────────────────────────────────────────

@app.get("/properties")
def get_properties():
    db: Session = SessionLocal()
    props = db.query(Property).order_by(Property.name.asc()).all()
    result = [{"id": p.id, "name": p.name, "created_at": p.created_at} for p in props]
    db.close()
    return {"properties": result}


@app.post("/properties")
def create_property(data: PropertyRequest):
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
def delete_property(property_id: int):
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
def upsert_setting(key: str, data: SettingRequest):
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
def create_category(data: CategoryRequest):
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
def update_category(category_id: int, data: CategoryRequest):
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
def delete_category(category_id: int):
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
def get_chat_rooms():
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
def update_room_info(chat_room_id: int, data: UpdateRoomInfoRequest):
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
def update_status(chat_room_id: int, status: str):
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
def create_template(data: TemplateRequest):
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
def update_template(template_id: int, data: TemplateRequest):
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
def delete_template(template_id: int):
    db: Session = SessionLocal()
    template = db.query(MessageTemplate).filter(MessageTemplate.id == template_id).first()
    if not template:
        db.close()
        raise HTTPException(status_code=404, detail="template not found")
    db.delete(template)
    db.commit()
    db.close()
    return {"status": "ok"}