const baseFetch = window.fetch.bind(window);

window.fetch = (input, init = {}) => {
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

  return baseFetch(input, init);
};
