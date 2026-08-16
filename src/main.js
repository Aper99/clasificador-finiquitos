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
  resultFilter: "total",
  processing: false,
};

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
  fileRowTemplate: document.querySelector("#fileRowTemplate"),
  summaryCardTemplate: document.querySelector("#summaryCardTemplate"),
  resultCardTemplate: document.querySelector("#resultCardTemplate"),
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function setModelStatus(status, message) {
  els.modelStatus.className = `model-status${status ? ` ${status}` : ""}`;
  const indicator = document.createElement("i");
  els.modelStatus.replaceChildren(indicator, document.createTextNode(message));
}

async function loadModel() {
  try {
    const response = await fetch("./model/modelo_finiquito.json");
    if (!response.ok) throw new Error(`No se pudo cargar el modelo (${response.status})`);
    state.model = await response.json();
    if (state.model.format !== "finiquito-tfidf-logreg-v1") throw new Error("Formato de modelo incompatible");
    state.classify = createClassifier(state.model);
    setModelStatus("ready", `Modelo local listo · Umbral de decisión: ${(state.model.threshold * 100).toFixed(1)}%`);
    updateControls();
  } catch (error) {
    setModelStatus("error", error.message);
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
  const rows = state.files.map((file, index) => {
    const row = els.fileRowTemplate.content.firstElementChild.cloneNode(true);
    const name = row.querySelector("strong");
    const removeButton = row.querySelector("button");
    name.textContent = file.name;
    name.title = file.name;
    row.querySelector("small").textContent = formatBytes(file.size);
    removeButton.dataset.remove = index;
    removeButton.setAttribute("aria-label", `Quitar ${file.name}`);
    return row;
  });
  els.fileList.replaceChildren(...rows);
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
  const base = { name: file.name, size: file.size, actualClassification: "", comment: "" };
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

function matchesResultFilter(result) {
  if (state.resultFilter === "yes") return result.status === "ok" && result.classification === "SI";
  if (state.resultFilter === "no") return result.status === "ok" && result.classification === "NO";
  if (state.resultFilter === "review") return result.manualReview;
  return true;
}

function createSummaryCard(filter, label, count, variant = "") {
  const card = els.summaryCardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.resultFilter = filter;
  card.setAttribute("aria-pressed", String(state.resultFilter === filter));
  if (variant) card.classList.add(variant);
  if (state.resultFilter === filter) card.classList.add("active");
  card.querySelector("span").textContent = label;
  card.querySelector("strong").textContent = count;
  return card;
}

function createResultCard(result, index) {
  const card = els.resultCardTemplate.content.firstElementChild.cloneNode(true);
  card.classList.add(result.status);
  card.querySelector(".result-index").textContent = String(index + 1).padStart(2, "0");

  const fileName = card.querySelector(".result-file strong");
  fileName.textContent = result.name;
  fileName.title = result.name;
  card.querySelector(".result-file small").textContent = formatBytes(result.size);

  const classification = card.querySelector(".classification");
  const classificationClass = result.classification === "SI" ? "positive" : result.classification === "NO" ? "negative" : "unknown";
  classification.classList.add(classificationClass);
  classification.querySelector("strong").textContent = result.classification === "SI" ? "FINIQUITO" : result.classification === "NO" ? "NO FINIQUITO" : "SIN CLASIFICAR";
  card.querySelector(".probability strong").textContent = percent(result.probability);
  card.querySelector(".confidence strong").textContent = percent(result.confidence);

  const reviewBadge = card.querySelector(".review-badge");
  reviewBadge.classList.add(result.manualReview ? "needs-review" : "approved");
  reviewBadge.textContent = result.manualReview ? "⚑ Revisión manual" : "✓ Confianza suficiente";

  const warning = card.querySelector(".result-warning");
  if (result.reason) warning.textContent = result.reason;
  else warning.remove();

  const select = card.querySelector("[data-actual-classification]");
  const classificationId = `actual-classification-${index}`;
  select.id = classificationId;
  select.dataset.resultIndex = index;
  select.value = result.actualClassification || "";
  card.querySelector(".actual-classification-label").htmlFor = classificationId;

  const textarea = card.querySelector("[data-result-comment]");
  const commentId = `comment-${index}`;
  textarea.id = commentId;
  textarea.dataset.resultIndex = index;
  textarea.value = result.comment || "";
  card.querySelector(".comment-label").htmlFor = commentId;

  const termList = card.querySelector(".term-list");
  if (result.decisiveTerms.length) {
    for (const item of result.decisiveTerms) {
      const term = document.createElement("span");
      term.textContent = item.term;
      term.title = `Contribución: ${item.contribution.toFixed(4)}`;
      termList.append(term);
    }
  } else {
    const emptyTerms = document.createElement("em");
    emptyTerms.textContent = "Sin términos disponibles";
    termList.append(emptyTerms);
  }
  card.querySelector(".resolution-text").textContent = result.resolutionText || "No disponible";
  return card;
}

function renderResults({ scroll = false } = {}) {
  const valid = state.results.filter((result) => result.status === "ok");
  const yes = valid.filter((result) => result.classification === "SI").length;
  const no = valid.filter((result) => result.classification === "NO").length;
  const reviews = state.results.filter((result) => result.manualReview).length;
  const filteredResults = state.results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => matchesResultFilter(result));
  const processedText = `${state.results.length} documento${state.results.length === 1 ? "" : "s"} procesado${state.results.length === 1 ? "" : "s"}`;
  els.resultsSummary.textContent = state.resultFilter === "total"
    ? processedText
    : `${processedText} · ${filteredResults.length} resultado${filteredResults.length === 1 ? "" : "s"} visible${filteredResults.length === 1 ? "" : "s"}`;
  els.summaryCards.replaceChildren(
    createSummaryCard("total", "Total", state.results.length),
    createSummaryCard("yes", "Finiquitos", yes, "yes"),
    createSummaryCard("no", "No finiquitos", no, "no"),
    createSummaryCard("review", "Revisión manual", reviews, "review"),
  );

  const cards = filteredResults.map(({ result, index }) => createResultCard(result, index));
  if (cards.length) {
    els.resultsList.replaceChildren(...cards);
  } else {
    const emptyResults = document.createElement("p");
    emptyResults.className = "empty-results";
    emptyResults.textContent = "No hay documentos en esta categoría.";
    els.resultsList.replaceChildren(emptyResults);
  }
  els.resultsSection.hidden = false;
  if (scroll) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.resultsSection.focus({ preventScroll: true });
    els.resultsSection.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }
}

async function processFiles() {
  if (!state.model || !state.files.length || state.processing) return;
  state.processing = true;
  state.results = [];
  els.resultsSection.setAttribute("aria-busy", "true");
  updateControls();
  renderFiles();
  const label = els.processButton.querySelector("span");
  for (let index = 0; index < state.files.length; index += 1) {
    label.textContent = `Analizando ${index + 1} de ${state.files.length}…`;
    state.results.push(await analyzeFile(state.files[index]));
  }
  label.textContent = "Analizar documentos";
  state.processing = false;
  state.resultFilter = "total";
  els.resultsSection.removeAttribute("aria-busy");
  updateControls();
  renderFiles();
  renderResults({ scroll: true });
}

function exportResults() {
  const rows = state.results.map((result) => ({
    "ARCHIVO PDF": result.name,
    "CLASIFICACIÓN DEL MODELO": result.classification === "SI" ? "FINIQUITO" : result.classification === "NO" ? "NO FINIQUITO" : "SIN CLASIFICAR",
    "CLASIFICACIÓN REAL": result.actualClassification === "SI" ? "FINIQUITO" : result.actualClassification === "NO" ? "NO FINIQUITO" : "SIN CONFIRMAR",
    "PROBABILIDAD FINIQUITO": result.probability,
    "CONFIANZA": result.confidence,
    "REQUIERE REVISIÓN MANUAL": result.manualReview ? "SI" : "NO",
    "COMENTARIO": result.comment || "",
    "MOTIVO / ADVERTENCIA": result.reason,
    "TÉRMINOS RELEVANTES": result.decisiveTerms.map((item) => `${item.term} (${item.contribution.toFixed(4)})`).join("; "),
    "TEXTO DE LA RESOLUCIÓN": result.resolutionText || "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 34 }, { wch: 24 }, { wch: 22 }, { wch: 23 }, { wch: 14 },
    { wch: 27 }, { wch: 45 }, { wch: 34 }, { wch: 65 }, { wch: 110 },
  ];
  for (let row = 2; row <= rows.length + 1; row += 1) {
    if (sheet[`D${row}`]) sheet[`D${row}`].z = "0.00%";
    if (sheet[`E${row}`]) sheet[`E${row}`].z = "0.00%";
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
  state.resultFilter = "total";
  els.resultsSection.hidden = true;
  renderFiles();
  updateControls();
});
els.summaryCards.addEventListener("click", (event) => {
  const button = event.target.closest("[data-result-filter]");
  if (!button) return;
  state.resultFilter = button.dataset.resultFilter;
  renderResults();
});
els.resultsList.addEventListener("change", (event) => {
  const select = event.target.closest("[data-actual-classification]");
  if (!select) return;
  const result = state.results[Number(select.dataset.resultIndex)];
  if (result) result.actualClassification = select.value;
});
els.resultsList.addEventListener("input", (event) => {
  const textarea = event.target.closest("[data-result-comment]");
  if (!textarea) return;
  const result = state.results[Number(textarea.dataset.resultIndex)];
  if (result) result.comment = textarea.value;
});
els.processButton.addEventListener("click", processFiles);
els.exportButton.addEventListener("click", exportResults);

loadModel();
