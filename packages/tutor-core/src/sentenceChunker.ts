const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;
const CLAUSE_BOUNDARY = /(?<=,)\s+/;

export function splitNarrationIntoChunks(text: string, maxLength = 120): string[] {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.length <= maxLength) {
    return [trimmed];
  }

  const sentences = trimmed.split(SENTENCE_BOUNDARY).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
    }
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length <= maxLength) {
      const candidate = current ? `${current} ${sentence}` : sentence;

      if (candidate.length <= maxLength) {
        current = candidate;
      } else {
        pushCurrent();
        current = sentence;
      }
      continue;
    }

    pushCurrent();

    const clauses = sentence.split(CLAUSE_BOUNDARY).filter(Boolean);

    for (const clause of clauses) {
      if (clause.length <= maxLength) {
        const candidate = current ? `${current} ${clause}` : clause;

        if (candidate.length <= maxLength) {
          current = candidate;
        } else {
          pushCurrent();
          current = clause;
        }
      } else {
        pushCurrent();

        for (let i = 0; i < clause.length; i += maxLength) {
          chunks.push(clause.slice(i, i + maxLength).trim());
        }
      }
    }
  }

  pushCurrent();
  return chunks.length > 0 ? chunks : [trimmed];
}

export function splitSegmentNarration(narration: string): string[] {
  return splitNarrationIntoChunks(narration, 120);
}
