const fs = require("fs");
const path = require("path");

const mainPath = path.resolve(__dirname, "../src/main.jsx");
let source = fs.readFileSync(mainPath, "utf8");

const startMarker = "function KeyCodeSection() {";
const endMarker = "// ── 宿泊者名簿セクション";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  throw new Error("KeyCodeSection replacement target not found");
}

const replacement = String.raw`function KeyCodeSection() {
  const [keyCodes, setKeyCodes] = useState([]);
  const [properties, setProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomNumber, setRoomNumber] = useState("");
  const [items, setItems] = useState([{ title: "", code: "", note: "" }]);

  function propertyValue(p) {
    return (p.beds24_property_name || p.name || "").trim();
  }

  function propertyLabel(p) {
    const value = propertyValue(p);
    return {
      value,
      name: p.name || value,
      beds: p.beds24_property_name || "",
    };
  }

  function roomsFor(propertyName) {
    return [...new Set(
      keyCodes
        .filter((k) => k.property_name === propertyName)
        .map((k) => k.room_number)
        .filter(Boolean)
    )].sort((a, b) => String(a).localeCompare(String(b), "ja", { numeric: true }));
  }

  function codesFor(propertyName, room) {
    return keyCodes
      .filter((k) => k.property_name === propertyName && k.room_number === room)
      .sort((a, b) => (a.id || 0) - (b.id || 0));
  }

  async function load() {
    const [kcRes, propRes] = await Promise.all([
      authFetch(`${API_BASE}/admin/key-codes`),
      fetch(`${API_BASE}/properties`),
    ]);
    const kcData = await kcRes.json();
    const propData = await propRes.json();
    const nextProperties = propData.properties || [];

    setKeyCodes(kcData.key_codes || []);
    setProperties(nextProperties);

    setSelectedProperty((current) => {
      if (current) return current;
      return nextProperties[0] ? propertyValue(nextProperties[0]) : "";
    });
  }

  function openAddRoom() {
    setEditingRoom(null);
    setRoomNumber("");
    setItems([{ title: "", code: "", note: "" }]);
  }

  function openEditRoom(room) {
    const rows = codesFor(selectedProperty, room);
    setEditingRoom(room);
    setRoomNumber(room);
    setItems(
      rows.length > 0
        ? rows.map((k) => ({ title: k.title || "", code: k.code || "", note: k.note || "" }))
        : [{ title: "", code: "", note: "" }]
    );
  }

  function closeEditor() {
    setEditingRoom(null);
    setRoomNumber("");
    setItems([{ title: "", code: "", note: "" }]);
  }

  function updateItem(index, field, value) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function addItem() {
    setItems((current) => [...current, { title: "", code: "", note: "" }]);
  }

  function removeItem(index) {
    setItems((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [{ title: "", code: "", note: "" }];
    });
  }

  async function saveRoomCodes() {
    const targetRoom = roomNumber.trim();
    const validItems = items
      .map((item) => ({
        title: item.title.trim() || "キーコード",
        code: item.code.trim(),
        note: item.note.trim(),
      }))
      .filter((item) => item.code);

    if (!selectedProperty) { alert("物件を選択してください"); return; }
    if (!targetRoom) { alert("部屋番号を入力してください"); return; }
    if (validItems.length === 0) { alert("キーコードを1つ以上入力してください"); return; }

    const res = await authFetch(`${API_BASE}/admin/key-codes/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: selectedProperty,
        room_number: targetRoom,
        items: validItems,
      }),
    });

    if (!res.ok) {
      alert("保存に失敗しました");
      return;
    }

    closeEditor();
    await load();
  }

  useEffect(() => { load(); }, []);

  const selectedPropertyInfo = properties.find((p) => propertyValue(p) === selectedProperty);
  const selectedLabel = selectedPropertyInfo ? propertyLabel(selectedPropertyInfo) : { value: selectedProperty, name: selectedProperty, beds: "" };
  const rooms = roomsFor(selectedProperty);
  const isEditorOpen = editingRoom !== null || roomNumber !== "" || items.some((item) => item.title || item.code || item.note);

  return (
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 lg:col-span-4 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-bold text-lg">物件一覧</h2>
          <p className="text-xs text-slate-500">物件管理に登録された物件と連動</p>
        </div>
        <div className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
          {properties.length === 0 && (
            <div className="p-6 text-sm text-slate-400 text-center">物件管理に物件がありません</div>
          )}
          {properties.map((p) => {
            const label = propertyLabel(p);
            const roomCount = roomsFor(label.value).length;
            const active = selectedProperty === label.value;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedProperty(label.value); closeEditor(); }}
                className={`w-full text-left rounded-2xl border px-4 py-3 transition ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 hover:bg-slate-50"}`}
              >
                <div className="font-bold text-sm">{label.name}</div>
                {label.beds && label.beds !== label.name && (
                  <div className={`text-xs mt-0.5 ${active ? "text-slate-300" : "text-slate-400"}`}>Beds24: {label.beds}</div>
                )}
                <div className={`text-xs mt-1 ${active ? "text-slate-300" : "text-slate-400"}`}>{roomCount}部屋</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="col-span-12 lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-lg">{selectedLabel.name || "部屋一覧"}</h2>
            {selectedLabel.beds && selectedLabel.beds !== selectedLabel.name && (
              <p className="text-xs text-slate-500 mt-1">Beds24表示名：{selectedLabel.beds}</p>
            )}
            <p className="text-xs text-slate-500 mt-1">部屋をタップして編集できます</p>
          </div>
          <button
            type="button"
            onClick={openAddRoom}
            className="rounded-xl bg-blue-600 text-white px-4 py-2.5 text-sm font-bold"
          >
            ＋ 部屋を追加
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {!selectedProperty && (
            <div className="p-8 text-center text-sm text-slate-400">左側から物件を選択してください</div>
          )}
          {selectedProperty && rooms.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-400">まだ部屋が登録されていません</div>
          )}
          {rooms.map((room) => {
            const roomCodes = codesFor(selectedProperty, room);
            return (
              <button
                key={room}
                type="button"
                onClick={() => openEditRoom(room)}
                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left hover:bg-slate-50 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800">{room}号室</div>
                    <div className="text-xs text-slate-400 mt-1">{roomCodes.length}件のキーコード</div>
                  </div>
                  <span className="text-xs text-blue-600 underline shrink-0">編集</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {roomCodes.map((code) => (
                    <span key={code.id} className="rounded-full bg-blue-50 border border-blue-100 text-blue-700 px-2 py-1 text-xs">
                      {code.title || "キーコード"}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {isEditorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{editingRoom ? `${editingRoom}号室を編集` : "部屋を追加"}</h3>
                <p className="text-xs text-slate-500 mt-1">同じ部屋の複数キーコードをまとめて保存できます</p>
              </div>
              <button type="button" onClick={closeEditor} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">閉じる</button>
            </div>

            <div>
              <label className="text-sm font-bold">部屋番号 <span className="text-red-500">*</span></label>
              <input
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                placeholder="例：703"
              />
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={index} className="rounded-2xl border border-blue-100 bg-blue-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-700">キーコード {index + 1}</span>
                    <button type="button" onClick={() => removeItem(index)} className="text-xs text-red-600 underline">削除</button>
                  </div>
                  <input
                    value={item.title}
                    onChange={(e) => updateItem(index, "title", e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
                    placeholder="タイトル 例：エントランス キーボックス"
                  />
                  <input
                    value={item.code}
                    onChange={(e) => updateItem(index, "code", e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none font-mono"
                    placeholder="コード 例：0731"
                  />
                  <input
                    value={item.note}
                    onChange={(e) => updateItem(index, "note", e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
                    placeholder="備考 任意"
                  />
                </div>
              ))}
            </div>

            <button type="button" onClick={addItem} className="w-full rounded-xl border border-blue-200 bg-blue-50 text-blue-700 py-3 text-sm font-bold">
              ＋ キーコードを追加
            </button>
            <button type="button" onClick={saveRoomCodes} className="w-full rounded-xl bg-blue-600 text-white py-3 text-sm font-bold">
              保存する
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(mainPath, source, "utf8");
console.log("Patched KeyCodeSection in frontend/src/main.jsx");
