const TEMPLATE_API_BASE = "https://gusk-chat-system.onrender.com";
let cachedCategories = [];
let categoriesLoaded = false;

function normalizeText(value) {
  return String(value || "").trim();
}

async function loadTemplateCategories() {
  if (categoriesLoaded) return cachedCategories;
  categoriesLoaded = true;
  try {
    const res = await fetch(`${TEMPLATE_API_BASE}/categories`);
    const data = await res.json();
    cachedCategories = data.categories || [];
  } catch {
    cachedCategories = [];
  }
  return cachedCategories;
}

function findTemplateSection() {
  return [...document.querySelectorAll("section")].find((section) =>
    section.textContent.includes("新規テンプレート作成")
  );
}

function findSelectByLabel(section, labelText) {
  const labels = [...section.querySelectorAll("label")];
  const label = labels.find((item) => normalizeText(item.textContent).startsWith(labelText));
  if (!label) return null;
  const wrapper = label.closest("div");
  return wrapper?.querySelector("select") || null;
}

function allowedCategoryNames(categories, propertyName) {
  const selected = normalizeText(propertyName);
  if (!selected) return [];

  return [
    ...new Set(
      categories
        .filter((category) => {
          const categoryProperty = normalizeText(category.property_name);
          return !categoryProperty || categoryProperty === selected;
        })
        .map((category) => normalizeText(category.name))
        .filter(Boolean)
    ),
  ];
}

function replaceCategoryOptions(categorySelect, names) {
  const currentValue = categorySelect.value;
  const nextNames = names.length ? names : [];

  categorySelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = nextNames.length ? "選択してください" : "物件に対応するカテゴリがありません";
  categorySelect.appendChild(placeholder);

  nextNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    categorySelect.appendChild(option);
  });

  if (nextNames.includes(currentValue)) {
    categorySelect.value = currentValue;
  } else {
    categorySelect.value = "";
    categorySelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function applyTemplateCategoryFilter() {
  const section = findTemplateSection();
  if (!section) return;

  const propertySelect = findSelectByLabel(section, "物件名");
  const categorySelect = findSelectByLabel(section, "カテゴリ");
  if (!propertySelect || !categorySelect) return;

  const categories = await loadTemplateCategories();
  const names = allowedCategoryNames(categories, propertySelect.value);
  replaceCategoryOptions(categorySelect, names);
}

function installTemplateSelectPatch() {
  document.addEventListener("change", (event) => {
    const section = findTemplateSection();
    if (!section || !section.contains(event.target)) return;

    const propertySelect = findSelectByLabel(section, "物件名");
    if (event.target === propertySelect) {
      applyTemplateCategoryFilter();
    }
  });

  const observer = new MutationObserver(() => applyTemplateCategoryFilter());
  observer.observe(document.body, { childList: true, subtree: true });

  applyTemplateCategoryFilter();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installTemplateSelectPatch);
} else {
  installTemplateSelectPatch();
}
