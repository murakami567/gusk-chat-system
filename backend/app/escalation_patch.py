import os
import smtplib
from email.mime.text import MIMEText

from fastapi import BackgroundTasks, HTTPException

ESCALATION_NOTIFY_EMAIL = "airbnb@gusk.jp"


def is_emergency_value(value) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes", "緊急"}


def is_emergency_category(category) -> bool:
    name = str(getattr(category, "name", "") or "")
    return bool(getattr(category, "is_escalation", False)) or "緊急" in name


def send_escalation_email(main_module, room_id, property_name, room_number, category, guest_contact):
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    notify_from = os.getenv("NOTIFY_EMAIL_FROM", smtp_user)
    notify_to = os.getenv("NOTIFY_EMAIL_TO", ESCALATION_NOTIFY_EMAIL) or ESCALATION_NOTIFY_EMAIL

    if not all([smtp_host, smtp_user, smtp_password, notify_from, notify_to]):
        return

    body = (
        "エスカレーションが発生しました。\n\n"
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


def remove_route(app, path: str, method: str):
    app.router.routes = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", None) == path
            and method.upper() in getattr(route, "methods", set())
        )
    ]


def escalate_room(db, main_module, room, category_name: str):
    room.mode = "operator"
    room.status = "unassigned"
    db.commit()

    db.add(main_module.Message(
        chat_room_id=room.id,
        sender_type="system",
        message="担当スタッフに接続しています。しばらくお待ちください。",
    ))
    db.commit()


def notify_escalation(background_tasks, main_module, room, category_name: str):
    background_tasks.add_task(
        send_escalation_email,
        main_module,
        room.id,
        room.property_name,
        room.room_number,
        category_name,
        room.guest_contact,
    )
    background_tasks.add_task(
        main_module._send_lineworks_notification,
        (
            "【緊急対応が必要です】\n"
            f"物件：{room.property_name}\n"
            f"部屋：{room.room_number}号室\n"
            f"カテゴリ：{category_name}\n"
            f"連絡先：{room.guest_contact or '未登録'}\n"
            f"チャットID：{room.id}"
        ),
    )


def template_payload(template):
    return {"id": template.id, "title": template.title, "body": template.body}


def install_escalation_patch(app, main_module):
    main_module._send_escalation_email = lambda room_id, property_name, room_number, category, guest_contact: send_escalation_email(
        main_module, room_id, property_name, room_number, category, guest_contact
    )

    remove_route(app, "/guest/chat/{chat_room_id}/select-category", "POST")
    remove_route(app, "/guest/chat/{chat_room_id}/select-template", "POST")

    @app.post("/guest/chat/{chat_room_id}/select-category")
    def select_category(chat_room_id: int, data: main_module.SelectCategoryRequest, background_tasks: BackgroundTasks):
        db = main_module.SessionLocal()

        room = db.query(main_module.ChatRoom).filter(main_module.ChatRoom.id == chat_room_id).first()
        if not room:
            db.close()
            raise HTTPException(status_code=404, detail="room not found")

        cat = db.query(main_module.Category).filter(main_module.Category.id == data.category_id).first()
        if not cat:
            db.close()
            raise HTTPException(status_code=404, detail="category not found")

        room.category = cat.name
        db.commit()

        db.add(main_module.Message(chat_room_id=chat_room_id, sender_type="guest", message=cat.name))
        db.commit()

        if is_emergency_category(cat):
            property_name = room.property_name
            room_number = room.room_number
            category_name = cat.name
            guest_contact = room.guest_contact
            room_id = room.id

            escalate_room(db, main_module, room, category_name)
            db.close()

            background_tasks.add_task(send_escalation_email, main_module, room_id, property_name, room_number, category_name, guest_contact)
            background_tasks.add_task(
                main_module._send_lineworks_notification,
                (
                    "【緊急対応が必要です】\n"
                    f"物件：{property_name}\n"
                    f"部屋：{room_number}号室\n"
                    f"カテゴリ：{category_name}\n"
                    f"連絡先：{guest_contact or '未登録'}\n"
                    f"チャットID：{room_id}"
                ),
            )
            return {"escalated": True, "templates": []}

        room_property_key = main_module._normalize_name(room.property_name)
        candidates = (
            db.query(main_module.MessageTemplate)
            .filter(main_module.MessageTemplate.category == cat.name)
            .filter(main_module.MessageTemplate.active == "true")
            .filter(main_module.MessageTemplate.parent_id.is_(None))
            .order_by(main_module.MessageTemplate.id.asc())
            .all()
        )
        templates = [t for t in candidates if main_module._normalize_name(t.property_name or "") == room_property_key]
        result = [template_payload(t) for t in templates]
        db.close()
        return {"escalated": False, "templates": result}

    @app.post("/guest/chat/{chat_room_id}/select-template")
    def select_template(chat_room_id: int, data: main_module.SelectTemplateRequest, background_tasks: BackgroundTasks):
        db = main_module.SessionLocal()

        room = db.query(main_module.ChatRoom).filter(main_module.ChatRoom.id == chat_room_id).first()
        if not room:
            db.close()
            raise HTTPException(status_code=404, detail="room not found")

        template = db.query(main_module.MessageTemplate).filter(main_module.MessageTemplate.id == data.template_id).first()
        if not template:
            db.close()
            raise HTTPException(status_code=404, detail="template not found")

        db.add(main_module.Message(chat_room_id=chat_room_id, sender_type="guest", message=template.title))
        db.commit()

        if template.body:
            db.add(main_module.Message(chat_room_id=chat_room_id, sender_type="system", message=template.body))
            db.commit()

        if is_emergency_value(template.is_emergency):
            property_name = room.property_name
            room_number = room.room_number
            guest_contact = room.guest_contact
            category_name = template.category or room.category or template.title
            room_id = room.id

            escalate_room(db, main_module, room, category_name)
            db.close()

            background_tasks.add_task(send_escalation_email, main_module, room_id, property_name, room_number, category_name, guest_contact)
            background_tasks.add_task(
                main_module._send_lineworks_notification,
                (
                    "【緊急対応が必要です】\n"
                    f"物件：{property_name}\n"
                    f"部屋：{room_number}号室\n"
                    f"カテゴリ：{category_name}\n"
                    f"連絡先：{guest_contact or '未登録'}\n"
                    f"チャットID：{room_id}"
                ),
            )
            return {"children": [], "escalated": True}

        children = (
            db.query(main_module.MessageTemplate)
            .filter(main_module.MessageTemplate.parent_id == template.id)
            .filter(main_module.MessageTemplate.active == "true")
            .order_by(main_module.MessageTemplate.id.asc())
            .all()
        )
        result = [template_payload(c) for c in children]
        db.close()
        return {"children": result, "escalated": False}
