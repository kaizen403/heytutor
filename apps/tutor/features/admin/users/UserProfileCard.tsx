import type {
  AdminUserRow,
  AdminUserSettings,
  AdminUserSpendPeriod,
} from "@/lib/admin/types";
import { formatMillicentsUsd, formatRelativeTime } from "../shared/lib/format";

const LABEL_CLASS = "type-accent-xs text-faint";
const VALUE_CLASS = "text-xs text-frost";

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className={`${VALUE_CLASS} min-w-0 truncate text-right`} title={value}>
        {value}
      </dd>
    </div>
  );
}

export function UserProfileCard({
  user,
  settings,
  spend,
}: {
  user: AdminUserRow;
  settings: AdminUserSettings | null;
  spend: AdminUserSpendPeriod[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="glass rounded-xl px-3 py-2.5">
        <p className="type-accent-xs text-faint">Profile</p>
        <dl className="mt-1 divide-y divide-stroke/60">
          <Row label="User id" value={user.userId} />
          <Row label="Email" value={user.email ?? "anonymous (cookie identity)"} />
          <Row label="Name" value={user.name ?? ""} />
          <Row label="Joined" value={formatRelativeTime(user.createdAt)} />
          <Row
            label="Onboarding"
            value={user.onboardingCompletedAt ? formatRelativeTime(user.onboardingCompletedAt) : "not completed"}
          />
          <Row label="Exam goal" value={user.examGoal ?? ""} />
          <Row label="Class year" value={user.classYear ?? ""} />
          <Row label="Learner role" value={user.learnerRole ?? ""} />
          <Row label="Subjects" value={user.subjects.join(", ")} />
        </dl>
      </div>

      <div className="space-y-3">
        <div className="glass rounded-xl px-3 py-2.5">
          <p className="type-accent-xs text-faint">Settings</p>
          {settings ? (
            <dl className="mt-1 divide-y divide-stroke/60">
              <Row label="Fast mode" value={settings.fastMode ? "on" : "off"} />
              <Row label="Narration" value={settings.narrationEnabled ? "on" : "off"} />
              <Row label="Audio language" value={settings.audioLanguage} />
              <Row label="Accent" value={settings.accent} />
              <Row label="UI language" value={settings.uiLanguage} />
              <Row label="Voice speed" value={`${settings.speedMultiplier}×`} />
              <Row label="Teaching note" value={settings.teachingNote} />
            </dl>
          ) : (
            <p className="type-accent-xs mt-2 text-faint">No settings row yet.</p>
          )}
        </div>

        <div className="glass rounded-xl px-3 py-2.5">
          <p className="type-accent-xs text-faint">Spend by period · Fireworks + ElevenLabs</p>
          {spend.length > 0 ? (
            <dl className="mt-1 divide-y divide-stroke/60">
              {spend.map((entry) => (
                <Row
                  key={entry.period}
                  label={entry.period}
                  value={`${formatMillicentsUsd(entry.spentMillicents)}${
                    entry.bonusMillicents > 0
                      ? ` + ${formatMillicentsUsd(entry.bonusMillicents)} bonus`
                      : ""
                  }`}
                />
              ))}
            </dl>
          ) : (
            <p className="type-accent-xs mt-2 text-faint">No billing rows yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
