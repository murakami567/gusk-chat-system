import importlib

from fastapi import BackgroundTasks, HTTPException

main_module = importlib.import_module("app.main")
guard_module = importlib.import_module("app.security_message_guard")

app = main_module.app
guard_module.install_message_permission_guard(app, main_module.SECRET_KEY)


def _normalize_key(value: str | None) -> str:
    return (value or "").strip().lower().replace(" ", "").replace("　", "")


def _template_payload(template):
    return {"id": template.id, "title": template.title, "body": template.body}


def _remove_route(path: str, method: str):
    app.router.routes = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", None) == path
            and method.upper() in getattr(route, "methods", set())
        )
    ]


_remove_route("/guest/chat/{chat_room_id}/select-category", "POST")


@app.post("/guest/chat/{chat_room_id}/select-category")
def select_category_with_flexible_template_match(
    chat_room_id: int,
    data: main_module.SelectCategoryRequest,
    background_tasks: BackgroundTasks,
):
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

    if cat.is_escalation:
        room.mode = "operator"
        room.status = "unassigned"
        db.commit()

        db.add(main_module.Message(
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
            main_module._send_escalation_email,
            chat_room_id,
            property_name,
            room_number,
            category_name,
            guest_contact,
        )
        background_tasks.add_task(
            main_module._send_lineworks_notification,
            (
                f"【緊急対応が必要です】\n"
                f"物件：{property_name}\n"
                f"部屋：{room_number}号室\n"
                f"カテゴリ：{category_name}\n"
                f"連絡先：{guest_contact or '未登録'}\n"
                f"チャットID：{chat_room_id}"
            ),
        )
        return {"escalated": True, "templates": []}

    room_property_key = _normalize_key(room.property_name)

    candidates = (
        db.query(main_module.MessageTemplate)
        .filter(main_module.MessageTemplate.category == cat.name)
        .filter(main_module.MessageTemplate.active == "true")
        .filter(main_module.MessageTemplate.parent_id.is_(None))
        .order_by(main_module.MessageTemplate.id.asc())
        .all()
    )

    exact_templates = [
        template for template in candidates
        if (template.property_name or "").strip() == (room.property_name or "").strip()
    ]
    normalized_templates = [
        template for template in candidates
        if _normalize_key(template.property_name) == room_property_key
    ]
    shared_templates = [
        template for template in candidates
        if not (template.property_name or "").strip()
    ]

    templates = exact_templates or normalized_templates or shared_templates
    result = [_template_payload(template) for template in templates]

    db.close()
    return {"escalated": False, "templates": result}
