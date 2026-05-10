import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const API_BASE = "https://gusk-chat-system.onrender.com";

function compressImage(file, maxWidth = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("not an image")); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function getAuth() {
  try {
    return {
      token: localStorage.getItem("op_token"),
      operator: JSON.parse(localStorage.getItem("op_info") || "null"),
    };
  } catch {
    return { token: null, operator: null };
  }
}
function setAuth(token, operator) {
  localStorage.setItem("op_token", token);
  localStorage.setItem("op_info", JSON.stringify(operator));
}
function clearAuth() {
  localStorage.removeItem("op_token");
  localStorage.removeItem("op_info");
}
async function authFetch(url, options = {}) {
  const { token } = getAuth();
  const headers = { ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { clearAuth(); window.location.href = "/login"; }
  return res;
}

function ChatImage({ src, className = "" }) {
  return (
    <img
      src={src}
      alt="画像"
      className={`rounded-xl max-w-full cursor-pointer ${className}`}
      onClick={() => window.open(src, "_blank")}
    />
  );
}

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
  if (filter === "escalated") return roomList.filter((r) => r.mode === "operator");
  return roomList.filter((room) => room.status === filter);
}

// ── オペレーターページ ─────────────────────────────────────────────────────────

function OperatorPage() {
  const [rooms, setRooms] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");
  const [settings, setSettings] = useState({
    hours_start: "10:00",
    hours_end: "19:00",
    emergency_phone: "",
    emergency_message: "",
  });
  const [currentOperator, setCurrentOperator] = useState(null);
  const [allCategories, setAllCategories] = useState([]);
  const [infoEditing, setInfoEditing] = useState(false);
  const [infoForm, setInfoForm] = useState({ guest_contact: "", category: "", assigned_operator: "", checkin_date: "" });
  const [guestHistory, setGuestHistory] = useState([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [expandedHistoryMessages, setExpandedHistoryMessages] = useState([]);
  const imageInputRef = useRef(null);
  const prevEscalatedIds = useRef(new Set());

  const selected = rooms.find((r) => r.id === selectedId) ?? null;
  const filteredRooms = useMemo(() => filterRooms(rooms, filter), [rooms, filter]);
  const counts = useMemo(() => getStatusCounts(rooms), [rooms]);
  const escalatedCount = useMemo(() => rooms.filter((r) => r.mode === "operator").length, [rooms]);

  useEffect(() => {
    const { token, operator } = getAuth();
    if (!token) { window.location.href = "/login"; return; }
    setCurrentOperator(operator);
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    fetch(`${API_BASE}/settings`).then((r) => r.json()).then((d) => setSettings(d));
    fetch(`${API_BASE}/categories`).then((r) => r.json()).then((d) => setAllCategories(d.categories || []));
  }, []);

  useEffect(() => {
    setInfoEditing(false);
    setGuestHistory([]);
    setExpandedHistoryId(null);
    setExpandedHistoryMessages([]);
    if (selected?.guest_contact) {
      fetch(
        `${API_BASE}/guest/chat/history?contact=${encodeURIComponent(selected.guest_contact)}&exclude_id=${selected.id}`
      )
        .then((r) => r.json())
        .then((d) => setGuestHistory(d.history || []));
    }
  }, [selectedId]);

  async function loadRooms() {
    const res = await authFetch(`${API_BASE}/operator/chat-rooms`);
    const data = await res.json();
    const list = data.chat_rooms || [];

    const newEscalated = list.filter((r) => r.mode === "operator");
    newEscalated.forEach((room) => {
      if (!prevEscalatedIds.current.has(room.id) && Notification.permission === "granted") {
        new Notification("【対応必要】エスカレーション", {
          body: `${room.property_name} ${room.room_number}号室 - ${room.category || "カテゴリ未設定"}`,
        });
      }
    });
    prevEscalatedIds.current = new Set(newEscalated.map((r) => r.id));

    setRooms(list);
    setSelectedId((prev) => {
      if (!prev && list.length > 0) {
        loadMessages(list[0].id);
        return list[0].id;
      }
      return prev;
    });
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
      body: JSON.stringify({ sender_type: "operator", message: reply }),
    });
    setReply("");
    await loadMessages(selected.id);
  }

  async function updateStatus(status) {
    if (!selected) return;
    await authFetch(`${API_BASE}/operator/chat-rooms/${selected.id}/status?status=${status}`, {
      method: "PATCH",
    });
    await loadRooms();
  }

  async function toggleHistoryExpand(roomId) {
    if (expandedHistoryId === roomId) {
      setExpandedHistoryId(null);
      setExpandedHistoryMessages([]);
      return;
    }
    setExpandedHistoryId(roomId);
    const res = await fetch(`${API_BASE}/guest/chat/${roomId}/messages`);
    const data = await res.json();
    setExpandedHistoryMessages(data.messages || []);
  }

  async function sendImage(file) {
    if (!selected || !file) return;
    try {
      const base64 = await compressImage(file);
      await fetch(`${API_BASE}/guest/chat/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_type: "operator", message: base64 }),
      });
      await loadMessages(selected.id);
    } catch {
      alert("画像の送信に失敗しました");
    }
  }

  async function saveRoomInfo() {
    if (!selected) return;
    await authFetch(`${API_BASE}/operator/chat-rooms/${selected.id}/info`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(infoForm),
    });
    setInfoEditing(false);
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
          {escalatedCount > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 animate-pulse">
              <Icon label="!" className="rounded-full bg-red-100 text-red-600" />
              エスカレーション {escalatedCount}件
            </div>
          )}
          <div className="hidden md:flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            <Icon label="⏱" /> 有人対応時間内 {settings.hours_start}〜{settings.hours_end}
          </div>
          <a href="/templates" className="rounded-full bg-slate-900 text-white px-4 py-2 text-sm">
            テンプレート管理
          </a>
          <div className="flex items-center gap-3 border-l border-slate-200 pl-3">
            <span className="text-sm text-slate-600">{currentOperator?.display_name}</span>
            <button
              onClick={() => { clearAuth(); window.location.href = "/login"; }}
              className="text-xs text-slate-500 underline"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-12 gap-4 p-4 h-[calc(100vh-64px)]">
        {/* 左カラム：チャットルーム一覧 */}
        <aside className="col-span-12 lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-xl px-3 py-2 text-sm border ${
                  filter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
                }`}
              >
                すべて
              </button>
              <button
                onClick={() => setFilter("escalated")}
                className={`rounded-xl px-3 py-2 text-sm border ${
                  filter === "escalated" ? "bg-red-600 text-white border-red-600" : "bg-white border-red-200 text-red-600"
                }`}
              >
                要対応 {escalatedCount > 0 ? escalatedCount : ""}
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
                } ${room.mode === "operator" ? "border-l-4 border-l-red-400" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold flex items-center gap-2">
                      {room.mode === "operator" && (
                        <Icon label="!" className="rounded-full bg-red-100 text-red-600" />
                      )}
                      {room.property_name} {room.room_number}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{room.category || "カテゴリ未選択"}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs px-2 py-1 rounded-full border ${STATUS[room.status]?.className || ""}`}>
                      {STATUS[room.status]?.label || room.status}
                    </span>
                    {room.mode === "operator" && (
                      <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200">
                        有人対応
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-3 line-clamp-1">
                  {room.guest_contact || "連絡先未登録"}
                </p>
                <div className="text-xs text-slate-400 mt-1">#{room.id}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* 中央カラム：チャット */}
        <section className="col-span-12 lg:col-span-6 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg">
                {selected ? `${selected.property_name} / ${selected.room_number}号室` : "チャット未選択"}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                カテゴリ：{selected?.category || "-"} / ID：{selected?.id || "-"} /
                モード：{selected?.mode === "operator" ? "有人対応" : "ボット"}
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
                      {message.sender_type === "system" ? "ボット" : message.sender_type}・
                      {new Date(message.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    {message.message.startsWith("data:image/") ? (
                      <ChatImage src={message.message} className="mt-1" />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-200 bg-white">
            <div className="flex items-center gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.shiftKey && !e.isComposing && sendReply()}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 outline-none text-sm"
                placeholder="メッセージを入力（Shift+Enter で送信）"
              />
              <label className="rounded-xl border border-slate-200 px-3 py-3 cursor-pointer hover:bg-slate-50 flex items-center">
                <Icon label="🖼" />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { if (e.target.files[0]) { sendImage(e.target.files[0]); e.target.value = ""; } }}
                />
              </label>
              <button
                onClick={sendReply}
                className="rounded-xl bg-slate-900 text-white px-4 py-3 flex items-center gap-2"
              >
                <Icon label="➤" /> 送信
              </button>
            </div>
          </div>
        </section>

        {/* 右カラム：対応情報 */}
        <aside className="col-span-12 lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2">
              <Icon label="人" /> 対応情報
            </h3>
            {selected && !infoEditing && (
              <button
                onClick={() => {
                  setInfoForm({
                    guest_contact: selected.guest_contact || "",
                    category: selected.category || "",
                    assigned_operator: selected.assigned_operator || "",
                    checkin_date: selected.checkin_date || "",
                  });
                  setInfoEditing(true);
                }}
                className="text-xs text-blue-600 underline"
              >
                編集
              </button>
            )}
          </div>

          {selected && (
            <div className="p-4 space-y-5">
              {!infoEditing ? (
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
                    <span className="text-slate-500">カテゴリ</span>
                    <span className="font-medium">{selected.category || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">チェックイン日</span>
                    <span className="font-medium">{selected.checkin_date || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">担当者</span>
                    <span className="font-medium">{selected.assigned_operator || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">モード</span>
                    <span className={`font-medium ${selected.mode === "operator" ? "text-red-600" : "text-slate-700"}`}>
                      {selected.mode === "operator" ? "有人対応" : "ボット"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <label className="text-xs text-slate-500">連絡先</label>
                    <input
                      value={infoForm.guest_contact}
                      onChange={(e) => setInfoForm({ ...infoForm, guest_contact: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
                      placeholder="電話番号 / メール"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">カテゴリ</label>
                    <select
                      value={infoForm.category}
                      onChange={(e) => setInfoForm({ ...infoForm, category: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none bg-white"
                    >
                      <option value="">未選択</option>
                      {allCategories.map((c) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">チェックイン日</label>
                    <input
                      type="date"
                      value={infoForm.checkin_date}
                      onChange={(e) => setInfoForm({ ...infoForm, checkin_date: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">担当者</label>
                    <input
                      value={infoForm.assigned_operator}
                      onChange={(e) => setInfoForm({ ...infoForm, assigned_operator: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
                      placeholder="担当者名"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveRoomInfo}
                      className="flex-1 rounded-xl bg-blue-600 text-white py-2.5 text-sm font-bold"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setInfoEditing(false)}
                      className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )}

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

              {(settings.emergency_phone || settings.emergency_message) && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <div className="font-bold text-red-700 flex items-center gap-2">
                    <Icon label="☎" /> 時間外・緊急案内
                  </div>
                  {settings.emergency_message && (
                    <p className="text-sm text-red-700 mt-2">{settings.emergency_message}</p>
                  )}
                  {settings.emergency_phone && (
                    <div className="mt-3 text-lg font-bold text-red-800">{settings.emergency_phone}</div>
                  )}
                </div>
              )}

              {selected.guest_contact && (
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                    過去の対応履歴
                  </div>
                  {guestHistory.length === 0 ? (
                    <p className="text-xs text-slate-400">過去の対応履歴なし</p>
                  ) : (
                    <div className="space-y-2">
                      {guestHistory.map((h) => (
                        <div key={h.id} className="rounded-xl border border-slate-200 overflow-hidden text-sm">
                          <button
                            onClick={() => toggleHistoryExpand(h.id)}
                            className="w-full p-3 text-left flex items-start justify-between gap-2 hover:bg-slate-50"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs text-slate-400">#{h.id}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded-full border ${STATUS[h.status]?.className || ""}`}>
                                  {STATUS[h.status]?.label || h.status}
                                </span>
                              </div>
                              <div className="text-xs text-slate-600 mt-0.5">{h.category || "カテゴリ未設定"}</div>
                              {h.last_message && (
                                <p className="text-xs text-slate-400 mt-1 truncate">{h.last_message}</p>
                              )}
                              <div className="text-xs text-slate-300 mt-1">
                                {new Date(h.created_at).toLocaleDateString("ja-JP")}
                              </div>
                            </div>
                            <span className="text-xs text-blue-600 shrink-0 mt-0.5">
                              {expandedHistoryId === h.id ? "閉じる" : "詳細"}
                            </span>
                          </button>
                          {expandedHistoryId === h.id && (
                            <div className="bg-slate-50 border-t border-slate-200 max-h-52 overflow-y-auto p-3 space-y-2">
                              {expandedHistoryMessages.map((m) => (
                                <div
                                  key={m.id}
                                  className={`flex ${m.sender_type === "guest" ? "justify-start" : "justify-end"}`}
                                >
                                  <div
                                    className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                                      m.sender_type === "guest"
                                        ? "bg-white border border-slate-200"
                                        : "bg-slate-200 text-slate-700"
                                    }`}
                                  >
                                    <div className="opacity-50 mb-0.5">
                                      {m.sender_type === "system" ? "ボット" : m.sender_type}
                                    </div>
                                    {m.message.startsWith("data:image/") ? (
                                      <ChatImage src={m.message} className="max-w-[160px]" />
                                    ) : (
                                      <p className="whitespace-pre-wrap">{m.message}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

// ── ゲストページ ───────────────────────────────────────────────────────────────

function GuestPage() {
  const params = new URLSearchParams(window.location.search);
  const propertyFromUrl = params.get("property") || "";
  const roomFromUrl = params.get("room") || "";
  const isStayLink = Boolean(propertyFromUrl && roomFromUrl);

  const [roomId, setRoomId] = useState(null);
  const [propertyName, setPropertyName] = useState(propertyFromUrl);
  const [roomNumber, setRoomNumber] = useState(roomFromUrl);
  const [guestContact, setGuestContact] = useState("");
  const [messages, setMessages] = useState([]);
  const [textInput, setTextInput] = useState("");
  const [properties, setProperties] = useState([]);

  // ボットフロー状態: "form" | "category" | "templates" | "escalated" | "chat"
  const [botPhase, setBotPhase] = useState("form");
  const [categories, setCategories] = useState([]);
  const [templateStack, setTemplateStack] = useState([]);
  const [pendingEscalationCat, setPendingEscalationCat] = useState(null);
  const [escalationNote, setEscalationNote] = useState("");

  const currentTemplates = templateStack[templateStack.length - 1] || [];
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetch(`${API_BASE}/properties`)
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []));
  }, []);

  async function startChat() {
    if (!propertyName) { alert("物件を選択してください"); return; }
    if (!guestContact.trim()) { alert("メールアドレスまたは電話番号を入力してください"); return; }

    const res = await fetch(`${API_BASE}/guest/chat/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: propertyName,
        room_number: roomNumber || "未設定",
        guest_contact: guestContact,
      }),
    });
    const data = await res.json();
    const id = data.chat_room_id;
    setRoomId(id);
    await loadMessages(id);

    const catRes = await fetch(`${API_BASE}/categories?property_name=${encodeURIComponent(propertyName)}`);
    const catData = await catRes.json();
    setCategories(catData.categories || []);
    setBotPhase("category");
  }

  async function selectCategory(cat) {
    if (cat.is_escalation) {
      setPendingEscalationCat(cat);
      setEscalationNote("");
      setBotPhase("escalation_form");
      return;
    }

    const res = await fetch(`${API_BASE}/guest/chat/${roomId}/select-category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: cat.id }),
    });
    const data = await res.json();
    await loadMessages(roomId);

    if (data.escalated) {
      setBotPhase("escalated");
    } else if (data.templates.length > 0) {
      setTemplateStack([data.templates]);
      setBotPhase("templates");
    } else {
      setBotPhase("chat");
    }
  }

  async function submitEscalationForm() {
    if (!escalationNote.trim()) { alert("お問い合わせ内容をご記入ください"); return; }

    await fetch(`${API_BASE}/guest/chat/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender_type: "guest", message: escalationNote }),
    });

    const res = await fetch(`${API_BASE}/guest/chat/${roomId}/select-category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: pendingEscalationCat.id }),
    });
    const data = await res.json();
    await loadMessages(roomId);

    setPendingEscalationCat(null);
    setEscalationNote("");
    setBotPhase(data.escalated ? "escalated" : "chat");
  }

  async function selectTemplate(template) {
    const res = await fetch(`${API_BASE}/guest/chat/${roomId}/select-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: template.id }),
    });
    const data = await res.json();
    await loadMessages(roomId);

    if (data.children.length > 0) {
      setTemplateStack((prev) => [...prev, data.children]);
    } else {
      setBotPhase("resolved_check");
    }
  }

  function goBackTemplates() {
    if (templateStack.length <= 1) {
      setTemplateStack([]);
      setBotPhase("category");
    } else {
      setTemplateStack((prev) => prev.slice(0, -1));
    }
  }

  function goBackToCategory() {
    setTemplateStack([]);
    setBotPhase("category");
  }

  async function loadMessages(id = roomId) {
    if (!id) return;
    const res = await fetch(`${API_BASE}/guest/chat/${id}/messages`);
    const data = await res.json();
    const msgs = data.messages || [];
    setMessages(msgs);

    // オペレーターがメッセージを送信したら、どのフェーズでも返信入力を有効化
    const hasOperatorMessage = msgs.some((m) => m.sender_type === "operator");
    if (hasOperatorMessage) {
      setBotPhase((prev) =>
        prev === "escalated" || prev === "chat" ? prev : "chat"
      );
    }
  }

  async function sendTextMessage() {
    if (!roomId || !textInput.trim()) return;
    await fetch(`${API_BASE}/guest/chat/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender_type: "guest", message: textInput }),
    });
    setTextInput("");
    loadMessages(roomId);
  }

  async function sendImageMessage(file) {
    if (!roomId || !file) return;
    try {
      const base64 = await compressImage(file);
      await fetch(`${API_BASE}/guest/chat/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_type: "guest", message: base64 }),
      });
      loadMessages(roomId);
    } catch {
      alert("画像の送信に失敗しました");
    }
  }

  useEffect(() => {
    if (!roomId) return;
    const timer = setInterval(() => loadMessages(roomId), 3000);
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

          {/* ── フォーム画面 ── */}
          {botPhase === "form" && (
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
                    <select
                      value={propertyName}
                      onChange={(e) => setPropertyName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none bg-white"
                    >
                      <option value="">選択してください</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.name}>{p.name}</option>
                      ))}
                    </select>
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
                  placeholder="例：guest@example.com / 090-xxxx-xxxx"
                />
              </div>

              <button
                onClick={startChat}
                className="w-full rounded-xl bg-blue-600 text-white py-3 font-bold"
              >
                チャットを開始
              </button>
            </section>
          )}

          {/* ── チャット履歴（フォーム以外で常に表示）── */}
          {botPhase !== "form" && (
            <>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500">
                {propertyName} {roomNumber && `${roomNumber}号室`} / チャットID：{roomId}
              </div>

              <div className="space-y-3">
                {messages.map((m) => {
                  const isGuest = m.sender_type === "guest";
                  return (
                    <div key={m.id} className={`flex ${isGuest ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${
                          isGuest ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {m.message.startsWith("data:image/") ? (
                          <ChatImage src={m.message} />
                        ) : (
                          <p className="whitespace-pre-wrap">{m.message}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </>
          )}

          {/* ── カテゴリ選択 ── */}
          {botPhase === "category" && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-700">お問い合わせ内容をお選びください</p>
              <div className="grid grid-cols-2 gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => selectCategory(cat)}
                    className={`rounded-xl border px-3 py-4 text-sm text-left font-medium transition ${
                      cat.is_escalation
                        ? "bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                        : "bg-white border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {cat.is_escalation && <span className="block text-xs text-red-500 mb-1">緊急</span>}
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── テンプレート選択（段階的） ── */}
          {botPhase === "templates" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">詳しい内容をお選びください</p>
                <button onClick={goBackTemplates} className="text-xs text-blue-600 underline">
                  {templateStack.length <= 1 ? "カテゴリに戻る" : "前に戻る"}
                </button>
              </div>
              <div className="space-y-2">
                {currentTemplates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => selectTemplate(tmpl)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-left hover:bg-slate-50 transition"
                  >
                    {tmpl.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── エスカレーション前：問い合わせ内容入力 ── */}
          {botPhase === "escalation_form" && (
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 space-y-4">
              <div>
                <p className="text-sm font-bold text-slate-700">{pendingEscalationCat?.name}</p>
                <p className="text-xs text-slate-500 mt-1">
                  担当スタッフに繋ぐ前に、お困りの内容をご記入ください。
                </p>
              </div>
              <textarea
                value={escalationNote}
                onChange={(e) => setEscalationNote(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none min-h-[100px] resize-none"
                placeholder="例：カードキーが反応しない。フロントに電話したが繋がらない。"
              />
              <button
                onClick={submitEscalationForm}
                className="w-full rounded-xl bg-red-600 text-white py-3 font-bold text-sm"
              >
                スタッフに連絡する
              </button>
              <button
                onClick={() => { setPendingEscalationCat(null); setBotPhase("category"); }}
                className="w-full text-xs text-slate-500 underline"
              >
                カテゴリに戻る
              </button>
            </div>
          )}

          {/* ── エスカレーション待機 ── */}
          {botPhase === "escalated" && (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-center space-y-2">
              <div className="text-2xl">📞</div>
              <p className="font-bold text-red-700">スタッフに接続中</p>
              <p className="text-sm text-red-600">担当スタッフがメッセージをご確認次第、対応いたします。</p>
            </div>
          )}

          {/* ── 解決確認 ── */}
          {botPhase === "resolved_check" && (
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 space-y-4">
              <p className="text-sm font-bold text-slate-700 text-center">問題は解決しましたか？</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setBotPhase("done")}
                  className="rounded-xl bg-emerald-600 text-white py-3 text-sm font-bold"
                >
                  はい
                </button>
                <button
                  onClick={() => setBotPhase(currentTemplates.length > 0 ? "related" : "chat")}
                  className="rounded-xl bg-slate-200 text-slate-800 py-3 text-sm font-bold"
                >
                  いいえ
                </button>
              </div>
            </div>
          )}

          {/* ── 関連する内容 ── */}
          {botPhase === "related" && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-700">他にお困りのことはありますか？</p>
              <div className="space-y-2">
                {currentTemplates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => selectTemplate(tmpl)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-left hover:bg-slate-50 transition"
                  >
                    {tmpl.title}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={goBackToCategory}
                  className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm text-slate-600"
                >
                  カテゴリに戻る
                </button>
                <button
                  onClick={() => setBotPhase("chat")}
                  className="flex-1 rounded-xl border border-blue-300 text-blue-700 py-2.5 text-sm"
                >
                  メッセージで相談
                </button>
              </div>
            </div>
          )}

          {/* ── 解決完了 ── */}
          {botPhase === "done" && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-center space-y-2">
              <div className="text-2xl">✓</div>
              <p className="font-bold text-emerald-700">解決できてよかったです</p>
              <p className="text-sm text-emerald-600">ご利用ありがとうございました。</p>
              <button
                onClick={goBackToCategory}
                className="mt-2 text-xs text-slate-500 underline"
              >
                別の問題を相談する
              </button>
            </div>
          )}

          {/* ── 自由入力チャット ── */}
          {botPhase === "chat" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">他にご不明な点がありましたらご入力ください</p>
                <button onClick={goBackToCategory} className="text-xs text-blue-600 underline">
                  カテゴリに戻る
                </button>
              </div>
            </div>
          )}
        </main>

        {/* ── フッター：自由入力エリア（escalated と chat モード） ── */}
        {(botPhase === "escalated" || botPhase === "chat") && (
          <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-slate-200 p-3">
            <div className="flex gap-2">
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                placeholder="メッセージを入力"
              />
              <label className="rounded-xl border border-slate-300 px-3 py-3 cursor-pointer hover:bg-slate-50 flex items-center">
                🖼
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { if (e.target.files[0]) { sendImageMessage(e.target.files[0]); e.target.value = ""; } }}
                />
              </label>
              <button
                onClick={sendTextMessage}
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

// ── テンプレート・カテゴリ管理ページ ──────────────────────────────────────────

function TemplatePage() {
  const [activeTab, setActiveTab] = useState("properties");
  const { operator: currentOp } = getAuth();

  useEffect(() => {
    if (!getAuth().token) { window.location.href = "/login"; }
  }, []);

  const tabs = [
    { key: "properties", label: "物件管理" },
    { key: "categories", label: "カテゴリ管理" },
    { key: "templates", label: "テンプレート管理" },
    { key: "settings", label: "対応情報" },
    ...(currentOp?.is_admin ? [{ key: "operators", label: "オペレーター管理" }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">管理ページ</h1>
          <p className="text-xs text-slate-500">物件・カテゴリ・テンプレート・対応情報の設定</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/operator" className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm">
            チャット管理へ
          </a>
          <div className="flex items-center gap-3 border-l border-slate-200 pl-3">
            <span className="text-sm text-slate-600">{currentOp?.display_name}</span>
            <button
              onClick={() => { clearAuth(); window.location.href = "/login"; }}
              className="text-xs text-slate-500 underline"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="px-6 pt-4 flex gap-2 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl px-5 py-2 text-sm font-medium border ${
              activeTab === tab.key ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="p-4">
        {activeTab === "properties" && <PropertySection />}
        {activeTab === "categories" && <CategorySection />}
        {activeTab === "templates" && <TemplateSection />}
        {activeTab === "settings" && <SettingsSection />}
        {activeTab === "operators" && currentOp?.is_admin && <OperatorsSection />}
      </main>
    </div>
  );
}

function SettingsSection() {
  const [form, setForm] = useState({
    hours_start: "",
    hours_end: "",
    emergency_phone: "",
    emergency_message: "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then((r) => r.json())
      .then((d) => setForm({
        hours_start: d.hours_start || "",
        hours_end: d.hours_end || "",
        emergency_phone: d.emergency_phone || "",
        emergency_message: d.emergency_message || "",
      }));
  }, []);

  async function save() {
    await Promise.all(
      Object.entries(form).map(([key, value]) =>
        authFetch(`${API_BASE}/settings/${key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        })
      )
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-xl">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
        <h2 className="font-bold text-lg">対応情報の設定</h2>

        <div>
          <label className="text-sm font-bold">有人対応時間</label>
          <div className="flex items-center gap-3 mt-1">
            <input
              type="time"
              value={form.hours_start}
              onChange={(e) => setForm({ ...form, hours_start: e.target.value })}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
            />
            <span className="text-slate-500 text-sm">〜</span>
            <input
              type="time"
              value={form.hours_end}
              onChange={(e) => setForm({ ...form, hours_end: e.target.value })}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">オペレーター画面のヘッダーに表示されます</p>
        </div>

        <div>
          <label className="text-sm font-bold">緊急電話番号</label>
          <input
            value={form.emergency_phone}
            onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
            placeholder="例：092-xxx-xxxx"
          />
        </div>

        <div>
          <label className="text-sm font-bold">時間外メッセージ</label>
          <textarea
            value={form.emergency_message}
            onChange={(e) => setForm({ ...form, emergency_message: e.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none min-h-[80px]"
            placeholder="例：19:00以降は緊急カテゴリのみ対応いたします。"
          />
          <p className="text-xs text-slate-400 mt-1">オペレーター画面の右パネルに表示されます</p>
        </div>

        <button
          onClick={save}
          className={`w-full rounded-xl py-3 font-bold text-sm transition ${
            saved ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
          }`}
        >
          {saved ? "保存しました" : "保存"}
        </button>
      </div>
    </div>
  );
}

function PropertySection() {
  const [properties, setProperties] = useState([]);
  const [name, setName] = useState("");

  async function load() {
    const res = await fetch(`${API_BASE}/properties`);
    const data = await res.json();
    setProperties(data.properties || []);
  }

  async function add() {
    if (!name.trim()) { alert("物件名を入力してください"); return; }
    const res = await authFetch(`${API_BASE}/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res?.ok) { alert("同じ物件名がすでに登録されています"); return; }
    setName("");
    load();
  }

  async function remove(id) {
    if (!confirm("この物件を削除しますか？")) return;
    await authFetch(`${API_BASE}/properties/${id}`, { method: "DELETE" });
    load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 lg:col-span-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <h2 className="font-bold text-lg mb-4">物件を追加</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold">物件名 <span className="text-red-500">*</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder="例：FFFホテル"
            />
          </div>
          <button onClick={add} className="w-full rounded-xl bg-blue-600 text-white py-3 font-bold text-sm">
            追加
          </button>
        </div>
      </section>

      <section className="col-span-12 lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-bold text-lg">登録済み物件</h2>
          <p className="text-xs text-slate-500">ゲストのチャット開始時に選択肢として表示されます</p>
        </div>
        <div className="divide-y divide-slate-200">
          {properties.length === 0 && (
            <div className="p-6 text-sm text-slate-500">物件が登録されていません。</div>
          )}
          {properties.map((p) => (
            <div key={p.id} className="px-5 py-4 flex items-center justify-between">
              <span className="font-medium">{p.name}</span>
              <button
                onClick={() => remove(p.id)}
                className="rounded-xl border border-red-200 text-red-600 px-3 py-2 text-sm"
              >
                削除
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CategorySection() {
  const [categories, setCategories] = useState([]);
  const [properties, setProperties] = useState([]);
  const [form, setForm] = useState({ name: "", property_name: "", is_escalation: false });
  const [editing, setEditing] = useState(null);

  async function load() {
    const [catRes, propRes] = await Promise.all([
      fetch(`${API_BASE}/categories`),
      fetch(`${API_BASE}/properties`),
    ]);
    const catData = await catRes.json();
    const propData = await propRes.json();
    setCategories(catData.categories || []);
    setProperties(propData.properties || []);
  }

  async function save() {
    if (!form.name.trim()) { alert("カテゴリ名を入力してください"); return; }
    const body = { name: form.name, property_name: form.property_name || null, is_escalation: form.is_escalation };

    if (editing) {
      await authFetch(`${API_BASE}/categories/${editing}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditing(null);
    } else {
      await authFetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setForm({ name: "", property_name: "", is_escalation: false });
    load();
  }

  async function remove(id) {
    if (!confirm("このカテゴリを削除しますか？")) return;
    await authFetch(`${API_BASE}/categories/${id}`, { method: "DELETE" });
    load();
  }

  function startEdit(cat) {
    setEditing(cat.id);
    setForm({ name: cat.name, property_name: cat.property_name || "", is_escalation: cat.is_escalation });
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 lg:col-span-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <h2 className="font-bold text-lg mb-4">{editing ? "カテゴリを編集" : "新規カテゴリ追加"}</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold">カテゴリ名 <span className="text-red-500">*</span></label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder="例：チェックインできない"
            />
          </div>
          <div>
            <label className="text-sm font-bold">物件名（未選択 = 全物件共通）</label>
            <select
              value={form.property_name}
              onChange={(e) => setForm({ ...form, property_name: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none bg-white"
            >
              <option value="">全物件共通</option>
              {properties.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_escalation}
              onChange={(e) => setForm({ ...form, is_escalation: e.target.checked })}
              className="w-4 h-4"
            />
            <div>
              <div className="text-sm font-bold text-red-700">即エスカレーション</div>
              <div className="text-xs text-red-500">選択時に24時間オペレーターへ転送</div>
            </div>
          </label>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 rounded-xl bg-blue-600 text-white py-3 font-bold text-sm">
              {editing ? "更新" : "追加"}
            </button>
            {editing && (
              <button
                onClick={() => { setEditing(null); setForm({ name: "", property_name: "", is_escalation: false }); }}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                キャンセル
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="col-span-12 lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-bold text-lg">登録済みカテゴリ</h2>
          <p className="text-xs text-slate-500">ゲストがチャット開始時に選ぶメニュー項目</p>
        </div>
        <div className="divide-y divide-slate-200">
          {categories.length === 0 && (
            <div className="p-6 text-sm text-slate-500">カテゴリが登録されていません。</div>
          )}
          {categories.map((cat) => (
            <div key={cat.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {cat.name}
                    {cat.is_escalation && (
                      <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs border border-red-200">
                        即エスカレーション
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {cat.property_name ? `物件：${cat.property_name}` : "全物件共通"}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => startEdit(cat)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  編集
                </button>
                <button
                  onClick={() => remove(cat.id)}
                  className="rounded-xl border border-red-200 text-red-600 px-3 py-2 text-sm"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TemplateSection() {
  const [templates, setTemplates] = useState([]);
  const [properties, setProperties] = useState([]);
  const [categories, setCategories] = useState([]);
  const [rootTemplates, setRootTemplates] = useState([]);
  const [form, setForm] = useState({
    property_name: "",
    category: "",
    title: "",
    body: "",
    is_emergency: "false",
    active: "true",
    parent_id: null,
  });

  async function loadTemplates() {
    const res = await authFetch(`${API_BASE}/operator/templates`);
    const data = await res.json();
    setTemplates(data.templates || []);
  }

  async function loadCategories() {
    const [catRes, propRes] = await Promise.all([
      fetch(`${API_BASE}/categories`),
      fetch(`${API_BASE}/properties`),
    ]);
    const catData = await catRes.json();
    const propData = await propRes.json();
    setCategories(catData.categories || []);
    setProperties(propData.properties || []);
  }

  async function loadRootTemplates(propertyName, category) {
    if (!propertyName || !category) { setRootTemplates([]); return; }
    const res = await authFetch(
      `${API_BASE}/operator/templates?property_name=${encodeURIComponent(propertyName)}&category=${encodeURIComponent(category)}&root_only=true`
    );
    const data = await res.json();
    setRootTemplates(data.templates || []);
  }

  async function createTemplate() {
    if (!form.property_name.trim()) { alert("物件名を入力してください"); return; }
    if (!form.category.trim()) { alert("カテゴリを選択してください"); return; }
    if (!form.title.trim()) { alert("タイトルを入力してください"); return; }
    if (!form.body.trim()) { alert("本文を入力してください"); return; }

    await authFetch(`${API_BASE}/operator/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setForm({ property_name: "", category: "", title: "", body: "", is_emergency: "false", active: "true", parent_id: null });
    loadTemplates();
  }

  async function deleteTemplate(id) {
    if (!confirm("このテンプレートを削除しますか？")) return;
    await authFetch(`${API_BASE}/operator/templates/${id}`, { method: "DELETE" });
    loadTemplates();
  }

  useEffect(() => { loadTemplates(); loadCategories(); }, []);

  useEffect(() => {
    loadRootTemplates(form.property_name, form.category);
  }, [form.property_name, form.category]);

  const categoryNames = [...new Set(categories.map((c) => c.name))];

  return (
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 lg:col-span-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <h2 className="font-bold text-lg mb-4">新規テンプレート作成</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold">物件名</label>
            <select
              value={form.property_name}
              onChange={(e) => setForm({ ...form, property_name: e.target.value, parent_id: null })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none bg-white"
            >
              <option value="">選択してください</option>
              {properties.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold">カテゴリ</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value, parent_id: null })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none bg-white"
            >
              <option value="">選択してください</option>
              {categoryNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold">親テンプレート（任意）</label>
            <select
              value={form.parent_id ?? ""}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value ? Number(e.target.value) : null })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none bg-white"
            >
              <option value="">なし（第1階層）</option>
              {rootTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-bold">タイトル（ボタン名）</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder="例：鍵の場所を確認したい"
            />
          </div>

          <div>
            <label className="text-sm font-bold">本文（ボット返信内容）</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="mt-1 w-full min-h-[120px] rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder="ゲストへの自動返信内容を入力してください"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="rounded-xl border border-slate-200 p-3 text-sm flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_emergency === "true"}
                onChange={(e) => setForm({ ...form, is_emergency: e.target.checked ? "true" : "false" })}
              />
              緊急カテゴリ
            </label>
            <label className="rounded-xl border border-slate-200 p-3 text-sm flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active === "true"}
                onChange={(e) => setForm({ ...form, active: e.target.checked ? "true" : "false" })}
              />
              有効
            </label>
          </div>

          <button onClick={createTemplate} className="w-full rounded-xl bg-blue-600 text-white py-3 font-bold">
            保存
          </button>
        </div>
      </section>

      <section className="col-span-12 lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">登録済みテンプレート</h2>
            <p className="text-xs text-slate-500">親テンプレートがあるものは子階層として表示されます</p>
          </div>
          <button onClick={loadTemplates} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">
            更新
          </button>
        </div>
        <div className="divide-y divide-slate-200">
          {templates.length === 0 && (
            <div className="p-6 text-sm text-slate-500">テンプレートが登録されていません。</div>
          )}
          {templates.map((t) => (
            <div key={t.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {t.parent_id && (
                      <span className="text-slate-400 text-sm">└</span>
                    )}
                    <span className="font-bold">{t.title}</span>
                    <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-xs">{t.property_name}</span>
                    <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs">{t.category}</span>
                    {t.parent_id && (
                      <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs">子テンプレート</span>
                    )}
                    {t.is_emergency === "true" && (
                      <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs">緊急</span>
                    )}
                    {t.active === "true" ? (
                      <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs">有効</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-xs">無効</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap line-clamp-3">{t.body}</p>
                </div>
                <button
                  onClick={() => deleteTemplate(t.id)}
                  className="shrink-0 rounded-xl border border-red-200 text-red-600 px-3 py-2 text-sm"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function OperatorsSection() {
  const [operators, setOperators] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ username: "", display_name: "", password: "", is_admin: false, is_active: true });

  async function load() {
    const res = await authFetch(`${API_BASE}/admin/operators`);
    if (!res) return;
    const data = await res.json();
    setOperators(data.operators || []);
  }

  async function save() {
    if (!form.display_name.trim()) { alert("表示名を入力してください"); return; }
    if (editing) {
      await authFetch(`${API_BASE}/admin/operators/${editing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: form.display_name, password: form.password || null, is_admin: form.is_admin, is_active: form.is_active }),
      });
      setEditing(null);
    } else {
      if (!form.username.trim()) { alert("ユーザー名を入力してください"); return; }
      if (!form.password.trim()) { alert("パスワードを入力してください"); return; }
      const res = await authFetch(`${API_BASE}/admin/operators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, display_name: form.display_name, password: form.password, is_admin: form.is_admin }),
      });
      if (!res?.ok) { alert("ユーザー名がすでに使用されています"); return; }
    }
    setForm({ username: "", display_name: "", password: "", is_admin: false, is_active: true });
    load();
  }

  async function remove(id) {
    if (!confirm("このオペレーターを削除しますか？")) return;
    await authFetch(`${API_BASE}/admin/operators/${id}`, { method: "DELETE" });
    load();
  }

  function startEdit(op) {
    setEditing(op.id);
    setForm({ username: op.username, display_name: op.display_name, password: "", is_admin: op.is_admin, is_active: op.is_active });
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 lg:col-span-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <h2 className="font-bold text-lg mb-4">{editing ? "オペレーターを編集" : "新規オペレーター追加"}</h2>
        <div className="space-y-4">
          {!editing ? (
            <div>
              <label className="text-sm font-bold">ユーザー名 <span className="text-red-500">*</span></label>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                placeholder="例：tanaka"
                autoComplete="off"
              />
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
              <span className="text-slate-500">ユーザー名：</span>
              <span className="font-medium">{form.username}</span>
            </div>
          )}
          <div>
            <label className="text-sm font-bold">表示名 <span className="text-red-500">*</span></label>
            <input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder="例：田中 太郎"
            />
          </div>
          <div>
            <label className="text-sm font-bold">
              パスワード
              {editing
                ? <span className="text-xs font-normal text-slate-400 ml-1">（空欄で変更なし）</span>
                : <span className="text-red-500"> *</span>}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder={editing ? "変更する場合のみ入力" : "パスワードを入力"}
              autoComplete="new-password"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm">管理者権限</span>
            </label>
            {editing && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
                <span className="text-sm">有効</span>
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 rounded-xl bg-blue-600 text-white py-3 font-bold text-sm">
              {editing ? "更新" : "追加"}
            </button>
            {editing && (
              <button
                onClick={() => { setEditing(null); setForm({ username: "", display_name: "", password: "", is_admin: false, is_active: true }); }}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                キャンセル
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="col-span-12 lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-bold text-lg">オペレーター一覧</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {operators.length === 0 && <div className="p-6 text-sm text-slate-500">オペレーターが登録されていません。</div>}
          {operators.map((op) => (
            <div key={op.id} className="px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {op.display_name}
                  {op.is_admin && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">管理者</span>}
                  {!op.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">無効</span>}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">@{op.username}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => startEdit(op)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">編集</button>
                <button onClick={() => remove(op.id)} className="rounded-xl border border-red-200 text-red-600 px-3 py-2 text-sm">削除</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getAuth().token) window.location.href = "/operator";
  }, []);

  async function login() {
    if (!username || !password) { setError("ユーザー名とパスワードを入力してください"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail || "ログインに失敗しました");
        return;
      }
      const d = await res.json();
      setAuth(d.token, d.operator);
      window.location.href = "/operator";
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold">オペレーターログイン</h1>
          <p className="text-xs text-slate-500 mt-1">ゲストチャット管理システム</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold">ユーザー名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && login()}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder="username"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="text-sm font-bold">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && login()}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
              placeholder="password"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
          <button
            onClick={login}
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 text-white py-3 font-bold text-sm disabled:opacity-50"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ルーティング ───────────────────────────────────────────────────────────────

function App() {
  if (window.location.pathname.startsWith("/login")) return <LoginPage />;
  if (window.location.pathname.startsWith("/templates")) return <TemplatePage />;
  if (window.location.pathname.startsWith("/operator")) return <OperatorPage />;
  return <GuestPage />;
}

createRoot(document.getElementById("root")).render(<App />);
