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
        finally:
            db.close()

        return {"status": "ok", "checkin_record_id": record_id}
