import React, { useState } from "react";
import { createRoot } from "react-dom/client";

const API_BASE = "https://gusk-chat-system.onrender.com";

function App() {
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
        category: "鍵・入室"
      })
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
        message
      })
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

createRoot(document.getElementById("root")).render(<App />);
