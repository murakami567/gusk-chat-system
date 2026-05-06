import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const API_BASE = "https://gusk-chat-system.onrender.com";

const STATUS = {
  unassigned: { label: "未対応", className: "bg-amber-100 text-amber-800 border-amber-200" },
  in_progress: { label: "対応中", className: "bg-blue-100 text-blue-800 border-blue-200" },
  on_hold: { label: "保留", className: "bg-purple-100 text-purple-800 border-purple-200" },
  closed: { label: "対応完了", className: "bg-slate-100 text-slate-700 border-slate-200" },
};

function Icon({ label, className = "" }) {
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center text-sm leading-none ${className}`}>
      {label}
    </span>
  );
}

function getStatusCounts(roomList) {
  return roomList.reduce((acc, room) => {
    acc[room.status] = (acc[room.status] || 0) + 1;
    return acc;
  }, {});
}

function filterRooms(roomList, filter) {
  if (filter === "all") return roomList;
  return roomList.filter((room) => room.status === filter);
}

function OperatorPage() {
  const [rooms, setRooms] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");

  const selected = rooms.find((room) => room.id === selectedId) ?? rooms[0] ?? null;

  const filteredRooms = useMemo(() => filterRooms(rooms, filter), [rooms, filter]);
  const counts = useMemo(() => getStatusCounts(rooms), [rooms]);

  async function loadRooms() {
    const res = await fetch(`${API_BASE}/operator/chat-rooms`);
    const data = await res.json();
    const list = data.chat_rooms || [];
    setRooms(list);

    if (!selectedId && list.length > 0) {
      setSelectedId(list[0].id);
      loadMessages(list[0].id);
    }
  }

  async function loadMessages(roomId) {
    if (!roomId) return;
    const res = await fetch(`${API_BASE}/guest/chat/${roomId}/messages`);
    const data = await res.json();
    setMessages(data.messages || []);
  }

  async function selectRoom(room) {
    setSelectedId(room.id);
    await loadMessages(room.id);
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
    await loadMessages(selected.id);
  }

  async function updateStatus(status) {
    if (!selected) return;

    await fetch(`${API_BASE}/operator/chat-rooms/${selected.id}/status?status=${status}`, {
      method: "PATCH",
    });

    await loadRooms();
  }

  useEffect(() => {
    loadRooms();
    const timer = setInterval(loadRooms, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
  }, [selectedId]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">ゲストチャット管理</h1>
          <p className="text-xs text-slate-500">物件別テンプレート + 有人切替</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            <Icon label="⏱" /> 有人対応時間内 10:00〜19:00
          </div>
          <div className="rounded-full bg-slate-900 text-white px-4 py-2 text-sm">田中 / オペレータ</div>
        </div>
      </header>

      <main className="grid grid-cols-12 gap-4 p-4 h-[calc(100vh-64px)]">
        <aside className="col-span-12 lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
              <Icon label="⌕" className="text-slate-400" />
              <input className="bg-transparent outline-none text-sm w-full" placeholder="物件・部屋で検索" />
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-xl px-3 py-2 text-sm border ${
                  filter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
                }`}
              >
                すべて
              </button>

              {Object.entries(STATUS).map(([key, item]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-xl px-3 py-2 text-sm border ${
                    filter === key ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
                  }`}
                >
                  {item.label} {counts[key] || 0}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto p-3 space-y-3">
            {filteredRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => selectRoom(room)}
                className={`w-full text-left rounded-2xl border p-4 transition ${
                  selected?.id === room.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold flex items-center gap-2">
                      {room.status === "unassigned" && (
                        <Icon label="!" className="rounded-full bg-red-100 text-red-600" />
                      )}
                      {room.property_name} {room.room_number}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{room.category || "カテゴリ未設定"}</div>
                  </div>

                  <span className={`text-xs px-2 py-1 rounded-full border ${STATUS[room.status]?.className || ""}`}>
                    {STATUS[room.status]?.label || room.status}
                  </span>
                </div>

                <p className="text-sm text-slate-600 mt-3 line-clamp-2">
                  {room.guest_contact || "連絡先未登録"}
                </p>

                <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
                  <span>担当：{room.assigned_operator || "未割当"}</span>
                  <span>#{room.id}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="col-span-12 lg:col-span-6 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Icon label="□" className="text-slate-500" />
                <h2 className="font-bold text-lg">
                  {selected ? `${selected.property_name} / ${selected.room_number}号室` : "チャット未選択"}
                </h2>
                {selected?.status === "unassigned" && (
                  <span className="rounded-full bg-red-100 text-red-700 px-2 py-1 text-xs">未対応</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                カテゴリ：{selected?.category || "-"} / チャットID：{selected?.id || "-"}
              </p>
            </div>

            {selected && (
              <span className={`text-xs px-3 py-1.5 rounded-full border ${STATUS[selected.status]?.className || ""}`}>
                {STATUS[selected.status]?.label || selected.status}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50">
            {messages.map((message) => {
              const isGuest = message.sender_type === "guest";
              const isSystem = message.sender_type === "system";

              return (
                <div key={message.id} className={`flex ${isGuest ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-sm ${
                      isGuest
                        ? "bg-white border border-slate-200"
                        : isSystem
                        ? "bg-slate-200 text-slate-700"
                        : "bg-slate-900 text-white"
                    }`}
                  >
                    <div className="text-xs opacity-70 mb-1">
                      {message.sender_type}・{new Date(message.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <p className="text-sm leading-relaxed">{message.message}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-200 bg-white">
            <div className="flex gap-2 mb-3 overflow-x-auto">
              {["鍵案内", "Wi-Fi", "駐車場", "チェックアウト", "緊急電話案内"].map((label) => (
                <button
                  key={label}
                  onClick={() => setReply(label)}
                  className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 outline-none text-sm"
                placeholder="メッセージを入力..."
              />
              <button
                onClick={sendReply}
                className="rounded-xl bg-slate-900 text-white px-4 py-3 flex items-center gap-2"
              >
                <Icon label="➤" /> 送信
              </button>
            </div>
          </div>
        </section>

        <aside className="col-span-12 lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-bold flex items-center gap-2">
              <Icon label="人" /> 対応情報
            </h3>
          </div>

          {selected && (
            <div className="p-4 space-y-5">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">物件</span>
                  <span className="font-medium">{selected.property_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">部屋</span>
                  <span className="font-medium">{selected.room_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">連絡先</span>
                  <span className="font-medium">{selected.guest_contact || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">担当</span>
                  <span className="font-medium">{selected.assigned_operator || "未割当"}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => updateStatus("in_progress")} className="rounded-xl bg-blue-600 text-white py-3 text-sm font-medium">
                  対応中
                </button>
                <button onClick={() => updateStatus("unassigned")} className="rounded-xl bg-slate-900 text-white py-3 text-sm font-medium">
                  未対応
                </button>
                <button onClick={() => updateStatus("on_hold")} className="rounded-xl bg-purple-100 text-purple-800 py-3 text-sm font-medium">
                  保留
                </button>
                <button onClick={() => updateStatus("closed")} className="rounded-xl bg-emerald-100 text-emerald-800 py-3 text-sm font-medium">
                  完了
                </button>
              </div>

              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <div className="font-bold text-red-700 flex items-center gap-2">
                  <Icon label="☎" /> 時間外・緊急案内
                </div>
                <p className="text-sm text-red-700 mt-2">19:00以降は緊急カテゴリのみ電話番号を表示します。</p>
                <div className="mt-3 text-lg font-bold text-red-800">092-xxx-xxxx</div>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function GuestPage() {
  const params = new URLSearchParams(window.location.search);

  const propertyFromUrl = params.get("property") || "";
  const roomFromUrl = params.get("room") || "";
  const isStayLink = Boolean(propertyFromUrl && roomFromUrl);

  const [roomId, setRoomId] = useState(null);
  const [propertyName, setPropertyName] = useState(propertyFromUrl);
  const [roomNumber, setRoomNumber] = useState(roomFromUrl);
  const [guestContact, setGuestContact] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  const categories = [
    "鍵・入室",
    "Wi-Fi",
    "駐車場",
    "チェックアウト",
    "設備トラブル",
    "忘れ物",
    "その他",
  ];

  async function startChat() {
    if (!propertyName.trim()) {
      alert("物件名を入力してください");
      return;
    }

    if (!guestContact.trim()) {
      alert("メールアドレスまたは電話番号を入力してください");
      return;
    }

    if (!category) {
      alert("お問い合わせ内容を選択してください");
      return;
    }

    const res = await fetch(`${API_BASE}/guest/chat/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: propertyName,
        room_number: roomNumber || "未設定",
        guest_contact: guestContact,
        category,
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

  useEffect(() => {
    if (!roomId) return;

    const timer = setInterval(() => {
      loadMessages(roomId);
    }, 3000);

    return () => clearInterval(timer);
  }, [roomId]);

  return (
    <div className="min-h-screen bg-white text-slate-900 flex justify-center">
      <div className="w-full max-w-[430px] min-h-screen border-x border-slate-200 flex flex-col">
        <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
          <h1 className="font-bold text-lg">ゲストサポート</h1>
          <p className="text-xs text-slate-500">
            {isStayLink ? `${propertyName} / ${roomNumber}号室` : "お問い合わせ"}
          </p>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-28">
          {!roomId && (
            <section className="space-y-4">
              {isStayLink ? (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">滞在中のお問い合わせ</div>
                  <div className="mt-1 font-bold">{propertyName}</div>
                  <div className="text-sm text-slate-600">{roomNumber}号室</div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-bold">物件名</label>
                    <input
                      value={propertyName}
                      onChange={(e) => setPropertyName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                      placeholder="例：FFFホテル"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-bold">部屋番号 任意</label>
                    <input
                      value={roomNumber}
                      onChange={(e) => setRoomNumber(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                      placeholder="例：1001"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-sm font-bold">メールアドレス または 電話番号</label>
                <input
                  value={guestContact}
                  onChange={(e) => setGuestContact(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                  placeholder="例：guest@example.com / 090..."
                />
              </div>

              <div>
                <label className="text-sm font-bold">お問い合わせ内容</label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {categories.map((item) => (
                    <button
                      key={item}
                      onClick={() => setCategory(item)}
                      className={`rounded-xl border px-3 py-3 text-sm text-left ${
                        category === item
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white border-slate-300"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={startChat}
                className="w-full rounded-xl bg-blue-600 text-white py-3 font-bold"
              >
                チャットを開始
              </button>
            </section>
          )}

          {roomId && (
            <>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500">
                チャットID：{roomId} / {propertyName} {roomNumber && `${roomNumber}号室`}
              </div>

              <div className="space-y-3">
                {messages.map((m) => {
                  const isGuest = m.sender_type === "guest";

                  return (
                    <div key={m.id} className={`flex ${isGuest ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${
                          isGuest
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        <div>{m.message}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>

        {roomId && (
          <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-slate-200 p-3">
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                placeholder="メッセージを入力"
              />
              <button
                onClick={sendMessage}
                className="rounded-xl bg-blue-600 text-white px-4 font-bold"
              >
                送信
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

function App() {
  if (window.location.pathname.startsWith("/operator")) {
    return <OperatorPage />;
  }

  return <GuestPage />;
}

createRoot(document.getElementById("root")).render(<App />);
