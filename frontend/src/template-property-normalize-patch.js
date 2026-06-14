const TEMPLATE_PROPERTY_API_BASE = "https://gusk-chat-system.onrender.com";
let templatePropertyCache = [];
let templatePropertyLoaded = false;
let applyingTemplatePropertyOptions = false;

function textValue(value) {
  return String(value || "").trim();
}

async function loadPropertiesForTemplate() {
  if (templatePropertyLoaded) return templatePropertyCache;
  templatePropertyLoaded = true;

  try {
    const res = await fetch(`${TEMPLATE_PROPERTY_API_BASE}/properties`);
    const data = await res.json();
    templatePropertyCache = data.properties || [];
  } catch {
    templatePropertyCache = [];
  }

  return templatePropertyCache;
}

function findTemplateSection() {
  return Array.from(document.querySelectorAll("section")).find((section) =>
    section.textContent.includes("新規テンプレート作成")
  );
}

function findPropertySelect(section) {
  const labels = Array.from(section.querySelectorAll("label"));
  const label = labels.find((item) => textValue(item.textContent).startsWith("物件名"));
  return label && label.closest("div") ? label.closest("div").querySelector("select") : null;
}

function buildBeds24Options(properties) {
  const options = [];
  const seen = new Set();

  properties.forEach((property) => {
    const value = textValue(property.beds24_property_name || property.name);
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push(value);
  });

  return options;
}

async function applyBeds24PropertyOptions() {
  if (applyingTemplatePropertyOptions) return;

  const section = findTemplateSection();
  if (!section) return;

  const select = findPropertySelect(section);
  if (!select) return;

  const options = buildBeds24Options(await loadPropertiesForTemplate());
  const signature = JSON.stringify(options);
  if (select.dataset.beds24PropertySignature === signature) return;

  const previousValue = select.value;
  applyingTemplatePropertyOptions = true;

  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選択してください";
  select.appendChild(placeholder);

  options.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });

  select.dataset.beds24PropertySignature = signature;
  select.value = options.includes(previousValue) ? previousValue : "";

  applyingTemplatePropertyOptions = false;
}

function installPropertyNormalizer() {
  const observer = new MutationObserver(() => applyBeds24PropertyOptions());
  observer.observe(document.body, { childList: true, subtree: true });
  applyBeds24PropertyOptions();
  setTimeout(applyBeds24PropertyOptions, 300);
  setTimeout(applyBeds24PropertyOptions, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installPropertyNormalizer);
} else {
  installPropertyNormalizer();
}
