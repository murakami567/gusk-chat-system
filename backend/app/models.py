from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from .database import Base


class Property(Base):
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    checkin_guide = Column(String, nullable=True)
    beds24_property_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


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
    checkin_date = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    chat_room_id = Column(Integer, ForeignKey("chat_rooms.id"))
    sender_type = Column(String)
    message = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Operator(Base):
    __tablename__ = "operators"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, nullable=False, unique=True)
    display_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
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


class KeyCode(Base):
    __tablename__ = "key_codes"

    id = Column(Integer, primary_key=True, index=True)
    property_name = Column(String, nullable=False)
    room_number = Column(String, nullable=False)
    code = Column(String, nullable=False)
    note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CheckinRecord(Base):
    __tablename__ = "checkin_records"

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(String, nullable=True)
    property_name = Column(String, nullable=False)
    room_number = Column(String, nullable=False)
    checkin_date = Column(String, nullable=False)
    checkout_date = Column(String, nullable=True)
    guest_name = Column(String, nullable=False)
    guest_name_kana = Column(String, nullable=True)
    guest_address = Column(String, nullable=True)
    guest_phone = Column(String, nullable=True)
    guest_nationality = Column(String, nullable=True)
    passport_number = Column(String, nullable=True)
    guest_count = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
