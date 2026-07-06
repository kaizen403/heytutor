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

        let i = 0;
        while (i < clause.length) {
          let end = Math.min(i + maxLength, clause.length);

          if (end < clause.length) {
            const slice = clause.slice(i, end);
            const eqIdx = slice.lastIndexOf("=");
            const arrowIdx = slice.lastIndexOf("→");
            const splitIdx = Math.max(eqIdx, arrowIdx);

            if (splitIdx > maxLength * 0.4) {
              end = i + splitIdx + 1;
            } else {
              let spaceIdx = slice.lastIndexOf(" ");
              if (spaceIdx < maxLength * 0.4) {
                for (let back = 1; back <= 20 && end - back > i; back++) {
                  if (clause[end - back] === " ") {
                    end = end - back;
                    spaceIdx = end - i;
                    break;
                  }
                }
              }
              if (spaceIdx >= maxLength * 0.4) {
                end = i + spaceIdx;
              }
            }
          }

          chunks.push(clause.slice(i, end).trim());
          i = end;
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
