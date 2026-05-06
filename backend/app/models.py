from sqlalchemy import Column
from sqlalchemy import DateTime
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy.sql import func

from .database import Base


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id = Column(Integer, primary_key=True, index=True)

    property_name = Column(String)
    room_number = Column(String)
    guest_contact = Column(String)

    category = Column(String)

    status = Column(String, default="unassigned")

    assigned_operator = Column(String, nullable=True)

    mode = Column(String, default="bot")

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)

    chat_room_id = Column(Integer)

    sender_type = Column(String)

    message = Column(String)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
