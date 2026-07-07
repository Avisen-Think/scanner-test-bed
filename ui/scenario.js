// scenario.js (ui) — the Scenario rail group (design §12/§5.3): Save downloads the current
// scene as a JSON file; Load reads one back. All (de)serialization logic lives in the pure
// sim/scenario.js — this file is only the DOM/file-picker plumbing around it.
function el(t, c, p = {}) { const e = document.createElement(t); if (c) e.className = c; Object.assign(e, p); return e; }
function btn(txt, onclick) { const b = el("button", "modebtn", { textContent: txt }); b.addEventListener("click", onclick); return b; }

// onSave(): () -> plain scenario object (caller builds it via sim/scenario.js buildScenario)
// onLoad(text): (string) -> { error? } (caller parses + applies via sim/scenario.js parseScenario)
export function initScenario({ container, onSave, onLoad }) {
  container.innerHTML = "";
  const status = el("div", "hint-line");

  const saveBtn = btn("Save scenario", () => {
    const data = onSave();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", null, { href: url, download: `scenario-${Date.now()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = "Saved.";
  });

  const fileInput = el("input", null, { type: "file", accept: "application/json" });
  fileInput.style.display = "none";
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    const res = onLoad(text) || {};
    status.textContent = res.error ? `Load failed: ${res.error}` : `Loaded ${file.name}.`;
    fileInput.value = "";
  });
  const loadBtn = btn("Load scenario…", () => fileInput.click());

  const row = el("div", "field");
  row.append(saveBtn, loadBtn);
  container.append(row, fileInput, status);
  container.appendChild(el("div", "hint-line", {
    textContent: "captures ship, env, display, generation state, and every entity — the harness seam (design §12).",
  }));
}
