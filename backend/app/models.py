from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from .database import Base


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    property_name = Column(String, nullable=True)  # NULL = 全物件共通
    is_escalation = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id = Column(Integer, primary_key=True, index=True)
    property_name = Column(String)
    room_number = Column(String)
    guest_contact = Column(String, nullable=True)
    category = Column(String, nullable=True)
    status = Column(String, default="unassigned")
    assigned_operator = Column(String, nullable=True)
    mode = Column(String, default="bot")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    chat_room_id = Column(Integer, ForeignKey("chat_rooms.id"))
    sender_type = Column(String)
    message = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class MessageTemplate(Base):
    __tablename__ = "message_templates"

    id = Column(Integer, primary_key=True, index=True)
    property_name = Column(String)
    category = Column(String)
    title = Column(String)
    body = Column(String)
    is_emergency = Column(String, default="false")
    active = Column(String, default="true")
    parent_id = Column(Integer, ForeignKey("message_templates.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

