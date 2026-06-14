const baseFetch = window.fetch.bind(window);

const hiddenWaitingText = "\u30b9\u30bf\u30c3\u30d5\u304c\u78ba\u8a8d\u6b21\u7b2c\u3054\u8fd4\u4fe1\u3044\u305f\u3057\u307e\u3059\u3002\u3057\u3070\u3089\u304f\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002";

function normalizeHiddenMessageText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function isHiddenWaitingMessage(value) {
  return normalizeHiddenMessageText(value).includes(normalizeHiddenMessageText(hiddenWaitingText));
}

window.fetch = async (input, init = {}) => {
  const method = String(init.method || "GET").toUpperCase();
  const url = typeof input === "string" ? input : input?.url || "";

  if (method === "POST" && url.includes("/guest/chat/") && url.includes("/messages")) {
    try {
      const body = JSON.parse(init.body || "{}");
      if (body.sender_type === "operator") {
        const token = localStorage.getItem("op_token");
        if (token) {
          const headers = new Headers(init.headers || {});
          headers.set("Authorization", `Bearer ${token}`);
          init = { ...init, headers };
        }
      }
    } catch {}
  }

  const response = await baseFetch(input, init);

  if (method === "GET" && url.includes("/guest/chat/") && url.includes("/messages")) {
    try {
      const cloned = response.clone();
      const data = await cloned.json();
      if (Array.isArray(data.messages)) {
        const filtered = {
          ...data,
          messages: data.messages.filter((message) => !isHiddenWaitingMessage(message.message)),
        };
        return new Response(JSON.stringify(filtered), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } catch {}
  }

  return response;
};

function removeHiddenWaitingMessageNodes() {
  document.querySelectorAll("p, div, span").forEach((node) => {
    if (isHiddenWaitingMessage(node.textContent)) {
      const wrapper = node.closest(".rounded-2xl") || node;
      wrapper.remove();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    removeHiddenWaitingMessageNodes();
    new MutationObserver(removeHiddenWaitingMessageNodes).observe(document.body, { childList: true, subtree: true });
  });
} else {
  removeHiddenWaitingMessageNodes();
  new MutationObserver(removeHiddenWaitingMessageNodes).observe(document.body, { childList: true, subtree: true });
}
