function textValue(value) {
  return String(value || "").trim();
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

function toShortName(value) {
  const text = textValue(value);
  const bracketIndex = text.indexOf("「");
  return textValue(bracketIndex >= 0 ? text.slice(0, bracketIndex) : text);
}

function normalizePropertyOptions() {
  const section = findTemplateSection();
  if (!section) return;

  const select = findPropertySelect(section);
  if (!select) return;

  const seen = new Set();

  Array.from(select.querySelectorAll("option")).forEach((option) => {
    if (!option.value) return;

    const nextValue = toShortName(option.value || option.textContent);
    const nextLabel = toShortName(option.textContent || option.value);

    if (!nextValue || seen.has(nextValue)) {
      option.remove();
      return;
    }

    seen.add(nextValue);
    option.value = nextValue;
    option.textContent = nextLabel || nextValue;
  });
}

function installPropertyNormalizer() {
  const observer = new MutationObserver(normalizePropertyOptions);
  observer.observe(document.body, { childList: true, subtree: true });
  normalizePropertyOptions();
  setTimeout(normalizePropertyOptions, 300);
  setTimeout(normalizePropertyOptions, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installPropertyNormalizer);
} else {
  installPropertyNormalizer();
}
