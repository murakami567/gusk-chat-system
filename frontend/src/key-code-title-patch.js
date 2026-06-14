const originalFetchForKeyTitlePatch = window.fetch.bind(window);

function findKeyCodeFormSection() {
  return Array.from(document.querySelectorAll("section")).find((section) =>
    section.textContent.includes("キーコードを追加") || section.textContent.includes("キーコードを編集")
  );
}

function ensureTitleInput() {
  const section = findKeyCodeFormSection();
  if (!section || section.querySelector('[data-key-code-title-input="true"]')) return;

  const codeInput = Array.from(section.querySelectorAll("input")).find((input) =>
    input.placeholder && input.placeholder.includes("1234")
  );
  const codeWrapper = codeInput?.closest("div");
  if (!codeWrapper) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <label class="text-sm font-bold">タイトル <span class="text-red-500">*</span></label>
    <input data-key-code-title-input="true" class="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none" placeholder="例：エントランス キーボックス" />
  `;
  codeWrapper.parentElement.insertBefore(wrapper, codeWrapper);
}

function getTitleValue() {
  const input = document.querySelector('[data-key-code-title-input="true"]');
  return input?.value?.trim() || "キーコード";
}

function clearTitleValue() {
  const input = document.querySelector('[data-key-code-title-input="true"]');
  if (input) input.value = "";
}

window.fetch = async (input, init = {}) => {
  const method = String(init.method || "GET").toUpperCase();
  const url = typeof input === "string" ? input : input?.url || "";

  if ((method === "POST" || method === "PUT") && url.includes("/admin/key-codes")) {
    try {
      const body = JSON.parse(init.body || "{}");
      body.title = getTitleValue();
      init = { ...init, body: JSON.stringify(body) };
    } catch {}
  }

  const response = await originalFetchForKeyTitlePatch(input, init);

  if (method === "POST" && url.includes("/checkin/submit")) {
    try {
      const data = await response.clone().json();
      if (Array.isArray(data.key_codes) && data.key_codes.length > 0) {
        const first = data.key_codes[0];
        const noteLines = data.key_codes.map((item) => {
          const title = item.title || "キーコード";
          const code = item.code || "";
          const note = item.note ? `（${item.note}）` : "";
          return `${title}: ${code}${note}`;
        });
        const nextData = {
          ...data,
          key_code: first.code,
          key_note: noteLines.join("\n"),
        };
        return new Response(JSON.stringify(nextData), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } catch {}
  }

  if ((method === "POST" || method === "PUT") && url.includes("/admin/key-codes")) {
    setTimeout(clearTitleValue, 300);
  }

  return response;
};

function installKeyCodeTitlePatch() {
  const observer = new MutationObserver(ensureTitleInput);
  observer.observe(document.body, { childList: true, subtree: true });
  ensureTitleInput();
  setTimeout(ensureTitleInput, 300);
  setTimeout(ensureTitleInput, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installKeyCodeTitlePatch);
} else {
  installKeyCodeTitlePatch();
}
