"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { AccountCard, AccountPageFrame } from "./AccountPageFrame";
import { SiteButton } from "@/components/ui/site-button";
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
import { MARKER_COLORS } from "@/features/tutor-session/components/SettingsDrawer";
import { getLegalHref } from "@/lib/site";
import type { AccountProfile } from "@/lib/account/types";
import { PlanUsageCard } from "./PlanUsageCard";

export function SettingsScreen({ section }: { section: string }) {
  const router = useRouter();
  const active: SettingsSection = isSettingsSection(section) ? section : "general";
  const [settings, setSettings] = useState<AccountSettings>(DEFAULT_ACCOUNT_SETTINGS);
  const [profile, setProfile] = useState<AccountProfile | null>(null);

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
    void fetch("/api/account/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(partial),
    });
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
              </p>
              <div className="flex flex-wrap gap-2">
                {(["new", "normal", "revision"] as const).map((value) => (
                  <Choice
                    key={value}
                    label={value}
                    checked={settings.familiarity === value}
                    onClick={() => patch({ familiarity: value })}
                  />
                ))}
              </div>
              <Toggle
                title="Fast mode"
                checked={settings.fastMode}
                onChange={(checked) => patch({ fastMode: checked })}
              />
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
              <Toggle
                title="Narration"
                checked={settings.narrationEnabled}
                onChange={(checked) => patch({ narrationEnabled: checked })}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Choice label="English" checked={settings.audioLanguage === "english"} onClick={() => patch({ audioLanguage: "english" })} />
                <Choice label="Hindi" checked={settings.audioLanguage === "hindi"} onClick={() => patch({ audioLanguage: "hindi" })} />
                <Choice label="India" checked={settings.accent === "india"} onClick={() => patch({ accent: "india" })} />
                <Choice label="UK" checked={settings.accent === "uk"} onClick={() => patch({ accent: "uk" })} />
                <Choice label="US" checked={settings.accent === "us"} onClick={() => patch({ accent: "us" })} />
                <Choice label="Natural" checked={!settings.lowLatencyVoice} onClick={() => patch({ lowLatencyVoice: false })} />
                <Choice label="Low latency" checked={settings.lowLatencyVoice} onClick={() => patch({ lowLatencyVoice: true })} />
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
              <div className="flex flex-wrap gap-2.5">
                {MARKER_COLORS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    title={color.label}
                    onClick={() => patch({ markerColor: color.id })}
                    className={`h-8 w-8 rounded-full ${
                      settings.markerColor === color.id ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-[#171716]" : ""
                    }`}
                    style={{ backgroundColor: color.color }}
                  />
                ))}
              </div>
              <Toggle
                title="Subtitles on the board"
                checked={settings.subtitlesEnabled}
                onChange={(checked) => patch({ subtitlesEnabled: checked })}
              />
              <Toggle
                title="Marker stunts"
                checked={settings.markerStunts}
                onChange={(checked) => patch({ markerStunts: checked })}
              />
              <p className="mt-3 text-xs text-[rgba(237,237,235,0.45)]">
                Marker stunts: in the gaps between strokes the hand spins the marker around its
                thumb, walks it across the knuckles, gives it a flat double turn, or tosses and
                catches it. The marker stays where it is standing.
              </p>
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
