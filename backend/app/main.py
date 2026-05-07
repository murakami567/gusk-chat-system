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

    system_message = Message(
        chat_room_id=room_id,
        sender_type="system",
        message="お問い合わせありがとうございます。内容を確認します。",
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
