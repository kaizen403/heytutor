"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/brand/Brand";
import { SiteButton } from "@/components/ui/site-button";
import {
  AGE_BAND_LABELS,
  AVAILABLE_SUBJECTS,
  CLASS_YEAR_LABELS,
  CLASS_YEARS,
  EXAM_GOAL_LABELS,
  EXAM_GOALS,
  SUBJECT_LABELS,
  type AgeBand,
  type ClassYear,
  type ExamGoal,
  type SubjectId,
} from "@/lib/account/types";
import {
  DEFAULT_ACCENT,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_FAMILIARITY,
  type SubjectFamiliarity,
  type TutorAccent,
  type TutorAudioLanguage,
} from "@heytutor/tutor-core";
import { safeNextPath } from "@/lib/auth/publicPaths";

type Step = "age" | "classroom";

export function OnboardingScreen({
  initialName,
  nextPath,
}: {
  initialName: string;
  nextPath: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("age");
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [guardianEmail, setGuardianEmail] = useState("");
  const [name, setName] = useState(initialName);
  const [examGoal, setExamGoal] = useState<ExamGoal | null>(null);
  const [classYear, setClassYear] = useState<ClassYear | null>(null);
  const [subjects, setSubjects] = useState<SubjectId[]>([]);
  const [audioLanguage, setAudioLanguage] = useState<TutorAudioLanguage>(DEFAULT_AUDIO_LANGUAGE);
  const [accent, setAccent] = useState<TutorAccent>(DEFAULT_ACCENT);
  const [familiarity, setFamiliarity] = useState<SubjectFamiliarity>(DEFAULT_FAMILIARITY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleSubject = (subject: SubjectId) => {
    setSubjects((current) =>
      current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject],
    );
  };

  const continueAge = () => {
    setError(null);
    if (!ageBand) {
      setError("Choose your age group.");
      return;
    }
    if (ageBand === "under_13") {
      void fetch("/api/account/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageBand: "under_13" }),
      }).finally(() => {
        router.replace("/login?refused=1");
      });
      return;
    }
    if (ageBand === "13_17" && !guardianEmail.trim()) {
      setError("A guardian email is required if you are 13–17.");
      return;
    }
    setStep("classroom");
  };

  const finish = async () => {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/account/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ageBand,
          guardianEmail,
          name,
          examGoal,
          classYear,
          subjects,
          audioLanguage,
          accent,
          familiarity,
        }),
      });
      const data = (await response.json()) as { error?: string; refused?: boolean };
      if (data.refused) {
        router.replace("/login?refused=1");
        return;
      }
      if (!response.ok) {
        setError(
          data.error === "guardian_required"
            ? "Enter a valid guardian email."
            : "Finish every step before continuing.",
        );
        return;
      }
      router.replace(safeNextPath(nextPath));
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="fx-aurora-soft flex min-h-dvh flex-col items-center px-5 py-12">
      <div className="w-full max-w-xl rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[rgba(23,23,22,0.82)] p-7">
        <Brand size="sm" />
        <p className="mt-5 text-xs uppercase tracking-[0.08em] text-[rgba(237,237,235,0.42)]">
          {step === "age" ? "Step 1 of 2" : "Step 2 of 2"}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-frost">
          {step === "age" ? "How old are you?" : "Set up your classroom"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[rgba(237,237,235,0.62)]">
          {step === "age"
            ? "Accelute is a student product. Under 13 is not allowed. Ages 13–17 need a guardian email."
            : "This shapes the home board. It never reaches the diagram engine."}
        </p>

        {error ? (
          <p className="mt-4 rounded-xl border border-[rgba(224,104,88,0.35)] bg-[rgba(224,104,88,0.1)] px-3 py-2 text-sm text-[#f0b4ac]">
            {error}
          </p>
        ) : null}

        {step === "age" ? (
          <div className="mt-6 flex flex-col gap-3">
            {(Object.keys(AGE_BAND_LABELS) as AgeBand[]).map((band) => (
              <button
                key={band}
                type="button"
                onClick={() => setAgeBand(band)}
                className={`rounded-xl border px-4 py-3 text-left text-sm ${
                  ageBand === band
                    ? "border-sky-500 bg-sky-500/12 text-frost"
                    : "border-[rgba(255,255,255,0.1)] text-[rgba(237,237,235,0.78)]"
                }`}
              >
                {AGE_BAND_LABELS[band]}
              </button>
            ))}
            {ageBand === "13_17" ? (
              <input
                type="email"
                value={guardianEmail}
                onChange={(event) => setGuardianEmail(event.target.value)}
                placeholder="Guardian email"
                className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm text-frost outline-none focus:border-sky-500"
              />
            ) : null}
            <SiteButton variant="ice" size="md" onClick={continueAge}>
              Continue
            </SiteButton>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            <label className="block text-sm text-[rgba(237,237,235,0.7)]">
              Display name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm text-frost outline-none focus:border-sky-500"
              />
            </label>
            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">Why are you here?</legend>
              <div className="flex flex-wrap gap-2">
                {EXAM_GOALS.map((goal) => (
                  <Choice
                    key={goal}
                    label={EXAM_GOAL_LABELS[goal]}
                    checked={examGoal === goal}
                    onClick={() => setExamGoal(goal)}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">Class / year</legend>
              <div className="flex flex-wrap gap-2">
                {CLASS_YEARS.map((year) => (
                  <Choice
                    key={year}
                    label={CLASS_YEAR_LABELS[year]}
                    checked={classYear === year}
                    onClick={() => setClassYear(year)}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">Subjects</legend>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_SUBJECTS.map((subject) => (
                  <Choice
                    key={subject}
                    label={SUBJECT_LABELS[subject]}
                    checked={subjects.includes(subject)}
                    onClick={() => toggleSubject(subject)}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">Voice</legend>
              <div className="flex flex-wrap gap-2">
                <Choice label="English" checked={audioLanguage === "english"} onClick={() => setAudioLanguage("english")} />
                <Choice label="Hindi" checked={audioLanguage === "hindi"} onClick={() => setAudioLanguage("hindi")} />
                <Choice label="India" checked={accent === "india"} onClick={() => setAccent("india")} />
                <Choice label="UK" checked={accent === "uk"} onClick={() => setAccent("uk")} />
                <Choice label="US" checked={accent === "us"} onClick={() => setAccent("us")} />
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">Default familiarity</legend>
              <div className="flex flex-wrap gap-2">
                <Choice label="New" checked={familiarity === "new"} onClick={() => setFamiliarity("new")} />
                <Choice label="Normal" checked={familiarity === "normal"} onClick={() => setFamiliarity("normal")} />
                <Choice label="Revision" checked={familiarity === "revision"} onClick={() => setFamiliarity("revision")} />
              </div>
            </fieldset>
            <div className="flex gap-2">
              <SiteButton variant="ghost" size="md" onClick={() => setStep("age")}>
                Back
              </SiteButton>
              <SiteButton variant="ice" size="md" onClick={() => void finish()} disabled={saving}>
                {saving ? "Saving…" : "Start teaching"}
              </SiteButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Choice({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
        checked ? "border-sky-500 bg-sky-500/12 text-sky-200" : "border-[rgba(255,255,255,0.1)] text-frost"
      }`}
    >
      {label}
    </button>
  );
}
