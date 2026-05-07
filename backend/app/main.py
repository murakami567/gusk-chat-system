from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import Base
from .database import SessionLocal
from .database import engine
from .models import ChatRoom
from .models import Message
from .models import MessageTemplate

Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StartChatRequest(BaseModel):
    property_name: str
    room_number: str
    guest_contact: str | None = None
    category: str | None = None


class MessageRequest(BaseModel):
    sender_type: str
    message: str

class TemplateRequest(BaseModel):
    property_name: str
    category: str
    title: str
    body: str
    is_emergency: str = "false"
    active: str = "true"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/guest/chat/start")
def start_chat(data: StartChatRequest):
    db: Session = SessionLocal()

    room = ChatRoom(
        property_name=data.property_name,
        room_number=data.room_number,
        guest_contact=data.guest_contact,
        category=data.category,
    )

    db.add(room)
    db.commit()
    db.refresh(room)

    room_id = room.id

    template = (
    db.query(MessageTemplate)
    .filter(MessageTemplate.property_name == data.property_name)
    .filter(MessageTemplate.category == data.category)
    .filter(MessageTemplate.active == "true")
    .first()
)

reply_text = (
    template.body
    if template
    else "お問い合わせありがとうございます。内容を確認します。"
)

system_message = Message(
    chat_room_id=room_id,
    sender_type="system",
    message=reply_text,
)

    db.add(system_message)
    db.commit()

    db.close()

    return {
        "chat_room_id": room_id,
    }


@app.post("/guest/chat/{chat_room_id}/messages")
def send_message(chat_room_id: int, data: MessageRequest):
    db: Session = SessionLocal()

    room = db.query(ChatRoom).filter(ChatRoom.id == chat_room_id).first()

    if not room:
        raise HTTPException(status_code=404, detail="room not found")

    msg = Message(
        chat_room_id=chat_room_id,
        sender_type=data.sender_type,
        message=data.message,
    )

    db.add(msg)
    db.commit()
    db.refresh(msg)

    db.close()

    return {
        "status": "ok",
    }


@app.get("/guest/chat/{chat_room_id}/messages")
def get_messages(chat_room_id: int):
    db: Session = SessionLocal()

    messages = (
        db.query(Message)
        .filter(Message.chat_room_id == chat_room_id)
        .order_by(Message.id.asc())
        .all()
    )

    result = []

    for m in messages:
        result.append({
            "id": m.id,
            "chat_room_id": m.chat_room_id,
            "sender_type": m.sender_type,
            "message": m.message,
            "created_at": m.created_at,
        })

    db.close()

    return {
        "messages": result,
    }


@app.get("/operator/chat-rooms")
def get_chat_rooms():
    db: Session = SessionLocal()

    rooms = db.query(ChatRoom).order_by(ChatRoom.id.desc()).all()

    result = []

    for r in rooms:
        result.append({
            "id": r.id,
            "property_name": r.property_name,
            "room_number": r.room_number,
            "guest_contact": r.guest_contact,
            "category": r.category,
            "status": r.status,
            "assigned_operator": r.assigned_operator,
        })

    db.close()

    return {
        "chat_rooms": result,
    }


@app.patch("/operator/chat-rooms/{chat_room_id}/status")
def update_status(chat_room_id: int, status: str):
    db: Session = SessionLocal()

    room = db.query(ChatRoom).filter(ChatRoom.id == chat_room_id).first()

    if not room:
        raise HTTPException(status_code=404, detail="room not found")

    room.status = status

    db.commit()

    db.close()

    return {
        "status": "ok",
    }

@app.get("/operator/templates")
def get_templates():
    db: Session = SessionLocal()

    templates = db.query(MessageTemplate).order_by(MessageTemplate.id.desc()).all()

    result = []

    for t in templates:
        result.append({
            "id": t.id,
            "property_name": t.property_name,
            "category": t.category,
            "title": t.title,
            "body": t.body,
            "is_emergency": t.is_emergency,
            "active": t.active,
            "created_at": t.created_at,
        })

    db.close()

    return {
        "templates": result,
    }


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
    )

    db.add(template)
    db.commit()
    db.refresh(template)

    template_id = template.id

    db.close()

    return {
        "status": "ok",
        "template_id": template_id,
    }


@app.patch("/operator/templates/{template_id}")
def update_template(template_id: int, data: TemplateRequest):
    db: Session = SessionLocal()

    template = db.query(MessageTemplate).filter(MessageTemplate.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="template not found")

    template.property_name = data.property_name
    template.category = data.category
    template.title = data.title
    template.body = data.body
    template.is_emergency = data.is_emergency
    template.active = data.active

    db.commit()

    db.close()

    return {
        "status": "ok",
    }


@app.delete("/operator/templates/{template_id}")
def delete_template(template_id: int):
    db: Session = SessionLocal()

    template = db.query(MessageTemplate).filter(MessageTemplate.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="template not found")

    db.delete(template)
    db.commit()

    db.close()

    return {
        "status": "ok",
    }
