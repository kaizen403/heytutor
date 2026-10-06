export interface LevelRelationSource {
  lower: number;
  upper: number;
  indexedCollection: boolean;
  from: number | null;
  to: number | null;
}

export function levelRelationSource(question: string): Readonly<LevelRelationSource> | null {
  if (typeof question !== "string" || question.length > 2000) return null;
  const text = question.trim();
  const series = /^(?:Draw|Show)\s+(?:the\s+)?energy[- ]level\s+diagram\s+for\s+(?:the\s+)?(Lyman|Balmer|Paschen|Brackett|Pfund|Humphreys)\s+series\s+of\s+(?:the\s+)?hydrogen\s+atom\.?$/i.exec(text);
  if (series) {
    const lower = ["lyman", "balmer", "paschen", "brackett", "pfund", "humphreys"].indexOf(series[1].toLowerCase()) + 1;
    return Object.freeze({ lower, upper: lower + 1, indexedCollection: true, from: null, to: null });
  }
  const event = /^(?:A\s+|The\s+)?hydrogen\s+atom\s+(emits|absorbs)\s+(?:a\s+)?photon\s+(?:during|in)\s+(?:a\s+|the\s+)?transition\s+from\s+n\s*=\s*(\d+)\s*(?:to|->|→)\s*n\s*=\s*(\d+)(?:\.\s*(?:Draw|Show)\s+(?:the\s+)?energy[- ]level\s+diagram)?\.?$/i.exec(text);
  const diagram = /^(?:Draw|Show)\s+(?:the\s+)?energy[- ]level\s+diagram\s+for\s+(?:a\s+|the\s+)?hydrogen\s+atom\s+(emission|absorption)\s+transition\s+from\s+n\s*=\s*(\d+)\s*(?:to|->|→)\s*n\s*=\s*(\d+)\.?$/i.exec(text);
  const match = event ?? diagram;
  if (!match) return null;
  const from = Number(match[2]);
  const to = Number(match[3]);
  if (![from, to].every((n) => Number.isInteger(n) && n >= 1 && n <= 64) || from === to) return null;
  const absorption = /^(?:absorbs|absorption)$/i.test(match[1]);
  if (absorption !== (to > from)) return null;
  return Object.freeze({ lower: Math.min(from, to), upper: Math.max(from, to), indexedCollection: false, from, to });
}
