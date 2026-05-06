from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

chat_rooms = []
chat_messages = []


class StartChatRequest(BaseModel):
    property_name: str = "未設定"
    room_number: str = "未設定"
    guest_contact: str | None = None
    category: str | None = None


class MessageRequest(BaseModel):
    sender_type: str
    message: str


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/guest/chat/start")
def start_chat(data: StartChatRequest):
    chat_room_id = len(chat_rooms) + 1

    room = {
        "id": chat_room_id,
        "property_name": data.property_name,
        "room_number": data.room_number,
        "guest_contact": data.guest_contact,
        "category": data.category,
        "status": "unassigned",
        "mode": "bot",
        "assigned_operator": None,
        "created_at": datetime.now().isoformat(),
    }

    chat_rooms.append(room)

    chat_messages.append({
        "id": len(chat_messages) + 1,
        "chat_room_id": chat_room_id,
        "sender_type": "system",
        "message": "お問い合わせありがとうございます。内容を確認します。",
        "created_at": datetime.now().isoformat(),
    })

    return {
        "chat_room_id": chat_room_id,
        "room": room,
    }


@app.post("/guest/chat/{chat_room_id}/messages")
def send_guest_message(chat_room_id: int, data: MessageRequest):
    room = next((r for r in chat_rooms if r["id"] == chat_room_id), None)

    if not room:
        raise HTTPException(status_code=404, detail="chat room not found")

    msg = {
        "id": len(chat_messages) + 1,
        "chat_room_id": chat_room_id,
        "sender_type": data.sender_type,
        "message": data.message,
        "created_at": datetime.now().isoformat(),
    }

    chat_messages.append(msg)

    return {
        "status": "ok",
        "message": msg,
    }


@app.get("/guest/chat/{chat_room_id}/messages")
def get_guest_messages(chat_room_id: int):
    room = next((r for r in chat_rooms if r["id"] == chat_room_id), None)

    if not room:
        raise HTTPException(status_code=404, detail="chat room not found")

    messages = [
        m for m in chat_messages
        if m["chat_room_id"] == chat_room_id
    ]

    return {
        "chat_room_id": chat_room_id,
        "messages": messages,
    }


@app.get("/operator/chat-rooms")
def get_operator_chat_rooms():
    return {
        "chat_rooms": chat_rooms,
    }


@app.patch("/operator/chat-rooms/{chat_room_id}/status")
def update_chat_status(chat_room_id: int, status: str):
    room = next((r for r in chat_rooms if r["id"] == chat_room_id), None)

    if not room:
        raise HTTPException(status_code=404, detail="chat room not found")

    room["status"] = status

    return {
        "status": "ok",
        "room": room,
    }
