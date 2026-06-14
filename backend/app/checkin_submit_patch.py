from sqlalchemy import text


def ensure_checkin_record_columns(main_module):
    with main_module.engine.connect() as conn:
        conn.execute(text("ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS checkout_date VARCHAR"))
        conn.execute(text("ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS guest_name_kana VARCHAR"))
        conn.execute(text("ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS guest_address VARCHAR"))
        conn.execute(text("ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS guest_phone VARCHAR"))
        conn.execute(text("ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS guest_nationality VARCHAR"))
        conn.execute(text("ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS passport_number VARCHAR"))
        conn.execute(text("ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS guest_count INTEGER DEFAULT 1"))
        conn.commit()


def normalize_key(value):
    return str(value or "").strip().lower().replace(" ", "").replace("　", "")


def find_key_code(db, main_module, property_name, room_number):
    property_key = normalize_key(property_name)
    room_key = normalize_key(room_number)

    key_codes = db.query(main_module.KeyCode).all()
    for item in key_codes:
        if normalize_key(item.property_name) == property_key and normalize_key(item.room_number) == room_key:
            return item

    return None


def install_checkin_submit_route(app, main_module):
    ensure_checkin_record_columns(main_module)

    def remove_route(path: str, method: str):
        app.router.routes = [
            route
            for route in app.router.routes
            if not (
                getattr(route, "path", None) == path
                and method.upper() in getattr(route, "methods", set())
            )
        ]

    remove_route("/checkin/submit", "POST")

    @app.post("/checkin/submit")
    def submit_checkin(data: main_module.CheckinSubmitRequest):
        db = main_module.SessionLocal()
        record_id = None
        key_code_value = None
        key_note_value = None

        try:
            record = main_module.CheckinRecord(
                booking_id=data.booking_id,
                property_name=data.property_name,
                room_number=data.room_number,
                checkin_date=data.checkin_date,
                checkout_date=data.checkout_date,
                guest_name=data.guest_name,
                guest_name_kana=data.guest_name_kana,
                guest_address=data.guest_address,
                guest_phone=data.guest_phone,
                guest_nationality=data.guest_nationality,
                passport_number=data.passport_number,
                guest_count=data.guest_count,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            record_id = record.id

            key_code = find_key_code(db, main_module, data.property_name, data.room_number)
            if key_code:
                key_code_value = key_code.code
                key_note_value = key_code.note
        finally:
            db.close()

        return {
            "status": "ok",
            "checkin_record_id": record_id,
            "key_code": key_code_value,
            "key_note": key_note_value,
        }
