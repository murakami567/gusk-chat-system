const PROPERTY_SELECT_API_BASE = "https://gusk-chat-system.onrender.com";
let cachedTemplateProperties = [];
let templatePropertiesLoaded = false;
let isApplyingPropertyPatch = false;

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

function buildPropertyOptions(properties) {
  const options = [];
  const seen = new Set();

  properties.forEach((property) => {
    const guestName = cleanPropertyText(property.name);
    const beds24Name = cleanPropertyText(property.beds24_property_name);

    if (guestName && !seen.has(guestName)) {
      seen.add(guestName);
      options.push({ value: guestName, label: guestName });
    }

    if (beds24Name && beds24Name !== guestName && !seen.has(beds24Name)) {
      seen.add(beds24Name);
      options.push({ value: beds24Name, label: `${beds24Name}（Beds24名）` });
    }
  });

  return options;
}

function replacePropertySelectOptions(select, options) {
  const previousValue = select.value;
  const previousSignature = select.dataset.propertyPatchSignature;
  const nextSignature = JSON.stringify(options.map((option) => option.value));

  if (previousSignature === nextSignature) return;

  isApplyingPropertyPatch = true;
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

  if (options.some((item) => item.value === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = "";
  }

  isApplyingPropertyPatch = false;
}

async function applyTemplatePropertySelectPatch() {
  if (isApplyingPropertyPatch) return;

  const section = findTemplateCreateSection();
  if (!section) return;

  const propertySelect = findSelectAfterLabel(section, "物件名");
  if (!propertySelect) return;

  const properties = await loadTemplateProperties();
  const options = buildPropertyOptions(properties);
  replacePropertySelectOptions(propertySelect, options);
}

function installTemplatePropertySelectPatch() {
  const observer = new MutationObserver(() => applyTemplatePropertySelectPatch());
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", () => setTimeout(applyTemplatePropertySelectPatch, 0));
  applyTemplatePropertySelectPatch();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installTemplatePropertySelectPatch);
} else {
  installTemplatePropertySelectPatch();
}
