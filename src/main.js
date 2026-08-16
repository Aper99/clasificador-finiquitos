import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as XLSX from "xlsx";
import { createClassifier, extractAfterLastResuelve } from "./model.js";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const state = {
  model: null,
  classify: null,
  files: [],
  results: [],
  processing: false,
};

document.querySelector("#app").innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Inicio">
      <span class="brand-mark" aria-hidden="true">LF</span>
      <span><strong>LexFiniquito</strong><small>Clasificador de resoluciones judiciales</small></span>
    </a>
    <div class="privacy-pill"><span></span> Procesamiento en el navegador</div>
  </header>

  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">CLASIFICADOR DE RESOLUCIONES</p>
        <h1>Identificación de<br><em>finiquitos en PDF.</em></h1>
        <p class="hero-copy">La aplicación clasifica resoluciones judiciales como finiquito o no finiquito mediante un modelo de regresión logística.</p>
      </div>
      <div class="trust-card">
        <div class="shield" aria-hidden="true">✓</div>
        <div><strong>Procesamiento local</strong><span>Los PDF y los resultados se procesan en el navegador.</span></div>
      </div>
    </section>

    <section class="workspace">
      <div class="upload-panel">
        <div class="section-heading">
          <div><span class="step">01</span><h2>Seleccione los documentos</h2></div>
          <button class="text-button" id="clearButton" type="button" disabled>Limpiar</button>
        </div>
        <label class="dropzone" id="dropzone" for="fileInput">
          <input id="fileInput" type="file" accept="application/pdf,.pdf" multiple />
          <span class="upload-icon" aria-hidden="true">↥</span>
          <strong>Arrastre sus PDF aquí</strong>
          <span>o haga clic para seleccionarlos</span>
          <small>Se admite uno o varios archivos PDF</small>
        </label>
        <div class="file-list" id="fileList" aria-live="polite"></div>
        <button class="primary-button" id="processButton" type="button" disabled>
          <span>Analizar documentos</span><b aria-hidden="true">→</b>
        </button>
        <p class="model-status" id="modelStatus"><i></i> Preparando modelo local…</p>
      </div>

      <aside class="process-panel">
        <div class="section-heading"><div><span class="step">02</span><h2>Proceso</h2></div></div>
        <ol class="process-list">
          <li><b>1</b><div><strong>Lectura</strong><span>Se extrae el texto disponible en el PDF.</span></div></li>
          <li><b>2</b><div><strong>Selección del texto</strong><span>Se utiliza el contenido posterior al último “RESUELVE”.</span></div></li>
          <li><b>3</b><div><strong>Clasificación</strong><span>El modelo calcula la clase, la probabilidad y la confianza.</span></div></li>
          <li><b>4</b><div><strong>Exportación</strong><span>Los resultados se pueden descargar en formato Excel.</span></div></li>
        </ol>
        <div class="security-note"><span>⌁</span><div><strong>Finalidad</strong><p>Facilitar la revisión inicial de resoluciones sin reemplazar el criterio profesional.</p></div></div>
      </aside>
    </section>

    <section class="results-section" id="resultsSection" hidden>
      <div class="results-title">
        <div><p class="eyebrow">RESULTADOS</p><h2>Análisis completado</h2><p id="resultsSummary"></p></div>
        <button class="export-button" id="exportButton" type="button">Exportar a Excel <span>⇩</span></button>
      </div>
      <div class="summary-cards" id="summaryCards"></div>
      <div class="results-list" id="resultsList"></div>
    </section>
  </main>

  <footer><span>LexFiniquito · Modelo de regresión logística</span><span>Clasificador de resoluciones judiciales</span></footer>
`;

const els = {
  fileInput: document.querySelector("#fileInput"),
  dropzone: document.querySelector("#dropzone"),
  fileList: document.querySelector("#fileList"),
  clearButton: document.querySelector("#clearButton"),
  processButton: document.querySelector("#processButton"),
  modelStatus: document.querySelector("#modelStatus"),
  resultsSection: document.querySelector("#resultsSection"),
  resultsSummary: document.querySelector("#resultsSummary"),
  summaryCards: document.querySelector("#summaryCards"),
  resultsList: document.querySelector("#resultsList"),
  exportButton: document.querySelector("#exportButton"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function loadModel() {
  try {
    const response = await fetch("./model/modelo_finiquito.json");
    if (!response.ok) throw new Error(`No se pudo cargar el modelo (${response.status})`);
    state.model = await response.json();
    if (state.model.format !== "finiquito-tfidf-logreg-v1") throw new Error("Formato de modelo incompatible");
    state.classify = createClassifier(state.model);
    els.modelStatus.classList.add("ready");
    els.modelStatus.innerHTML = "<i></i> Modelo local listo · Umbral de decisión: " + (state.model.threshold * 100).toFixed(1) + "%";
    updateControls();
  } catch (error) {
    els.modelStatus.classList.add("error");
    els.modelStatus.innerHTML = `<i></i> ${escapeHtml(error.message)}`;
  }
}

function addFiles(fileList) {
  const incoming = [...fileList].filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  const known = new Set(state.files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  for (const file of incoming) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!known.has(key)) {
      state.files.push(file);
      known.add(key);
    }
  }
  renderFiles();
  updateControls();
}

function renderFiles() {
  els.fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-row">
      <span class="pdf-badge">PDF</span>
      <div><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></div>
      <button type="button" data-remove="${index}" aria-label="Quitar ${escapeHtml(file.name)}">×</button>
    </div>
  `).join("");
  els.clearButton.disabled = state.files.length === 0 || state.processing;
}

function updateControls() {
  els.processButton.disabled = !state.model || state.files.length === 0 || state.processing;
  els.fileInput.disabled = state.processing;
}

async function extractPdfText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      pageText += item.str;
      pageText += item.hasEOL ? "\n" : " ";
    }
    pages.push(pageText);
    page.cleanup();
  }
  await pdf.destroy();
  return pages.join("\n");
}

async function analyzeFile(file) {
  const base = { name: file.name, size: file.size };
  try {
    const fullText = await extractPdfText(file);
    const resolutionText = extractAfterLastResuelve(fullText);
    if (resolutionText === null) {
      return { ...base, status: "warning", classification: "—", probability: null, confidence: null, manualReview: true, reason: "No se encontró la palabra RESUELVE", resolutionText: "", decisiveTerms: [] };
    }
    if (!resolutionText) {
      return { ...base, status: "warning", classification: "—", probability: null, confidence: null, manualReview: true, reason: "No hay texto después del último RESUELVE", resolutionText: "", decisiveTerms: [] };
    }
    return { ...base, status: "ok", reason: "", resolutionText, ...state.classify(resolutionText) };
  } catch (error) {
    return { ...base, status: "error", classification: "—", probability: null, confidence: null, manualReview: true, reason: error?.message || "No se pudo leer el PDF", resolutionText: "", decisiveTerms: [] };
  }
}

function percent(value) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function renderResults() {
  const valid = state.results.filter((result) => result.status === "ok");
  const yes = valid.filter((result) => result.classification === "SI").length;
  const no = valid.filter((result) => result.classification === "NO").length;
  const reviews = state.results.filter((result) => result.manualReview).length;
  els.resultsSummary.textContent = `${state.results.length} documento${state.results.length === 1 ? "" : "s"} procesado${state.results.length === 1 ? "" : "s"}`;
  els.summaryCards.innerHTML = `
    <div><span>Total</span><strong>${state.results.length}</strong></div>
    <div class="yes"><span>Finiquitos</span><strong>${yes}</strong></div>
    <div class="no"><span>No finiquitos</span><strong>${no}</strong></div>
    <div class="review"><span>Revisión manual</span><strong>${reviews}</strong></div>
  `;
  els.resultsList.innerHTML = state.results.map((result, index) => {
    const terms = result.decisiveTerms.length
      ? result.decisiveTerms.map((item) => `<span title="Contribución: ${item.contribution.toFixed(4)}">${escapeHtml(item.term)}</span>`).join("")
      : "<em>Sin términos disponibles</em>";
    const reviewClass = result.manualReview ? "needs-review" : "approved";
    return `
      <article class="result-card ${result.status}">
        <div class="result-main">
          <span class="result-index">${String(index + 1).padStart(2, "0")}</span>
          <div class="result-file"><strong title="${escapeHtml(result.name)}">${escapeHtml(result.name)}</strong><small>${formatBytes(result.size)}</small></div>
          <div class="classification ${result.classification === "SI" ? "positive" : result.classification === "NO" ? "negative" : "unknown"}"><span>Clasificación</span><strong>${result.classification === "SI" ? "FINIQUITO" : result.classification === "NO" ? "NO FINIQUITO" : "SIN CLASIFICAR"}</strong></div>
          <div class="metric"><span>Probabilidad de finiquito</span><strong>${percent(result.probability)}</strong></div>
          <div class="metric"><span>Confianza</span><strong>${percent(result.confidence)}</strong></div>
          <div class="review-badge ${reviewClass}">${result.manualReview ? "⚑ Revisión manual" : "✓ Confianza suficiente"}</div>
        </div>
        ${result.reason ? `<div class="result-warning">${escapeHtml(result.reason)}</div>` : ""}
        <details>
          <summary>Ver términos y texto analizado <span>＋</span></summary>
          <div class="detail-grid">
            <div><h3>Términos con mayor contribución</h3><div class="term-list">${terms}</div></div>
            <div><h3>Texto posterior al último “RESUELVE”</h3><p class="resolution-text">${escapeHtml(result.resolutionText || "No disponible")}</p></div>
          </div>
        </details>
      </article>
    `;
  }).join("");
  els.resultsSection.hidden = false;
  els.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function processFiles() {
  if (!state.model || !state.files.length || state.processing) return;
  state.processing = true;
  state.results = [];
  updateControls();
  renderFiles();
  const label = els.processButton.querySelector("span");
  for (let index = 0; index < state.files.length; index += 1) {
    label.textContent = `Analizando ${index + 1} de ${state.files.length}…`;
    state.results.push(await analyzeFile(state.files[index]));
  }
  label.textContent = "Analizar documentos";
  state.processing = false;
  updateControls();
  renderFiles();
  renderResults();
}

function exportResults() {
  const rows = state.results.map((result) => ({
    "ARCHIVO PDF": result.name,
    "CLASIFICACIÓN": result.classification === "SI" ? "FINIQUITO" : result.classification === "NO" ? "NO FINIQUITO" : "SIN CLASIFICAR",
    "PROBABILIDAD FINIQUITO": result.probability,
    "CONFIANZA": result.confidence,
    "REQUIERE REVISIÓN MANUAL": result.manualReview ? "SI" : "NO",
    "MOTIVO / ADVERTENCIA": result.reason,
    "TÉRMINOS CON MAYOR CONTRIBUCIÓN": result.decisiveTerms.map((item) => `${item.term} (${item.contribution.toFixed(4)})`).join("; "),
    "TEXTO DESPUÉS DEL ÚLTIMO RESUELVE": result.resolutionText,
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 34 }, { wch: 18 }, { wch: 23 }, { wch: 14 },
    { wch: 27 }, { wch: 34 }, { wch: 65 }, { wch: 110 },
  ];
  for (let row = 2; row <= rows.length + 1; row += 1) {
    if (sheet[`C${row}`]) sheet[`C${row}`].z = "0.00%";
    if (sheet[`D${row}`]) sheet[`D${row}`].z = "0.00%";
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Clasificación");
  XLSX.writeFile(workbook, `clasificacion_finiquitos_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

els.fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});
for (const eventName of ["dragenter", "dragover"]) {
  els.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropzone.classList.add("dragging"); });
}
for (const eventName of ["dragleave", "drop"]) {
  els.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropzone.classList.remove("dragging"); });
}
els.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
els.fileList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button || state.processing) return;
  state.files.splice(Number(button.dataset.remove), 1);
  renderFiles();
  updateControls();
});
els.clearButton.addEventListener("click", () => {
  state.files = [];
  state.results = [];
  els.resultsSection.hidden = true;
  renderFiles();
  updateControls();
});
els.processButton.addEventListener("click", processFiles);
els.exportButton.addEventListener("click", exportResults);

loadModel();
