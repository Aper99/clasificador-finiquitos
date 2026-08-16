import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClassifier, extractAfterLastResuelve } from "../src/model.js";

const model = JSON.parse(await readFile(new URL("../public/model/modelo_finiquito.json", import.meta.url), "utf8"));
const classify = createClassifier(model);

const cases = [
  {
    text: "1) DECLARAR la extinción de la pena en el proceso seguido a PERSONA de conformidad al exordio de la presente resolución. 2) OFICIAR para su cumplimiento. 3) ORDENAR el archivo de la presente causa. 4) ANOTAR, registrar y remitir copia.",
    probability: 0.999460627316805,
    classification: "SI",
  },
  {
    text: "1) MANTENER el beneficio de la Suspensión Condicional del Procedimiento dispuesto por resolución anterior. 2) ANOTAR, registrar, y remitir copia.",
    probability: 0.007545596890645187,
    classification: "NO",
  },
  {
    text: "SE SOBRESEE DEFINITIVAMENTE y se ordena el archivo de la causa",
    probability: 0.43634852600713253,
    classification: "SI",
  },
];

for (const expected of cases) {
  const actual = classify(expected.text);
  assert.equal(actual.classification, expected.classification);
  assert.ok(Math.abs(actual.probability - expected.probability) < 1e-12, `${actual.probability} != ${expected.probability}`);
}

assert.equal(
  extractAfterLastResuelve("cabecera RESUELVE texto anterior\nR E S U E L V E   texto   final\n\n limpio"),
  "texto final limpio",
);
assert.equal(extractAfterLastResuelve("documento sin la palabra clave"), null);
assert.equal(extractAfterLastResuelve("resuelve\n\n"), "");

console.log("Pruebas del modelo y extracción: OK");
