"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, CreditCard, GraduationCap, MessageSquare, User } from "lucide-react";
import { Brand } from "@/components/brand/Brand";
import { SiteButton } from "@/components/ui/site-button";
import {
  AGE_BAND_LABELS,
  AVAILABLE_SUBJECTS,
  CLASS_YEAR_LABELS,
  COMING_SOON_SUBJECTS,
  SUBJECT_LABELS,
  classYearsForRole,
  type AgeBand,
  type ClassYear,
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
} from "@heytutor/tutor-core";
import { safeNextPath } from "@/lib/auth/publicPaths";
import { SIGNUP_INTENT_COPY, signupIntent } from "@/lib/auth/signupIntent";

type Step = "role" | "about" | "lessons";

const STEPS: readonly Step[] = ["role", "about", "lessons"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OnboardingScreen({
  initialName,
  nextPath,
  suggestedRole = null,
}: {
  initialName: string;
  nextPath: string;
  suggestedRole?: LearnerRole | null;
}) {
  const router = useRouter();
  const copy = ONBOARDING_COPY;
  const intent = signupIntent(nextPath);
  const intentCopy = intent ? SIGNUP_INTENT_COPY[intent] : null;
  const [step, setStep] = useState<Step>("role");
  const [learnerRole, setLearnerRole] = useState<LearnerRole | null>(suggestedRole);
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [guardianEmail, setGuardianEmail] = useState("");
  const [name, setName] = useState(initialName);
  const [classYear, setClassYear] = useState<ClassYear | null>(null);
  const [subjects, setSubjects] = useState<SubjectId[]>([]);
  const [accent, setAccent] = useState<TutorAccent>(DEFAULT_ACCENT);
  const [familiarity, setFamiliarity] = useState<SubjectFamiliarity>(DEFAULT_FAMILIARITY);
  const [familiarityInfoOpen, setFamiliarityInfoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const stepIndex = STEPS.indexOf(step);
  const pathCopy = learnerRole === "college" ? copy.college : copy.other;
  const years = learnerRole ? classYearsForRole(learnerRole) : [];
  const heading =
    step === "role"
      ? { title: copy.role.title, body: copy.role.body }
      : step === "about"
        ? { title: pathCopy.title, body: pathCopy.body }
        : { title: copy.lessons.title, body: copy.lessons.body };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const goTo = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const toggleSubject = (subject: SubjectId) => {
    setError(null);
    setSubjects((current) =>
      current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject],
    );
  };

  const pickRole = (role: LearnerRole) => {
    if (role !== learnerRole) setClassYear(null);
    setLearnerRole(role);
    setError(null);
  };

  const refuseUnder13 = () => {
    setSaving(true);
    void fetch("/api/account/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ageBand: "under_13" }),
    }).finally(() => {
      router.replace("/login?refused=1");
    });
  };

  const aboutError = (): string | null => {
    if (!ageBand) return copy.shared.ageMissing;
    if (ageBand === "13_17" && !EMAIL_RE.test(guardianEmail.trim())) {
      return guardianEmail.trim() ? copy.shared.guardianError : copy.shared.guardianMissing;
    }
    if (!name.trim()) return copy.shared.nameMissing;
    if (!classYear) return copy.shared.yearMissing;
    return null;
  };

  const finish = async () => {
    setSaving(true);
    let done = false;
    try {
      const response = await fetch("/api/account/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          learnerRole,
          ageBand,
          guardianEmail,
          name,
          examGoal: "learning",
          classYear,
          subjects,
          audioLanguage: DEFAULT_AUDIO_LANGUAGE,
          accent,
          familiarity,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; refused?: boolean };
      if (data.refused) {
        done = true;
        router.replace("/login?refused=1");
        return;
      }
      if (!response.ok) {
        if (data.error === "guardian_required" || data.error === "name_required" || data.error === "goal_required") {
          setStep("about");
          setError(data.error === "guardian_required" ? copy.shared.guardianError : aboutError() ?? copy.shared.finishError);
        } else if (data.error === "role_required") {
          setStep("role");
          setError(copy.role.missing);
        } else if (data.error === "subjects_required") {
          setError(copy.shared.subjectsMissing);
        } else {
          setError(copy.shared.finishError);
        }
        return;
      }
      done = true;
      router.replace(safeNextPath(nextPath));
      router.refresh();
    } catch {
      setError(copy.shared.finishError);
    } finally {
      if (!done) setSaving(false);
    }
  };

  const advance = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (step === "role") {
      if (!learnerRole) {
        setError(copy.role.missing);
        return;
      }
      setStep("about");
      return;
    }
    if (step === "about") {
      if (ageBand === "under_13") {
        refuseUnder13();
        return;
      }
      const problem = aboutError();
      if (problem) {
        setError(problem);
        return;
      }
      setStep("lessons");
      return;
    }
    if (subjects.length === 0) {
      setError(copy.shared.subjectsMissing);
      return;
    }
    void finish();
  };

  const primaryLabel =
    step !== "lessons" ? copy.shared.continue : saving ? copy.shared.saving : intentCopy?.finish ?? copy.shared.start;
  const IntentIcon = intent === "question" ? MessageSquare : CreditCard;

  return (
    <main className="fx-aurora-soft flex min-h-dvh flex-col items-center px-5 py-10 sm:justify-center sm:py-12">
      <form
        onSubmit={advance}
        noValidate
        className="w-full max-w-xl rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[rgba(23,23,22,0.82)] p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8)] sm:p-8"
      >
        <div className="flex items-center justify-between gap-3">
          <Brand size="sm" />
          <p className="text-xs text-[rgba(237,237,235,0.5)]">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
        </div>

        <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Setup progress">
          {STEPS.map((item, index) => (
            <li key={item} aria-current={item === step ? "step" : undefined}>
              <span
                className={`block h-1 rounded-full transition-colors duration-300 ${
                  index <= stepIndex ? "bg-sky-500" : "bg-[rgba(255,255,255,0.1)]"
                }`}
              />
              <span
                className={`mt-2 block text-[11px] ${
                  index === stepIndex ? "text-frost" : "text-[rgba(237,237,235,0.45)]"
                }`}
              >
                {copy.steps[index]}
              </span>
            </li>
          ))}
        </ol>

        {intentCopy ? (
          <p className="mt-5 flex items-center gap-2.5 rounded-xl border border-[rgba(89,175,212,0.28)] bg-[rgba(89,175,212,0.08)] px-3 py-2 text-xs leading-5 text-sky-200">
            <IntentIcon className="h-4 w-4 shrink-0 text-sky-300" strokeWidth={2} aria-hidden />
            {intentCopy.onboarding}
          </p>
        ) : null}

        <div key={step} className="animate-fade-up">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-frost outline-none"
          >
            {heading.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[rgba(237,237,235,0.62)]">{heading.body}</p>

          {step === "role" ? (
            <div role="radiogroup" aria-label={copy.role.title} className="mt-6 grid gap-3">
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
            </div>
          ) : null}

          {step === "about" ? (
            <div className="mt-6 flex flex-col gap-6">
              <fieldset>
                <legend className="text-sm font-medium text-frost">{copy.shared.ageTitle}</legend>
                <p className="mt-1 text-xs leading-5 text-[rgba(237,237,235,0.5)]">{copy.shared.ageBody}</p>
                <div role="radiogroup" aria-label={copy.shared.ageTitle} className="mt-3 grid grid-cols-3 gap-2">
                  {(Object.keys(AGE_BAND_LABELS) as AgeBand[]).map((band) => (
                    <button
                      key={band}
                      type="button"
                      role="radio"
                      aria-checked={ageBand === band}
                      onClick={() => {
                        setAgeBand(band);
                        setError(null);
                      }}
                      className={`rounded-xl border px-3 py-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${
                        ageBand === band
                          ? "border-sky-500 bg-sky-500/12 text-frost"
                          : "border-[rgba(255,255,255,0.1)] text-[rgba(237,237,235,0.78)] hover:border-[rgba(255,255,255,0.22)]"
                      }`}
                    >
                      {AGE_BAND_LABELS[band]}
                    </button>
                  ))}
                </div>
                {ageBand === "13_17" ? (
                  <input
                    type="email"
                    autoComplete="off"
                    aria-label={copy.shared.guardianPlaceholder}
                    value={guardianEmail}
                    onChange={(event) => setGuardianEmail(event.target.value)}
                    placeholder={copy.shared.guardianPlaceholder}
                    className="animate-fade-up mt-3 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm text-frost outline-none focus:border-sky-500"
                  />
                ) : null}
              </fieldset>

              <label className="block text-sm font-medium text-frost">
                {copy.shared.nameLabel}
                <input
                  value={name}
                  autoComplete="given-name"
                  placeholder={copy.shared.namePlaceholder}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm font-normal text-frost outline-none focus:border-sky-500"
                />
              </label>

              <div className="block text-sm font-medium text-frost">
                {pathCopy.yearLegend}
                <YearSelect
                  label={pathCopy.yearLegend}
                  placeholder={copy.shared.yearPlaceholder}
                  years={years}
                  value={classYear}
                  onChange={(year) => {
                    setClassYear(year);
                    setError(null);
                  }}
                />
              </div>
            </div>
          ) : null}

          {step === "lessons" ? (
            <div className="mt-6 flex flex-col gap-6">
              <fieldset>
                <legend className="text-sm font-medium text-frost">{copy.shared.subjectsLegend}</legend>
                <p className="mt-1 text-xs text-[rgba(237,237,235,0.5)]">{copy.shared.subjectsHint}</p>
                <div className="mt-3 flex flex-wrap gap-2">
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
                <legend className="text-sm font-medium text-frost">{copy.shared.voiceLegend}</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Choice label="India" checked={accent === "india"} onClick={() => setAccent("india")} />
                  <Choice label="UK" checked={accent === "uk"} onClick={() => setAccent("uk")} />
                  <Choice label="US" checked={accent === "us"} onClick={() => setAccent("us")} />
                </div>
              </fieldset>

              <fieldset>
                <legend className="flex items-center gap-2 text-sm font-medium text-frost">
                  {copy.shared.familiarityLegend}
                  <button
                    type="button"
                    aria-expanded={familiarityInfoOpen}
                    aria-controls="familiarity-info"
                    aria-label={copy.shared.familiarityInfoLabel}
                    title={copy.shared.familiarityInfoLabel}
                    onClick={() => setFamiliarityInfoOpen((open) => !open)}
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold leading-none outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${
                      familiarityInfoOpen
                        ? "border-sky-500 bg-sky-500/12 text-sky-200"
                        : "border-[rgba(255,255,255,0.2)] text-[rgba(237,237,235,0.6)] hover:border-sky-500 hover:text-sky-200"
                    }`}
                  >
                    i
                  </button>
                </legend>
                {familiarityInfoOpen ? (
                  <div
                    id="familiarity-info"
                    className="mt-2 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.2)] px-3 py-2.5 text-xs leading-5 text-[rgba(237,237,235,0.62)]"
                  >
                    <ul className="flex flex-col gap-0.5">
                      {copy.shared.familiarityInfo.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[rgba(237,237,235,0.5)]">
                      {copy.shared.familiarityInfoNote}
                    </p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
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
            </div>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-[rgba(224,104,88,0.35)] bg-[rgba(224,104,88,0.1)] px-3 py-2 text-sm text-[#f0b4ac]"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-[rgba(255,255,255,0.06)] pt-5">
          {stepIndex > 0 ? (
            <SiteButton
              variant="ghost"
              size="md"
              onClick={() => goTo(STEPS[stepIndex - 1])}
              disabled={saving}
            >
              {copy.shared.back}
            </SiteButton>
          ) : (
            <span />
          )}
          <SiteButton type="submit" variant="ice" size="md" disabled={saving} className="min-w-[9.5rem]">
            {primaryLabel}
          </SiteButton>
        </div>
      </form>
    </main>
  );
}

function YearSelect({
  label,
  placeholder,
  years,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  years: readonly ClassYear[];
  value: ClassYear | null;
  onChange: (year: ClassYear) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = value ? years.indexOf(value) : -1;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const openMenu = () => {
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  return (
    <div ref={rootRef} className="relative mt-2 font-normal">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) openMenu();
            else setActive((index) => Math.min(years.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            else setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const year = years[active];
            if (year) onChange(year);
            setOpen(false);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`flex w-full items-center justify-between rounded-xl border bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-left text-sm outline-none focus:border-sky-500 ${
          open ? "border-sky-500" : "border-[rgba(255,255,255,0.1)]"
        } ${value ? "text-frost" : "text-[rgba(237,237,235,0.45)]"}`}
      >
        <span>{value ? CLASS_YEAR_LABELS[value] : placeholder}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-sky-300 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#171716] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
        >
          {years.map((year, index) => {
            const selected = year === value;
            const highlighted = index === active;
            return (
              <li key={year} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    onChange(year);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm ${
                    selected
                      ? "bg-sky-500/18 text-sky-200"
                      : highlighted
                        ? "bg-[rgba(74,158,255,0.1)] text-frost"
                        : "text-[rgba(237,237,235,0.82)]"
                  }`}
                >
                  {CLASS_YEAR_LABELS[year]}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
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
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={`flex items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${
        checked
          ? "border-sky-500 bg-sky-500/12"
          : "border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.18)] hover:border-[rgba(255,255,255,0.22)]"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          checked ? "bg-sky-500/18 text-sky-300" : "bg-[rgba(255,255,255,0.05)] text-[rgba(237,237,235,0.55)]"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-frost">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[rgba(237,237,235,0.55)]">{hint}</span>
      </span>
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-sky-500 bg-sky-500 text-[#0b1620]" : "border-[rgba(255,255,255,0.2)]"
        }`}
      >
        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
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
      aria-pressed={disabled ? undefined : checked}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${
        disabled
          ? "cursor-not-allowed border-[rgba(255,255,255,0.06)] text-[rgba(237,237,235,0.38)]"
          : checked
            ? "border-sky-500 bg-sky-500/12 text-sky-200"
            : "border-[rgba(255,255,255,0.1)] text-frost hover:border-[rgba(255,255,255,0.22)]"
      }`}
    >
      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : null}
      {/* Translation may replace text nodes; keep React's insertion anchor. */}
      <span>{label}</span>
    </button>
  );
}
