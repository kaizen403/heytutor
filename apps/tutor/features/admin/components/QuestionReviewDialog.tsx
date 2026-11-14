"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SiteButton } from "@/components/ui/site-button";
import { FIGURE_REVIEW_LABELS, REVIEW_TAGS, type FigureReview, type PlaygroundLecture, type PlaygroundReview } from "@/lib/admin/playgroundLecture";
import { updatePlaygroundLecture } from "../lib/playgroundClient";
import { FigureTag } from "./QuestionTags";

export function QuestionReviewDialog({ boardId, title, lecture, onClose, onSaved }: {
  boardId: string;
  title: string;
  lecture: PlaygroundLecture;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PlaygroundReview>(lecture.review ?? {
    stars: null, figure: null, tags: [], feedback: "", skipped: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (skipped: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await updatePlaygroundLecture(boardId, { action: "review", review: skipped
        ? { stars: null, figure: null, tags: [], feedback: "", skipped: true }
        : { ...draft, skipped: false } });
      onSaved();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save review");
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="site-theme z-[100] max-h-[90dvh] overflow-y-auto border-stroke bg-ink-900 text-frost sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review lesson</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap text-soft">{title}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-soft">All fields are optional. Reviews apply to this recording only.</p>
        <div className="flex items-center gap-2 text-xs text-soft">Recorded result <FigureTag lecture={lecture} /></div>
        <fieldset disabled={saving} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="playground-stars" className="block text-sm">Rating (optional)</label>
            <select id="playground-stars" value={draft.stars ?? ""} onChange={event => setDraft({ ...draft, stars: event.target.value ? Number(event.target.value) : null })} className="w-full rounded-md border border-stroke bg-ink-950 px-3 py-2 text-sm">
              <option value="">No rating</option>
              {[1, 2, 3, 4, 5].map(stars => <option key={stars} value={stars}>{stars} {stars === 1 ? "star" : "stars"}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="playground-feedback" className="block text-sm">Feedback (optional)</label>
            <textarea id="playground-feedback" rows={3} maxLength={1000} value={draft.feedback} onChange={event => setDraft({ ...draft, feedback: event.target.value })} placeholder="What worked, or what needs fixing?" className="w-full rounded-md border border-stroke bg-ink-950 px-3 py-2 text-sm" />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm">Diagram engine (optional)</legend>
            {Object.entries(FIGURE_REVIEW_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="figure-review" checked={draft.figure === value} onChange={() => setDraft({ ...draft, figure: value as FigureReview })} />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-soft"><input type="radio" name="figure-review" checked={draft.figure === null} onChange={() => setDraft({ ...draft, figure: null })} />Skip diagram feedback</label>
          </fieldset>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm">Tags (optional)</legend>
            {REVIEW_TAGS.map(tag => <label key={tag} className="flex items-center gap-2 rounded-md border border-stroke px-2 py-1.5 text-xs"><input type="checkbox" checked={draft.tags.includes(tag)} onChange={event => setDraft({ ...draft, tags: event.target.checked ? [...draft.tags, tag] : draft.tags.filter(item => item !== tag) })} />{tag}</label>)}
          </fieldset>
        </fieldset>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <SiteButton variant="ghost" size="sm" disabled={saving} onClick={() => void save(true)}>Skip review</SiteButton>
          <SiteButton variant="ice" size="sm" disabled={saving} onClick={() => void save(false)}>{saving ? "Saving…" : "Save review"}</SiteButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
