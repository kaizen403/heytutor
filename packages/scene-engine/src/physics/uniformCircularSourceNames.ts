import type { SceneDocument } from "../types";

/** Mathematical identities for a single completely read circular source. */
export function uniformCircularSourceNames(question: string): { actor: string; path: string } | null {
  const actor = /^A\s+(car|stone|particle|body|bead)\s+moves\b/i.exec(question.trim())?.[1]?.toLowerCase();
  const path = /\b(horizontal circle|circular track|circular path|circle)\b/i.exec(question)?.[1]?.toLowerCase();
  return actor && path ? { actor, path } : null;
}

/** Wrapped labels retain the whole source description, with compact individual marks. */
export function addUniformCircularSourceNames(document: SceneDocument): SceneDocument {
  const names = uniformCircularSourceNames(String(document.source.question));
  if (!names) return document;
  const bodyId = document.entities.some(entity => entity.id === "body") ? "body" : "P";
  for (const [target, text] of [[bodyId, names.actor], ["path", names.path], ["O", "centre"]] as const) {
    const chunks = text.length <= 16 ? [text] : text.split(" ");
    chunks.forEach((chunk, index) => {
      const id = `source_name_${target}_${index}`;
      // A caption is attached to the physical body through an engine-owned
      // label construction, not a replacement text body or a physical scalar.
      document.entities.push({ id, kind: "label", role: "source identity caption", label: chunk });
      document.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target, text: chunk }, outputs: [id] });
      document.requiredEntityIds.push(id);
      document.revealGroups.find(group => group.entityIds.includes(target))?.entityIds.push(id);
    });
  }
  return document;
}

