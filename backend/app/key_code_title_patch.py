from fastapi import Body, Depends, HTTPException
from sqlalchemy import text


def remove_route(app, path: str, method: str):
    app.router.routes = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", None) == path
            and method.upper() in getattr(route, "methods", set())
        )
    ]


def ensure_key_code_title_column(main_module):
    with main_module.engine.connect() as conn:
        conn.execute(text("ALTER TABLE key_codes ADD COLUMN IF NOT EXISTS title VARCHAR"))
        conn.commit()


def key_code_dict(k):
    return {
        "id": k.id,
        "property_name": k.property_name,
        "room_number": k.room_number,
        "title": getattr(k, "title", None) or "キーコード",
        "code": k.code,
        "note": k.note,
        "created_at": k.created_at,
    }


def install_key_code_title_patch(app, main_module):
    ensure_key_code_title_column(main_module)

    remove_route(app, "/admin/key-codes", "GET")
    remove_route(app, "/admin/key-codes", "POST")
    remove_route(app, "/admin/key-codes/{key_id}", "PUT")

    @app.get("/admin/key-codes")
    def list_key_codes(op: dict = Depends(main_module.require_auth)):
        db = main_module.SessionLocal()
        codes = db.query(main_module.KeyCode).order_by(
            main_module.KeyCode.property_name,
            main_module.KeyCode.room_number,
            main_module.KeyCode.id,
        ).all()
        result = [key_code_dict(k) for k in codes]
        db.close()
        return {"key_codes": result}

    @app.post("/admin/key-codes")
    def create_key_code(data: dict = Body(...), op: dict = Depends(main_module.require_auth)):
        db = main_module.SessionLocal()
        key = main_module.KeyCode(
            property_name=data.get("property_name"),
            room_number=data.get("room_number"),
            title=data.get("title") or "キーコード",
            code=data.get("code"),
            note=data.get("note"),
        )
        db.add(key)
        db.commit()
        db.refresh(key)
        key_id = key.id
        db.close()
        return {"status": "ok", "id": key_id}

    @app.put("/admin/key-codes/{key_id}")
    def update_key_code(key_id: int, data: dict = Body(...), op: dict = Depends(main_module.require_auth)):
        db = main_module.SessionLocal()
        key = db.query(main_module.KeyCode).filter(main_module.KeyCode.id == key_id).first()
        if not key:
            db.close()
            raise HTTPException(status_code=404, detail="not found")
        key.property_name = data.get("property_name")
        key.room_number = data.get("room_number")
        key.title = data.get("title") or "キーコード"
        key.code = data.get("code")
        key.note = data.get("note")
        db.commit()
        db.close()
        return {"status": "ok"}
