import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const API_BASE = "https://gusk-chat-system.onrender.com";

function GuestPage() {
  const [roomId, setRoomId] = useState(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  async function startChat() {
    const res = await fetch(`${API_BASE}/guest/chat/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: "FFFホテル",
        room_number: "1001",
        guest_contact: "test@example.com",
        category: "鍵・入室",
      }),
    });

    const data = await res.json();
    setRoomId(data.chat_room_id);
    loadMessages(data.chat_room_id);
  }

  async function loadMessages(id = roomId) {
    if (!id) return;
    const res = await fetch(`${API_BASE}/guest/chat/${id}/messages`);
    const data = await res.json();
    setMessages(data.messages || []);
  }

  async function sendMessage() {
    if (!roomId || !message.trim()) return;

    await fetch(`${API_BASE}/guest/chat/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender_type: "guest",
        message,
      }),
    });

    setMessage("");
    loadMessages(roomId);
  }

  return (
    <div style={{ maxWidth: 430, margin: "0 auto", minHeight: "100vh", padding: 16 }}>
      <h2>ゲストサポート</h2>

      {!roomId && (
        <button onClick={startChat} style={{ width: "100%", padding: 12 }}>
          チャット開始
        </button>
      )}

      {roomId && (
        <>
          <p>チャットID: {roomId}</p>

          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minHeight: 300 }}>
            {messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 8 }}>
                <b>{m.sender_type}</b>: {m.message}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ flex: 1, padding: 10 }}
              placeholder="メッセージ"
            />
            <button onClick={sendMessage}>送信</button>
          </div>
        </>
      )}
    </div>
  );
}

function OperatorPage() {
  const [rooms, setRooms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");

  async function loadRooms() {
    const res = await fetch(`${API_BASE}/operator/chat-rooms`);
    const data = await res.json();
    setRooms(data.chat_rooms || []);

    if (!selected && data.chat_rooms?.length > 0) {
      selectRoom(data.chat_rooms[0]);
    }
  }

  async function selectRoom(room) {
    setSelected(room);
    const res = await fetch(`${API_BASE}/guest/chat/${room.id}/messages`);
    const data = await res.json();
    setMessages(data.messages || []);
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;

    await fetch(`${API_BASE}/guest/chat/${selected.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender_type: "operator",
        message: reply,
      }),
    });

    setReply("");
    selectRoom(selected);
  }

  async function updateStatus(status) {
    if (!selected) return;

    const res = await fetch(
      `${API_BASE}/operator/chat-rooms/${selected.id}/status?status=${status}`,
      { method: "PATCH" }
    );

    const data = await res.json();
    setSelected(data.room);
    loadRooms();
  }

  useEffect(() => {
    loadRooms();
    const timer = setInterval(loadRooms, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e5e7eb" }}>
      <header style={{ height: 56, background: "#020617", borderBottom: "1px solid #1e293b", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <b>Support Console</b>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>10:00〜19:00</span>
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "3fr 6fr 3fr", gap: 12, padding: 12, height: "calc(100vh - 56px)" }}>
        <aside style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 12, overflow: "auto" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #1e293b" }}>チャット一覧</div>

          <div style={{ padding: 8 }}>
            {rooms.map((room) => (
              <div
                key={room.id}
                onClick={() => selectRoom(room)}
                style={{
                  padding: 12,
                  marginBottom: 8,
                  borderRadius: 10,
                  cursor: "pointer",
                  border: "1px solid #1e293b",
                  background: selected?.id === room.id ? "#1e293b" : "#020617",
                }}
              >
                <div style={{ fontWeight: "bold" }}>
                  {room.property_name} {room.room_number}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  {room.category || "カテゴリ未設定"}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: "#93c5fd" }}>{room.status}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>#{room.id}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 12, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between" }}>
            <div>
              {selected ? `${selected.property_name} ${selected.room_number}` : "チャット未選択"}
            </div>
            <span>{selected?.status}</span>
          </div>

          <div style={{ flex: 1, padding: 16, overflow: "auto" }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  background: m.sender_type === "guest" ? "#1e293b" : "#1d4ed8",
                  padding: 12,
                  borderRadius: 10,
                  marginBottom: 10,
                  maxWidth: "75%",
                  marginLeft: m.sender_type === "guest" ? 0 : "auto",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.7 }}>{m.sender_type}</div>
                {m.message}
              </div>
            ))}
          </div>

          <div style={{ padding: 12, borderTop: "1px solid #1e293b", display: "flex", gap: 8 }}>
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="返信内容"
              style={{ flex: 1, background: "#0f172a", color: "white", border: "1px solid #334155", borderRadius: 8, padding: 10 }}
            />
            <button onClick={sendReply} style={{ background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "0 16px" }}>
              送信
            </button>
          </div>
        </section>

        <aside style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
          <b>対応情報</b>

          {selected && (
            <>
              <div style={{ marginTop: 12, fontSize: 14, color: "#cbd5e1" }}>
                <div>物件: {selected.property_name}</div>
                <div>部屋: {selected.room_number}</div>
                <div>連絡先: {selected.guest_contact || "-"}</div>
                <div>カテゴリ: {selected.category || "-"}</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
                <button onClick={() => updateStatus("in_progress")} style={{ background: "#2563eb", color: "white", padding: 10, borderRadius: 8, border: 0 }}>対応中</button>
                <button onClick={() => updateStatus("on_hold")} style={{ background: "#d97706", color: "white", padding: 10, borderRadius: 8, border: 0 }}>保留</button>
                <button onClick={() => updateStatus("closed")} style={{ background: "#059669", color: "white", padding: 10, borderRadius: 8, border: 0 }}>完了</button>
                <button onClick={() => updateStatus("unassigned")} style={{ background: "#e11d48", color: "white", padding: 10, borderRadius: 8, border: 0 }}>未対応</button>
              </div>

              <div style={{ marginTop: 16, background: "rgba(127,29,29,0.4)", border: "1px solid #b91c1c", borderRadius: 8, padding: 12 }}>
                緊急連絡
                <div style={{ fontWeight: "bold" }}>092-xxx-xxxx</div>
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

function App() {
  const path = window.location.pathname;

  if (path.startsWith("/operator")) {
    return <OperatorPage />;
  }

  return <GuestPage />;
}

createRoot(document.getElementById("root")).render(<App />);
