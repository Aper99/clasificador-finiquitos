"""Convierte el modelo de sklearn al formato usado por la aplicación web."""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "modelo_finiquito.joblib"
TARGET = ROOT / "public" / "model" / "modelo_finiquito.json"


def main() -> None:
    artifact = joblib.load(SOURCE)
    pipeline = artifact["pipeline"]
    vectorizer = pipeline.named_steps["vectorizacion"]
    classifier = pipeline.named_steps["clasificador"]

    if list(classifier.classes_) != [0, 1]:
        raise ValueError(f"Clases no compatibles: {classifier.classes_!r}")
    if vectorizer.ngram_range != (1, 2):
        raise ValueError(f"ngram_range no compatible: {vectorizer.ngram_range!r}")

    feature_names = vectorizer.get_feature_names_out()
    ordered_vocab = [None] * len(vectorizer.vocabulary_)
    for term, index in vectorizer.vocabulary_.items():
        ordered_vocab[index] = term

    if ordered_vocab != feature_names.tolist():
        raise ValueError("El orden del vocabulario no coincide con las características")

    payload = {
        "format": "finiquito-tfidf-logreg-v1",
        "threshold": float(artifact["threshold"]),
        "reviewConfidenceThreshold": 0.75,
        "intercept": float(classifier.intercept_[0]),
        "terms": ordered_vocab,
        "idf": np.asarray(vectorizer.idf_, dtype=float).tolist(),
        "coefficients": np.asarray(classifier.coef_[0], dtype=float).tolist(),
        "vectorizer": {
            "lowercase": bool(vectorizer.lowercase),
            "stripAccents": vectorizer.strip_accents,
            "sublinearTf": bool(vectorizer.sublinear_tf),
            "norm": vectorizer.norm,
            "ngramRange": list(vectorizer.ngram_range),
            "tokenPattern": vectorizer.token_pattern,
        },
    }

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Modelo exportado: {TARGET} ({TARGET.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
