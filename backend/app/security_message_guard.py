import json
import re
from typing import Awaitable, Callable

import jwt


_MESSAGE_PATH_RE = re.compile(r"^/guest/chat/\d+/messages$")


class MessagePermissionGuardMiddleware:
    """Protect the public guest message endpoint from sender spoofing.

    The legacy endpoint accepts sender_type in the request body. This guard keeps
    guest clients working while ensuring only authenticated operators can send
    operator messages, and system messages remain server-only.
    """

    def __init__(self, app, secret_key: str):
        self.app = app
        self.secret_key = secret_key

    async def __call__(self, scope, receive, send):
        if (
            scope.get("type") != "http"
            or scope.get("method") != "POST"
            or not _MESSAGE_PATH_RE.match(scope.get("path", ""))
        ):
            await self.app(scope, receive, send)
            return

        body = await _read_body(receive)

        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except Exception:
            await _send_json(send, 400, {"detail": "Invalid JSON body"})
            return

        sender_type = payload.get("sender_type") or "guest"

        if sender_type == "guest":
            payload["sender_type"] = "guest"
        elif sender_type == "operator":
            if not _has_valid_operator_token(scope, self.secret_key):
                await _send_json(send, 401, {"detail": "Operator authentication required"})
                return
        else:
            await _send_json(send, 400, {"detail": "Invalid sender_type"})
            return

        new_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        new_scope = _replace_content_length(scope, len(new_body))

        async def replay_receive():
            return {"type": "http.request", "body": new_body, "more_body": False}

        await self.app(new_scope, replay_receive, send)


async def _read_body(receive: Callable[[], Awaitable[dict]]) -> bytes:
    chunks = []
    more_body = True

    while more_body:
        message = await receive()
        if message.get("type") != "http.request":
            continue
        chunks.append(message.get("body", b""))
        more_body = message.get("more_body", False)

    return b"".join(chunks)


def _has_valid_operator_token(scope, secret_key: str) -> bool:
    headers = {k.lower(): v for k, v in scope.get("headers", [])}
    auth = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")

    if not auth.startswith("Bearer "):
        return False

    try:
        decoded = jwt.decode(auth[7:], secret_key, algorithms=["HS256"])
    except Exception:
        return False

    return bool(decoded.get("sub"))


def _replace_content_length(scope, length: int):
    scope = dict(scope)
    headers = [
        (k, v)
        for k, v in scope.get("headers", [])
        if k.lower() != b"content-length"
    ]
    headers.append((b"content-length", str(length).encode("ascii")))
    scope["headers"] = headers
    return scope


async def _send_json(send, status_code: int, payload: dict):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


def install_message_permission_guard(app, secret_key: str):
    if getattr(app.state, "message_permission_guard_installed", False):
        return

    app.add_middleware(MessagePermissionGuardMiddleware, secret_key=secret_key)
    app.state.message_permission_guard_installed = True
