const kcFetch = window.fetch.bind(window);
let kcState = { ready: false, loading: false, properties: [], codes: [], property: "", room: "", editing: false, items: [] };

function kcHeaders() {
  const token = localStorage.getItem("op_token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function kcEsc(v) {
  return String(v || "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function kcValue(p) { return String(p.beds24_property_name || p.name || "").trim(); }
function kcRooms() { return [...new Set(kcState.codes.filter(k => k.property_name === kcState.property).map(k => k.room_number).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ja",{numeric:true})); }
function kcItems(room) { return kcState.codes.filter(k => k.property_name === kcState.property && k.room_number === room).sort((a,b)=>(a.id||0)-(b.id||0)); }

function kcOriginal() {
  const sections = [...document.querySelectorAll("section")];
  const form = sections.find(s => s.textContent.includes("キーコードを追加") || s.textContent.includes("キーコードを編集"));
  const list = sections.find(s => s.textContent.includes("キーコード一覧"));
  if (!form || !list) return null;
  const parent = form.parentElement;
  if (!parent || parent.dataset.kcOriginalHidden === "true") return parent;
  return parent;
}

async function kcLoad() {
  const [pr, kr] = await Promise.all([
    kcFetch(`${API_BASE}/properties`),
    kcFetch(`${API_BASE}/admin/key-codes`, { headers: kcHeaders() })
  ]);
  kcState.properties = (await pr.json()).properties || [];
  kcState.codes = (await kr.json()).key_codes || [];
  if (!kcState.property && kcState.properties[0]) kcState.property = kcValue(kcState.properties[0]);
}

function kcOpen(room = "") {
  kcState.room = room;
  const rows = kcItems(room);
  kcState.items = rows.length ? rows.map(k => ({ title: k.title || "", code: k.code || "", note: k.note || "" })) : [{ title: "", code: "", note: "" }];
  kcState.editing = true;
  kcRender();
}

function kcClose() { kcState.editing = false; kcState.room = ""; kcState.items = []; kcRender(); }
function kcAdd() { kcState.items.push({ title: "", code: "", note: "" }); kcRender(); }
function kcRemove(i) { kcState.items.splice(i, 1); if (!kcState.items.length) kcState.items.push({ title: "", code: "", note: "" }); kcRender(); }

async function kcSave() {
  const room = document.querySelector("[data-kc-room]")?.value?.trim() || "";
  const items = [...document.querySelectorAll("[data-kc-row]")].map(row => ({
    title: row.querySelector("[data-kc-title]")?.value?.trim() || "キーコード",
    code: row.querySelector("[data-kc-code]")?.value?.trim() || "",
    note: row.querySelector("[data-kc-note]")?.value?.trim() || ""
  })).filter(x => x.code);
  if (!kcState.property) return alert("物件を選択してください");
  if (!room) return alert("部屋番号を入力してください");
  if (!items.length) return alert("キーコードを入力してください");
  const res = await kcFetch(`${API_BASE}/admin/key-codes/batch`, { method: "POST", headers: kcHeaders(), body: JSON.stringify({ property_name: kcState.property, room_number: room, items }) });
  if (!res.ok) return alert("保存に失敗しました");
  await kcLoad(); kcState.editing = false; kcState.room = ""; kcRender();
}

function kcEditor() {
  if (!kcState.editing) return "";
  return `<div class="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"><div class="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-5 space-y-4"><div class="flex justify-between"><div><h3 class="font-bold text-lg">${kcState.room ? kcEsc(kcState.room)+"号室を編集" : "部屋を追加"}</h3><p class="text-xs text-slate-500">複数コードをまとめて保存</p></div><button data-kc-close class="rounded-xl border px-3 py-2 text-sm">閉じる</button></div><div><label class="text-sm font-bold">部屋番号</label><input data-kc-room value="${kcEsc(kcState.room)}" class="mt-1 w-full rounded-xl border px-4 py-3 text-sm" placeholder="例：703"></div><div class="space-y-3">${kcState.items.map((it,i)=>`<div data-kc-row class="rounded-2xl border bg-blue-50 p-3 space-y-2"><div class="flex justify-between"><span class="text-xs font-bold text-blue-700">コード ${i+1}</span><button data-kc-remove="${i}" class="text-xs text-red-600 underline">削除</button></div><input data-kc-title value="${kcEsc(it.title)}" class="w-full rounded-xl border px-3 py-2 text-sm" placeholder="タイトル"><input data-kc-code value="${kcEsc(it.code)}" class="w-full rounded-xl border px-3 py-2 text-sm font-mono" placeholder="コード"><input data-kc-note value="${kcEsc(it.note)}" class="w-full rounded-xl border px-3 py-2 text-sm" placeholder="備考"></div>`).join("")}</div><button data-kc-add-code class="w-full rounded-xl border border-blue-200 bg-blue-50 text-blue-700 py-3 text-sm font-bold">＋ キーコードを追加</button><button data-kc-save class="w-full rounded-xl bg-blue-600 text-white py-3 text-sm font-bold">保存する</button></div></div>`;
}

function kcRender() {
  const original = kcOriginal(); if (!original) return;
  original.style.display = "none";
  original.dataset.kcOriginalHidden = "true";
  let root = document.querySelector("[data-kc-ui]");
  if (!root) { root = document.createElement("div"); root.dataset.kcUi = "true"; original.parentElement.insertBefore(root, original.nextSibling); }
  const rooms = kcRooms();
  const propsHtml = kcState.properties.map(p => { const val = kcValue(p); const active = val === kcState.property; const count = kcState.codes.filter(k=>k.property_name===val).map(k=>k.room_number).filter(Boolean); return `<button data-kc-prop="${kcEsc(val)}" class="w-full text-left rounded-2xl border px-4 py-3 ${active ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}"><div class="font-bold text-sm">${kcEsc(p.name || val)}</div>${p.beds24_property_name && p.beds24_property_name !== p.name ? `<div class="text-xs opacity-60 mt-1">${kcEsc(p.beds24_property_name)}</div>` : ""}<div class="text-xs opacity-60 mt-1">${new Set(count).size}部屋</div></button>`; }).join("");
  const roomsHtml = rooms.length ? rooms.map(r => { const items = kcItems(r); return `<button data-kc-open="${kcEsc(r)}" class="w-full rounded-2xl border bg-white p-4 text-left hover:bg-slate-50"><div class="flex justify-between"><div><div class="font-bold">${kcEsc(r)}号室</div><div class="text-xs text-slate-400 mt-1">${items.length}件のキーコード</div></div><span class="text-xs text-blue-600 underline">編集</span></div><div class="mt-3 flex flex-wrap gap-2">${items.map(x=>`<span class="rounded-full bg-blue-50 border border-blue-100 text-blue-700 px-2 py-1 text-xs">${kcEsc(x.title || "キーコード")}</span>`).join("")}</div></button>`; }).join("") : `<div class="p-8 text-center text-sm text-slate-400">まだ部屋が登録されていません</div>`;
  const prop = kcState.properties.find(p => kcValue(p) === kcState.property);
  root.innerHTML = `<div class="grid grid-cols-12 gap-4"><section class="col-span-12 lg:col-span-4 bg-white rounded-2xl shadow-sm border overflow-hidden"><div class="p-5 border-b"><h2 class="font-bold text-lg">物件一覧</h2><p class="text-xs text-slate-500">物件を選択</p></div><div class="p-3 space-y-2 max-h-[70vh] overflow-y-auto">${propsHtml}</div></section><section class="col-span-12 lg:col-span-8 bg-white rounded-2xl shadow-sm border overflow-hidden"><div class="p-5 border-b flex justify-between gap-4"><div><h2 class="font-bold text-lg">${kcEsc(prop?.name || kcState.property || "部屋一覧")}</h2>${prop?.beds24_property_name && prop.beds24_property_name !== prop.name ? `<p class="text-xs text-slate-500 mt-1">Beds24表示名：${kcEsc(prop.beds24_property_name)}</p>` : ""}</div><button data-kc-add-room class="rounded-xl bg-blue-600 text-white px-4 py-2.5 text-sm font-bold">＋ 部屋を追加</button></div><div class="p-4 space-y-3 max-h-[70vh] overflow-y-auto">${roomsHtml}</div></section></div>${kcEditor()}`;
  root.querySelectorAll("[data-kc-prop]").forEach(b => b.onclick = () => { kcState.property = b.dataset.kcProp; kcState.editing = false; kcRender(); });
  root.querySelector("[data-kc-add-room]")?.addEventListener("click", () => kcOpen(""));
  root.querySelectorAll("[data-kc-open]").forEach(b => b.onclick = () => kcOpen(b.dataset.kcOpen));
  root.querySelector("[data-kc-close]")?.addEventListener("click", kcClose);
  root.querySelector("[data-kc-add-code]")?.addEventListener("click", kcAdd);
  root.querySelector("[data-kc-save]")?.addEventListener("click", kcSave);
  root.querySelectorAll("[data-kc-remove]").forEach(b => b.onclick = () => kcRemove(Number(b.dataset.kcRemove)));
}

async function kcInstall() {
  if (kcState.loading) return;
  const original = kcOriginal();
  if (!original) return;
  const root = document.querySelector("[data-kc-ui]");
  if (root && root.isConnected) return;
  kcState.loading = true;
  try {
    if (!kcState.ready) { kcState.ready = true; await kcLoad(); }
    kcRender();
  } finally {
    kcState.loading = false;
  }
}

kcInstall();
setTimeout(kcInstall, 500);
setTimeout(kcInstall, 1500);
setInterval(kcInstall, 1500);
