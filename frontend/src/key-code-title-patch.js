const originalFetchForKeyTitlePatch = window.fetch.bind(window);
let latestCheckinKeyCards = [];

function findKeyCodeFormSection() {
  return Array.from(document.querySelectorAll("section")).find((section) =>
    section.textContent.includes("キーコードを追加") || section.textContent.includes("キーコードを編集")
  );
}

function findCodeInput(section) {
  return Array.from(section.querySelectorAll("input")).find((input) =>
    input.placeholder && input.placeholder.includes("1234")
  );
}

function findNoteInput(section) {
  return Array.from(section.querySelectorAll("input")).find((input) =>
    input.placeholder && input.placeholder.includes("玄関ドア")
  );
}

function ensureTitleInput() {
  const section = findKeyCodeFormSection();
  if (!section || section.querySelector('[data-key-code-title-input="true"]')) return;

  const codeInput = findCodeInput(section);
  const codeWrapper = codeInput?.closest("div");
  if (!codeWrapper) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <label class="text-sm font-bold">タイトル <span class="text-red-500">*</span></label>
    <input data-key-code-title-input="true" class="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none" placeholder="例：エントランス キーボックス" />
  `;
  codeWrapper.parentElement.insertBefore(wrapper, codeWrapper);
}

function ensureMultiCodeArea() {
  const section = findKeyCodeFormSection();
  if (!section || section.querySelector('[data-multi-key-code-area="true"]')) return;

  const noteInput = findNoteInput(section);
  const noteWrapper = noteInput?.closest("div");
  if (!noteWrapper) return;

  const area = document.createElement("div");
  area.dataset.multiKeyCodeArea = "true";
  area.className = "rounded-2xl border border-blue-100 bg-blue-50 p-3 space-y-3";
  area.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div>
        <p class="text-sm font-bold text-blue-800">追加キーコード</p>
        <p class="text-xs text-blue-500">同じ部屋に複数コードがある場合に追加</p>
      </div>
      <button type="button" data-add-key-code-row="true" class="rounded-xl bg-blue-600 text-white px-3 py-2 text-xs font-bold">＋追加</button>
    </div>
    <div data-key-code-rows="true" class="space-y-2"></div>
  `;
  noteWrapper.parentElement.insertBefore(area, noteWrapper.nextSibling);

  area.querySelector('[data-add-key-code-row="true"]').addEventListener("click", () => addKeyCodeRow());
}

function addKeyCodeRow(item = {}) {
  const rows = document.querySelector('[data-key-code-rows="true"]');
  if (!rows) return;

  const row = document.createElement("div");
  row.dataset.keyCodeRow = "true";
  row.className = "rounded-xl bg-white border border-blue-100 p-3 space-y-2";
  row.innerHTML = `
    <input data-row-title="true" class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none" placeholder="タイトル 例：ルームドア" value="${escapeHtml(item.title || "")}" />
    <input data-row-code="true" class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none font-mono" placeholder="コード 例：5678" value="${escapeHtml(item.code || "")}" />
    <input data-row-note="true" class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none" placeholder="備考 任意" value="${escapeHtml(item.note || "")}" />
    <button type="button" data-remove-row="true" class="text-xs text-red-600 underline">この追加コードを削除</button>
  `;
  row.querySelector('[data-remove-row="true"]').addEventListener("click", () => row.remove());
  rows.appendChild(row);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));
}

function getInputValue(selector) {
  const input = document.querySelector(selector);
  return input?.value?.trim() || "";
}

function getMainKeyCodeItem(body) {
  return {
    title: getInputValue('[data-key-code-title-input="true"]') || body.title || "キーコード",
    code: body.code || "",
    note: body.note || "",
  };
}

function getAdditionalKeyCodeItems() {
  return Array.from(document.querySelectorAll('[data-key-code-row="true"]')).map((row) => ({
    title: row.querySelector('[data-row-title="true"]')?.value?.trim() || "キーコード",
    code: row.querySelector('[data-row-code="true"]')?.value?.trim() || "",
    note: row.querySelector('[data-row-note="true"]')?.value?.trim() || "",
  })).filter((item) => item.code);
}

function clearKeyCodePatchInputs() {
  const titleInput = document.querySelector('[data-key-code-title-input="true"]');
  if (titleInput) titleInput.value = "";
  document.querySelectorAll('[data-key-code-row="true"]').forEach((row) => row.remove());
}

function transformKeyCodeCard() {
  if (!latestCheckinKeyCards.length) return;

  const card = Array.from(document.querySelectorAll("div")).find((node) =>
    node.textContent.includes("鍵の受け取りコード") && node.textContent.includes(latestCheckinKeyCards[0].code)
  );
  if (!card || card.dataset.multiKeyTransformed === "true") return;

  card.dataset.multiKeyTransformed = "true";
  card.className = "rounded-2xl border-2 border-blue-200 bg-blue-50 p-5 space-y-3";
  card.innerHTML = `
    <p class="text-xs font-bold text-blue-500 uppercase tracking-widest text-center">鍵情報</p>
    <div class="space-y-3">
      ${latestCheckinKeyCards.map((item) => `
        <div class="rounded-xl bg-white border border-blue-200 p-4 text-center shadow-sm">
          <p class="text-xs font-bold text-blue-600 mb-2">${escapeHtml(item.title || "キーコード")}</p>
          <p class="text-4xl font-bold tracking-widest text-blue-900">${escapeHtml(item.code || "")}</p>
          ${item.note ? `<p class="text-xs text-blue-500 mt-2 whitespace-pre-wrap">${escapeHtml(item.note)}</p>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

window.fetch = async (input, init = {}) => {
  const method = String(init.method || "GET").toUpperCase();
  const url = typeof input === "string" ? input : input?.url || "";

  if (method === "POST" && url.includes("/admin/key-codes") && !url.includes("/batch")) {
    try {
      const body = JSON.parse(init.body || "{}");
      const items = [getMainKeyCodeItem(body), ...getAdditionalKeyCodeItems()].filter((item) => item.code);

      if (items.length > 1) {
        const res = await originalFetchForKeyTitlePatch(url.replace("/admin/key-codes", "/admin/key-codes/batch"), {
          method: "POST",
          headers: init.headers || { "Content-Type": "application/json" },
          body: JSON.stringify({ property_name: body.property_name, room_number: body.room_number, items }),
        });
        setTimeout(clearKeyCodePatchInputs, 300);
        return res;
      }

      body.title = items[0]?.title || "キーコード";
      init = { ...init, body: JSON.stringify(body) };
    } catch {}
  }

  if (method === "PUT" && url.includes("/admin/key-codes")) {
    try {
      const body = JSON.parse(init.body || "{}");
      body.title = getInputValue('[data-key-code-title-input="true"]') || body.title || "キーコード";
      init = { ...init, body: JSON.stringify(body) };
    } catch {}
  }

  const response = await originalFetchForKeyTitlePatch(input, init);

  if (method === "POST" && url.includes("/checkin/submit")) {
    try {
      const data = await response.clone().json();
      if (Array.isArray(data.key_codes) && data.key_codes.length > 0) {
        latestCheckinKeyCards = data.key_codes;
        const first = data.key_codes[0];
        const nextData = {
          ...data,
          key_code: first.code,
          key_note: data.key_codes.map((item) => `${item.title || "キーコード"}: ${item.code}${item.note ? `（${item.note}）` : ""}`).join("\n"),
        };
        setTimeout(transformKeyCodeCard, 100);
        setTimeout(transformKeyCodeCard, 500);
        return new Response(JSON.stringify(nextData), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } catch {}
  }

  if ((method === "POST" || method === "PUT") && url.includes("/admin/key-codes")) {
    setTimeout(clearKeyCodePatchInputs, 300);
  }

  return response;
};

function installKeyCodeTitlePatch() {
  const observer = new MutationObserver(() => {
    ensureTitleInput();
    ensureMultiCodeArea();
    transformKeyCodeCard();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureTitleInput();
  ensureMultiCodeArea();
  transformKeyCodeCard();
  setTimeout(ensureTitleInput, 300);
  setTimeout(ensureMultiCodeArea, 300);
  setTimeout(transformKeyCodeCard, 300);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installKeyCodeTitlePatch);
} else {
  installKeyCodeTitlePatch();
}
