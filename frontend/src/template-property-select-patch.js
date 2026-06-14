function cleanTemplatePropertyText(value) {
  return String(value || "").trim();
}

function findTemplateCreateSection() {
  return [...document.querySelectorAll("section")].find((section) =>
    section.textContent.includes("新規テンプレート作成")
  );
}

function findSelectAfterLabel(section, labelText) {
  const label = [...section.querySelectorAll("label")].find((item) =>
    cleanTemplatePropertyText(item.textContent).startsWith(labelText)
  );
  return label?.closest("div")?.querySelector("select") || null;
}

function shouldRemoveOption(option) {
  const text = cleanTemplatePropertyText(option.textContent);
  const value = cleanTemplatePropertyText(option.value);
  return text.includes("「") || text.includes("」") || value.includes("「") || value.includes("」");
}

function removeBeds24PropertyOptions() {
  const section = findTemplateCreateSection();
  if (!section) return;

  const propertySelect = findSelectAfterLabel(section, "物件名");
  if (!propertySelect) return;

  [...propertySelect.querySelectorAll("option")].forEach((option) => {
    if (shouldRemoveOption(option)) option.remove();
  });
}

function installTemplatePropertySelectPatch() {
  const observer = new MutationObserver(() => removeBeds24PropertyOptions());
  observer.observe(document.body, { childList: true, subtree: true });

  removeBeds24PropertyOptions();
  setTimeout(removeBeds24PropertyOptions, 300);
  setTimeout(removeBeds24PropertyOptions, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installTemplatePropertySelectPatch);
} else {
  installTemplatePropertySelectPatch();
}
