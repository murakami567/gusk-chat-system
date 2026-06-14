from fastapi import HTTPException


def remove_route(app, path: str, method: str):
    app.router.routes = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", None) == path
            and method.upper() in getattr(route, "methods", set())
        )
    ]


def install_operator_reply_status_patch(app, main_module):
    remove_route(app, "/guest/chat/{chat_room_id}/messages", "POST")

    @app.post("/guest/chat/{chat_room_id}/messages")
    def send_message(chat_room_id: int, data: main_module.MessageRequest):
        db = main_module.SessionLocal()

        room = db.query(main_module.ChatRoom).filter(main_module.ChatRoom.id == chat_room_id).first()
        if not room:
            db.close()
            raise HTTPException(status_code=404, detail="room not found")

        db.add(main_module.Message(
            chat_room_id=chat_room_id,
            sender_type=data.sender_type,
            message=data.message,
        ))

        if data.sender_type == "operator" and room.status != "closed":
            room.status = "in_progress"
            room.mode = "operator"

        db.commit()
        db.close()

        return {"status": "ok"}
