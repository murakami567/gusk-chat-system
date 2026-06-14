const PROPERTY_SELECT_API_BASE = "https://gusk-chat-system.onrender.com";
let cachedTemplateCategories = [];
let templateCategoriesLoaded = false;
let applyingTemplatePropertyPatch = false;

function cleanPropertyText(value) {
  return String(value || "").trim();
}

async function loadTemplateCategories() {
  if (templateCategoriesLoaded) return cachedTemplateCategories;
  templateCategoriesLoaded = true;

  try {
    const res = await fetch(`${PROPERTY_SELECT_API_BASE}/categories`);
    const data = await res.json();
    cachedTemplateCategories = data.categories || [];
  } catch {
    cachedTemplateCategories = [];
  }

  return cachedTemplateCategories;
}

function findTemplateCreateSection() {
  return [...document.querySelectorAll("section")].find((section) =>
    section.textContent.includes("新規テンプレート作成")
  );
}

function findSelectAfterLabel(section, labelText) {
  const label = [...section.querySelectorAll("label")].find((item) =>
    cleanPropertyText(item.textContent).startsWith(labelText)
  );
  return label?.closest("div")?.querySelector("select") || null;
}

function buildPropertyOptions(categories) {
  const options = [];
  const seen = new Set();

  categories.forEach((category) => {
    const propertyName = cleanPropertyText(category.property_name);
    if (!propertyName || seen.has(propertyName)) return;

    seen.add(propertyName);
    options.push({ value: propertyName, label: propertyName });
  });

  return options;
}

function replacePropertySelectOptions(select, options) {
  const previousValue = select.value;
  const nextSignature = JSON.stringify(options.map((option) => option.value));

  if (select.dataset.propertyPatchSignature === nextSignature) return;

  applyingTemplatePropertyPatch = true;
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "物件名を選択してください";
  select.appendChild(placeholder);

  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  select.dataset.propertyPatchSignature = nextSignature;
  select.value = options.some((item) => item.value === previousValue) ? previousValue : "";
  applyingTemplatePropertyPatch = false;
}

async function applyTemplatePropertySelectPatch() {
  if (applyingTemplatePropertyPatch) return;

  const section = findTemplateCreateSection();
  if (!section) return;

  const propertySelect = findSelectAfterLabel(section, "物件名");
  if (!propertySelect) return;

  const categories = await loadTemplateCategories();
  replacePropertySelectOptions(propertySelect, buildPropertyOptions(categories));
}

function installTemplatePropertySelectPatch() {
  const observer = new MutationObserver(() => applyTemplatePropertySelectPatch());
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(applyTemplatePropertySelectPatch, 0);
  setTimeout(applyTemplatePropertySelectPatch, 300);
  setTimeout(applyTemplatePropertySelectPatch, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installTemplatePropertySelectPatch);
} else {
  installTemplatePropertySelectPatch();
}
