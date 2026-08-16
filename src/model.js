export function normalizeForModel(text) {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

export function tokenize(text) {
  return normalizeForModel(text).match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
}

export function createClassifier(model) {
  if (model.format !== "finiquito-tfidf-logreg-v1") {
    throw new Error("Formato de modelo incompatible");
  }
  const termIndex = new Map(model.terms.map((term, index) => [term, index]));

  return function classify(text) {
    const tokens = tokenize(text);
    const counts = new Map();
    for (let i = 0; i < tokens.length; i += 1) {
      counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
      if (i + 1 < tokens.length) {
        const bigram = `${tokens[i]} ${tokens[i + 1]}`;
        counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
      }
    }

    const active = [];
    let normSquared = 0;
    for (const [term, count] of counts) {
      const index = termIndex.get(term);
      if (index === undefined) continue;
      const tf = model.vectorizer.sublinearTf ? 1 + Math.log(count) : count;
      const raw = tf * model.idf[index];
      active.push({ term, index, raw });
      normSquared += raw * raw;
    }

    const norm = Math.sqrt(normSquared) || 1;
    let logOdds = model.intercept;
    const contributions = active.map(({ term, index, raw }) => {
      const tfidf = raw / norm;
      const contribution = tfidf * model.coefficients[index];
      logOdds += contribution;
      return { term, contribution };
    });
    const probability = logOdds >= 0
      ? 1 / (1 + Math.exp(-logOdds))
      : Math.exp(logOdds) / (1 + Math.exp(logOdds));
    const classification = probability >= model.threshold ? "SI" : "NO";
    const confidence = Math.max(probability, 1 - probability);
    const direction = classification === "SI" ? 1 : -1;
    const decisiveTerms = contributions
      .filter((item) => item.contribution * direction > 0)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 8);

    return {
      classification,
      probability,
      confidence,
      manualReview: confidence < model.reviewConfidenceThreshold,
      decisiveTerms,
      recognizedFeatures: active.length,
    };
  };
}

export function extractAfterLastResuelve(fullText) {
  const pattern = /(?:^|[^\p{L}])r\s*e\s*s\s*u\s*e\s*l\s*v\s*e(?=$|[^\p{L}])/giu;
  let match;
  let lastEnd = -1;
  while ((match = pattern.exec(fullText)) !== null) lastEnd = pattern.lastIndex;
  if (lastEnd < 0) return null;
  return fullText.slice(lastEnd).replace(/\s+/gu, " ").trim();
}
