"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, User } from "lucide-react";
import { Brand } from "@/components/brand/Brand";
import { SiteButton } from "@/components/ui/site-button";
import {
  AGE_BAND_LABELS,
  AVAILABLE_SUBJECTS,
  CLASS_YEAR_LABELS,
  COMING_SOON_SUBJECTS,
  EXAM_GOAL_LABELS,
  SUBJECT_LABELS,
  classYearsForRole,
  examGoalsForRole,
  type AgeBand,
  type ClassYear,
  type ExamGoal,
  type LearnerRole,
  type SubjectId,
} from "@/lib/account/types";
import { ONBOARDING_COPY } from "@/lib/account/onboardingCopy";
import {
  DEFAULT_ACCENT,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_FAMILIARITY,
  type SubjectFamiliarity,
  type TutorAccent,
  type TutorAudioLanguage,
} from "@heytutor/tutor-core";
import { safeNextPath } from "@/lib/auth/publicPaths";
import { learnerRoleForLogin, type LoginRole } from "@/lib/auth/loginRole";

type Step = "role" | "setup";

export function OnboardingScreen({
  initialName,
  nextPath,
  initialLoginRole = null,
}: {
  initialName: string;
  nextPath: string;
  initialLoginRole?: LoginRole | null;
}) {
  const router = useRouter();
  const copy = ONBOARDING_COPY;
  const presetRole = learnerRoleForLogin(initialLoginRole);
  const [step, setStep] = useState<Step>(presetRole ? "setup" : "role");
  const [learnerRole, setLearnerRole] = useState<LearnerRole | null>(presetRole);
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

  const pathCopy = learnerRole === "college" ? copy.college : copy.other;
  const goals = learnerRole ? examGoalsForRole(learnerRole) : [];
  const years = learnerRole ? classYearsForRole(learnerRole) : [];

  const toggleSubject = (subject: SubjectId) => {
    setSubjects((current) =>
      current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject],
    );
  };

  const pickRole = (role: LearnerRole) => {
    setLearnerRole(role);
    setExamGoal(null);
    setClassYear(null);
    setError(null);
  };

  const continueRole = () => {
    setError(null);
    if (!learnerRole) {
      setError(copy.role.missing);
      return;
    }
    setStep("setup");
  };

  const refuseUnder13 = () => {
    void fetch("/api/account/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ageBand: "under_13" }),
    }).finally(() => {
      router.replace("/login?refused=1");
    });
  };

  const finish = async () => {
    setError(null);
    if (!ageBand) {
      setError(copy.shared.ageMissing);
      return;
    }
    if (ageBand === "under_13") {
      refuseUnder13();
      return;
    }
    if (ageBand === "13_17" && !guardianEmail.trim()) {
      setError(copy.shared.guardianMissing);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/account/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          learnerRole,
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
          data.error === "guardian_required" ? copy.shared.guardianError : copy.shared.finishError,
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
          {step === "role" ? copy.role.kicker : pathCopy.kicker}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-frost">
          {step === "role" ? copy.role.title : pathCopy.title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[rgba(237,237,235,0.62)]">
          {step === "role" ? copy.role.body : pathCopy.body}
        </p>

        {error ? (
          <p className="mt-4 rounded-xl border border-[rgba(224,104,88,0.35)] bg-[rgba(224,104,88,0.1)] px-3 py-2 text-sm text-[#f0b4ac]">
            {error}
          </p>
        ) : null}

        {step === "role" ? (
          <div className="mt-6 flex flex-col gap-3">
            <RoleCard
              icon={<GraduationCap className="h-5 w-5" strokeWidth={2} aria-hidden />}
              label={copy.role.college.label}
              hint={copy.role.college.hint}
              checked={learnerRole === "college"}
              onClick={() => pickRole("college")}
            />
            <RoleCard
              icon={<User className="h-5 w-5" strokeWidth={2} aria-hidden />}
              label={copy.role.other.label}
              hint={copy.role.other.hint}
              checked={learnerRole === "other"}
              onClick={() => pickRole("other")}
            />
            <SiteButton variant="ice" size="md" onClick={continueRole}>
              {copy.role.continue}
            </SiteButton>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">
                {copy.shared.ageTitle}
              </legend>
              <p className="mb-3 text-xs leading-5 text-[rgba(237,237,235,0.5)]">
                {copy.shared.ageBody}
              </p>
              <div className="flex flex-col gap-2">
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
              </div>
              {ageBand === "13_17" ? (
                <input
                  type="email"
                  value={guardianEmail}
                  onChange={(event) => setGuardianEmail(event.target.value)}
                  placeholder={copy.shared.guardianPlaceholder}
                  className="mt-3 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm text-frost outline-none focus:border-sky-500"
                />
              ) : null}
            </fieldset>

            <label className="block text-sm text-[rgba(237,237,235,0.7)]">
              {copy.shared.nameLabel}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm text-frost outline-none focus:border-sky-500"
              />
            </label>

            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">
                {pathCopy.goalLegend}
              </legend>
              <div className="flex flex-wrap gap-2">
                {goals.map((goal) => (
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
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">
                {pathCopy.yearLegend}
              </legend>
              <div className="flex flex-wrap gap-2">
                {years.map((year) => (
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
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">
                {copy.shared.subjectsLegend}
              </legend>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_SUBJECTS.map((subject) => (
                  <Choice
                    key={subject}
                    label={SUBJECT_LABELS[subject]}
                    checked={subjects.includes(subject)}
                    onClick={() => toggleSubject(subject)}
                  />
                ))}
                {COMING_SOON_SUBJECTS.filter((subject) => !AVAILABLE_SUBJECTS.includes(subject)).map(
                  (subject) => (
                    <Choice
                      key={subject}
                      label={`${SUBJECT_LABELS[subject]} soon`}
                      checked={false}
                      disabled
                    />
                  ),
                )}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">
                {copy.shared.voiceLegend}
              </legend>
              <div className="flex flex-wrap gap-2">
                <Choice
                  label="English"
                  checked={audioLanguage === "english"}
                  onClick={() => setAudioLanguage("english")}
                />
                <Choice
                  label="Hindi"
                  checked={audioLanguage === "hindi"}
                  onClick={() => setAudioLanguage("hindi")}
                />
                <Choice label="India" checked={accent === "india"} onClick={() => setAccent("india")} />
                <Choice label="UK" checked={accent === "uk"} onClick={() => setAccent("uk")} />
                <Choice label="US" checked={accent === "us"} onClick={() => setAccent("us")} />
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm text-[rgba(237,237,235,0.7)]">
                {copy.shared.familiarityLegend}
              </legend>
              <div className="flex flex-wrap gap-2">
                <Choice
                  label="New"
                  checked={familiarity === "new"}
                  onClick={() => setFamiliarity("new")}
                />
                <Choice
                  label="Normal"
                  checked={familiarity === "normal"}
                  onClick={() => setFamiliarity("normal")}
                />
                <Choice
                  label="Revision"
                  checked={familiarity === "revision"}
                  onClick={() => setFamiliarity("revision")}
                />
              </div>
            </fieldset>

            <div className="flex gap-2">
              <SiteButton variant="ghost" size="md" onClick={() => setStep("role")}>
                {copy.shared.back}
              </SiteButton>
              <SiteButton variant="ice" size="md" onClick={() => void finish()} disabled={saving}>
                {saving ? copy.shared.saving : copy.shared.start}
              </SiteButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function RoleCard({
  icon,
  label,
  hint,
  checked,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-2xl border px-4 py-4 text-left ${
        checked
          ? "border-sky-500 bg-sky-500/12"
          : "border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.18)]"
      }`}
    >
      <span className={`mt-0.5 ${checked ? "text-sky-300" : "text-[rgba(237,237,235,0.55)]"}`}>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-frost">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[rgba(237,237,235,0.55)]">{hint}</span>
      </span>
    </button>
  );
}

function Choice({
  label,
  checked,
  onClick,
  disabled,
}: {
  label: string;
  checked: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
        disabled
          ? "cursor-not-allowed border-[rgba(255,255,255,0.06)] text-[rgba(237,237,235,0.38)]"
          : checked
            ? "border-sky-500 bg-sky-500/12 text-sky-200"
            : "border-[rgba(255,255,255,0.1)] text-frost"
      }`}
    >
      {label}
    </button>
  );
}
