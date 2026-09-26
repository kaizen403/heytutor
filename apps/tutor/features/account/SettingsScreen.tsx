"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { AccountCard, AccountPageFrame } from "./AccountPageFrame";
import { SiteButton } from "@/components/ui/site-button";
import { BoardInkControls } from "@/features/tutor-session/components/BoardInkControls";
import {
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTIONS,
  isSettingsSection,
  type SettingsSection,
} from "@/lib/account/types";
import {
  DEFAULT_ACCOUNT_SETTINGS,
  TEACHING_NOTE_MAX,
  type AccountSettings,
} from "@/lib/account/userSettings";
import {
  getMarkerColorHex,
  toggleMarkerStunt,
} from "@/features/tutor-session/components/SettingsDrawer";
import {
  LECTURE_FILE_TYPES,
  LECTURE_FILE_TYPE_LABELS,
} from "@/lib/account/lessonSettings";
import {
  MarkerStuntPreview,
  STUNT_COPY,
  STUNT_KINDS,
  type StuntKind,
} from "@heytutor/whiteboard";
import { getLegalHref } from "@/lib/site";
import type { AccountProfile } from "@/lib/account/types";
import { PlanUsageCard } from "./PlanUsageCard";
import { createSettingsPatchQueue, type SaveStatus } from "@/lib/account/settingsPatchQueue";

export function SettingsScreen({ section }: { section: string }) {
  const router = useRouter();
  const active: SettingsSection = isSettingsSection(section) ? section : "general";
  const [settings, setSettings] = useState<AccountSettings>(DEFAULT_ACCOUNT_SETTINGS);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const saveQueueRef = useRef<ReturnType<typeof createSettingsPatchQueue<AccountSettings>> | null>(null);

  useEffect(() => {
    const queue = createSettingsPatchQueue<AccountSettings>({
      send: async (patch) => {
        const response = await fetch("/api/account/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!response.ok) throw Object.assign(new Error("Could not save settings"), { status: response.status });
      },
      onStatus: setSaveStatus,
    });
    saveQueueRef.current = queue;
    return () => {
      queue.dispose();
      saveQueueRef.current = null;
    };
  }, []);

  useEffect(() => {
    void fetch("/api/account/me")
      .then((response) => response.json())
      .then((data: { settings?: AccountSettings; profile?: AccountProfile }) => {
        if (data.settings) setSettings(data.settings);
        if (data.profile) setProfile(data.profile);
      });
  }, []);

  const patch = (partial: Partial<AccountSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
    saveQueueRef.current?.enqueue(partial);
  };

  return (
    <AccountPageFrame title="Settings" subtitle="Account settings. The in-lesson drawer stays a quick sheet for the board.">
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto lg:w-48 lg:flex-col">
          {SETTINGS_SECTIONS.map((id) => (
            <Link
              key={id}
              href={id === "general" ? "/settings" : `/settings/${id}`}
              className={`rounded-lg px-3 py-2 text-sm ${
                active === id ? "bg-sky-500/12 text-sky-200" : "text-[rgba(237,237,235,0.62)] hover:text-frost"
              }`}
            >
              {SETTINGS_SECTION_LABELS[id]}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-4">
          {saveStatus && (
            <div className="flex items-center gap-2 text-xs text-[rgba(237,237,235,0.62)]" role="status" aria-live="polite">
              <span>{
                saveStatus === "saving" ? "Saving settings…" :
                saveStatus === "saved" ? "Settings saved" :
                saveStatus === "retrying" ? "Save failed. Retrying…" : "Could not save settings."
              }</span>
              {saveStatus === "error" && (
                <button type="button" className="text-sky-300 underline" onClick={() => saveQueueRef.current?.retry()}>
                  Retry
                </button>
              )}
            </div>
          )}
          {active === "general" ? (
            <AccountCard title="General">
              <p className="text-sm text-[rgba(237,237,235,0.62)]">
                UI language is English. Written lessons stay English. Hindi UI comes later.
              </p>
              <Toggle
                title="Show follow-up suggestions on home"
                checked={settings.showHomeSuggestions}
                onChange={(checked) => patch({ showHomeSuggestions: checked })}
              />
              <Toggle
                title="Reduced motion"
                checked={settings.reducedMotion}
                onChange={(checked) => patch({ reducedMotion: checked })}
              />
              <SiteButton className="mt-3" size="sm" onClick={() => router.push("/library")}>
                Archived boards
              </SiteButton>
            </AccountCard>
          ) : null}

          {active === "tutor" ? (
            <AccountCard title="Tutor">
              <p className="mb-3 text-xs text-[rgba(237,237,235,0.5)]">
                These instructions go into the teaching prompt only. They never reach scene-engine geometry.
                Familiarity is chosen in the lesson chat bar.
              </p>
              <Toggle
                title="Always show units"
                checked={settings.alwaysShowUnits}
                onChange={(checked) => patch({ alwaysShowUnits: checked })}
              />
              <Toggle
                title="Always state the law first"
                checked={settings.alwaysStateLawFirst}
                onChange={(checked) => patch({ alwaysStateLawFirst: checked })}
              />
              <label className="mt-3 block text-xs text-[rgba(237,237,235,0.55)]">
                Teaching note
                <textarea
                  value={settings.teachingNote}
                  maxLength={TEACHING_NOTE_MAX}
                  onChange={(event) => patch({ teachingNote: event.target.value })}
                  rows={4}
                  className="mt-1 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.22)] px-3 py-2 text-sm text-frost"
                />
              </label>
            </AccountCard>
          ) : null}

          {active === "voice" ? (
            <AccountCard title="Voice and speech">
              <div className="mt-3 flex flex-wrap gap-2">
                <Choice label="India" checked={settings.accent === "india"} onClick={() => patch({ accent: "india" })} />
                <Choice label="UK" checked={settings.accent === "uk"} onClick={() => patch({ accent: "uk" })} />
                <Choice label="US" checked={settings.accent === "us"} onClick={() => patch({ accent: "us" })} />
              </div>
              <label className="mt-4 block text-xs text-[rgba(237,237,235,0.55)]">
                Playback speed {settings.speedMultiplier}x
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.25}
                  value={settings.speedMultiplier}
                  onChange={(event) => patch({ speedMultiplier: Number(event.target.value) })}
                  className="mt-2 w-full accent-sky-500"
                />
              </label>
              <Toggle
                title="Subtitles"
                checked={settings.subtitlesEnabled}
                onChange={(checked) => patch({ subtitlesEnabled: checked })}
              />
              <p className="mt-3 text-xs text-[rgba(237,237,235,0.45)]">
                Voice preview uses the next spoken lesson. There is no separate sample clip in v1.
              </p>
            </AccountCard>
          ) : null}

          {active === "board" ? (
            <AccountCard title="Board">
              <BoardInkControls settings={settings} onChange={patch} />
              <Toggle
                title="Subtitles on the board"
                checked={settings.subtitlesEnabled}
                onChange={(checked) => patch({ subtitlesEnabled: checked })}
              />
              <div className="mt-5">
                <h3 className="text-sm text-frost">Marker stunts</h3>
                <p className="mt-1 mb-3 text-xs text-[rgba(237,237,235,0.45)]">
                  Tricks the hand plays in the gaps between strokes, while the tutor is talking.
                  Pick the ones you want and the board plays only those. The marker stays where it
                  is standing and never leaves the board.
                </p>
                <MarkerStuntChooser
                  selected={settings.markerStunts}
                  ink={getMarkerColorHex(settings.markerColor)}
                  onToggle={(kind) =>
                    patch({ markerStunts: toggleMarkerStunt(settings.markerStunts, kind) })
                  }
                />
              </div>
              <p className="mt-3 text-xs text-[rgba(237,237,235,0.45)]">
                The writing surface stays paper. We are not theming the board.
              </p>
            </AccountCard>
          ) : null}

          {active === "appearance" ? (
            <AccountCard title="Appearance">
              <p className="text-sm text-[rgba(237,237,235,0.62)]">
                Accelute is dark chrome and a paper board. There is no light theme in this version.
              </p>
            </AccountCard>
          ) : null}

          {active === "personalization" ? (
            <AccountCard title="Personalization">
              <p className="text-sm text-[rgba(237,237,235,0.62)]">
                Saved teaching note is the only memory the tutor reads. Accelute does not claim ChatGPT-style automatic memory.
              </p>
              <Toggle
                title="Remember topics I struggle with"
                checked={settings.rememberWeakTopics}
                onChange={(checked) => patch({ rememberWeakTopics: checked })}
              />
              <SiteButton
                className="mt-3"
                size="sm"
                onClick={() => patch({ teachingNote: "" })}
              >
                Clear teaching note
              </SiteButton>
            </AccountCard>
          ) : null}

          {active === "notifications" ? (
            <AccountCard title="Notifications">
              <Toggle
                title="Weekly recap email"
                checked={settings.emailWeeklyRecap}
                onChange={(checked) => patch({ emailWeeklyRecap: checked })}
              />
              <Toggle
                title="Guardian notice for minors"
                checked={settings.emailGuardianNotice}
                onChange={(checked) => patch({ emailGuardianNotice: checked })}
              />
              <p className="mt-3 text-xs text-[rgba(237,237,235,0.45)]">No in-app or push notifications in v1.</p>
            </AccountCard>
          ) : null}

          {active === "data" ? (
            <AccountCard title="Data controls">
              <p className="text-sm text-[rgba(237,237,235,0.62)]">
                We do not train foundation models on student questions unless a future toggle says so. The default is off, and there is no opt-in here yet.
              </p>
              <div className="mt-4">
                <h3 className="text-sm text-frost">Lecture file type</h3>
                <p className="mt-1 mb-3 text-xs text-[rgba(237,237,235,0.45)]">
                  The format of Lecture download. MP4 is the default. Switch to WebM if a player will
                  not open the file.
                </p>
                <div className="flex flex-wrap gap-2">
                  {LECTURE_FILE_TYPES.map((value) => (
                    <Choice
                      key={value}
                      label={LECTURE_FILE_TYPE_LABELS[value]}
                      checked={settings.lectureFileType === value}
                      onClick={() => patch({ lectureFileType: value })}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <SiteButton size="sm" onClick={() => void downloadExport()}>
                  Export all boards
                </SiteButton>
                <SiteButton
                  size="sm"
                  onClick={() => {
                    if (!window.confirm("Archive every board?")) return;
                    void fetch("/api/account/boards", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "archive_all" }),
                    }).then(() => router.push("/library"));
                  }}
                >
                  Archive all boards
                </SiteButton>
                <SiteButton
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm("Delete every board on this account?")) return;
                    void fetch("/api/account/boards", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "delete_all" }),
                    }).then(() => router.push("/library"));
                  }}
                >
                  Delete all boards
                </SiteButton>
                <SiteButton
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm("Delete this account?")) return;
                    void fetch("/api/account", { method: "DELETE" }).then(() => {
                      window.location.href = "/login";
                    });
                  }}
                >
                  Delete account
                </SiteButton>
              </div>
            </AccountCard>
          ) : null}

          {active === "security" ? (
            <AccountCard title="Security">
              <p className="text-sm text-frost">{profile?.email ?? "No email on this account"}</p>
              <p className="mt-1 text-xs text-[rgba(237,237,235,0.5)]">
                {profile?.emailVerified ? "Email verified" : "Google or magic link is the sign-in method. No password in v1."}
              </p>
              <SiteButton className="mt-3" size="sm" onClick={() => void signOut({ callbackUrl: "/login" })}>
                Log out
              </SiteButton>
            </AccountCard>
          ) : null}

          {active === "usage" ? (
            <PlanUsageCard
              compact
              ageBand={profile?.ageBand}
              onOpenUsage={() => router.push("/usage")}
            />
          ) : null}

          {active === "help" ? (
            <AccountCard title="Help">
              <ul className="space-y-2 text-sm text-[rgba(237,237,235,0.75)]">
                <li>What’s new: student accounts, library, progress, and server-backed settings.</li>
                <li>
                  Email <a className="text-sky-300" href="mailto:hi@accelute.co">hi@accelute.co</a>
                </li>
                <li>
                  <a className="text-sky-300" href={getLegalHref("/terms")}>Terms</a>
                  {" · "}
                  <a className="text-sky-300" href={getLegalHref("/privacy")}>Privacy</a>
                </li>
                <li>Keyboard: Escape closes menus. The lesson bar still owns pause and send.</li>
              </ul>
            </AccountCard>
          ) : null}
        </div>
      </div>
    </AccountPageFrame>
  );
}

/**
 * The same choice as the lesson drawer, laid out for a page rather than a
 * sheet: the showcase is big enough to actually read the trick, and every
 * option carries its own caption instead of only the one being shown.
 */
function MarkerStuntChooser({
  selected,
  ink,
  onToggle,
}: {
  selected: readonly StuntKind[];
  ink: string;
  onToggle: (kind: StuntKind) => void;
}) {
  const [showing, setShowing] = useState<StuntKind>(selected[0] ?? STUNT_KINDS[0]!);

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {STUNT_KINDS.map((kind) => {
          const checked = selected.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              role="switch"
              aria-checked={checked}
              onClick={() => {
                setShowing(kind);
                onToggle(kind);
              }}
              onMouseEnter={() => setShowing(kind)}
              onFocus={() => setShowing(kind)}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
                checked
                  ? "border-sky-500 bg-sky-500/12"
                  : "border-[rgba(255,255,255,0.1)] hover:border-sky-500"
              } ${showing === kind ? "ring-1 ring-sky-500/40" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px] leading-none ${
                  checked ? "border-sky-400 bg-sky-500 text-[#171716]" : "border-[rgba(255,255,255,0.2)]"
                }`}
              >
                {checked ? "✓" : ""}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm ${checked ? "text-sky-200" : "text-frost"}`}>
                  {STUNT_COPY[kind].label}
                </span>
                <span className="mt-0.5 block text-xs text-[rgba(237,237,235,0.45)]">
                  {STUNT_COPY[kind].caption}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="shrink-0 sm:w-[184px]">
        <MarkerStuntPreview
          kind={showing}
          size={184}
          ink={ink}
          label={`${STUNT_COPY[showing].label}: ${STUNT_COPY[showing].caption}`}
        />
        <p className="mt-2 text-xs text-[rgba(237,237,235,0.45)]">
          {selected.includes(showing)
            ? `${STUNT_COPY[showing].label} is on.`
            : `${STUNT_COPY[showing].label} is off. Tap it to turn it on.`}
        </p>
      </div>
    </div>
  );
}

function Toggle({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mt-3 flex items-center justify-between gap-3 text-sm text-frost">
      {title}
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
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
      className={`rounded-lg border px-3 py-1.5 text-xs capitalize ${
        checked ? "border-sky-500 bg-sky-500/12 text-sky-200" : "border-[rgba(255,255,255,0.1)] text-frost"
      }`}
    >
      {label}
    </button>
  );
}

async function downloadExport() {
  const response = await fetch("/api/account/export");
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "accelute-export.json";
  link.click();
  URL.revokeObjectURL(url);
}
