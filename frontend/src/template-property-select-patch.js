const PROPERTY_SELECT_API_BASE = "https://gusk-chat-system.onrender.com";
let cachedTemplateProperties = [];
let templatePropertiesLoaded = false;

function cleanPropertyText(value) {
  return String(value || "").trim();
}

async function loadTemplateProperties() {
  if (templatePropertiesLoaded) return cachedTemplateProperties;
  templatePropertiesLoaded = true;

  try {
    const res = await fetch(`${PROPERTY_SELECT_API_BASE}/properties`);
    const data = await res.json();
    cachedTemplateProperties = data.properties || [];
  } catch {
    cachedTemplateProperties = [];
  }

  return cachedTemplateProperties;
}

function findTemplateCreateSection() {
  return [...document.querySelectorAll("section")].find((section) => section.textContent.includes("新規テンプレート作成"));
}

function findSelectAfterLabel(section, labelText) {
  const label = [...section.querySelectorAll("label")].find((item) => cleanPropertyText(item.textContent).startsWith(labelText));
  return label?.closest("div")?.querySelector("select") || null;
}

function buildPropertyOptions(properties) {
  const options = [];
  const seen = new Set();

  properties.forEach((property) => {
    const propertyName = cleanPropertyText(property.name);

    if (propertyName && !seen.has(propertyName)) {
      seen.add(propertyName);
      options.push({ value: propertyName, label: propertyName });
    }
  });

  return options;
}

function replacePropertySelectOptions(select, options) {
  const previousValue = select.value;
  const nextSignature = JSON.stringify(options.map((option) => option.value));

  if (select.dataset.propertyPatchSignature === nextSignature) return;

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
}

async function applyTemplatePropertySelectPatch() {
  const section = findTemplateCreateSection();
  if (!section) return;

  const propertySelect = findSelectAfterLabel(section, "物件名");
  if (!propertySelect) return;

  const properties = await loadTemplateProperties();
  replacePropertySelectOptions(propertySelect, buildPropertyOptions(properties));
}

function installTemplatePropertySelectPatch() {
  const observer = new MutationObserver(() => applyTemplatePropertySelectPatch());
  observer.observe(document.body, { childList: true, subtree: true });
  applyTemplatePropertySelectPatch();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installTemplatePropertySelectPatch);
} else {
  installTemplatePropertySelectPatch();
}
