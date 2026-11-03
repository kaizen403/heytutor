"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountCard, AccountPageFrame } from "./AccountPageFrame";
import { SiteButton } from "@/components/ui/site-button";
import {
  CLASS_YEAR_LABELS,
  EXAM_GOAL_LABELS,
  SUBJECT_LABELS,
  firstName,
  profileSubtitle,
  type AccountProfile,
  type AccountSnapshot,
} from "@/lib/account/types";
import { boardPath } from "@/features/tutor-session/lib/board/boardRoute";

export function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [name, setName] = useState("");
  const [learningNote, setLearningNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [handle, setHandle] = useState("");
  const [handleStatus, setHandleStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    void fetch("/api/account/me")
      .then((response) => response.json())
      .then((data: { profile?: AccountProfile; snapshot?: AccountSnapshot }) => {
        if (data.profile) {
          setProfile(data.profile);
          setName(data.profile.name ?? "");
          setLearningNote(data.profile.learningNote ?? "");
          setHandle(data.profile.handle ?? "");
          setImageFailed(false);
        }
        if (data.snapshot) setSnapshot(data.snapshot);
      });
  }, []);

  const save = async () => {
    const response = await fetch("/api/account/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, learningNote }),
    });
    if (response.ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    }
  };

  const saveHandle = async () => {
    setHandleStatus(null);
    const response = await fetch("/api/account/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: handle.trim() }),
    });
    const data = (await response.json().catch(() => ({}))) as { profile?: AccountProfile; error?: string };
    if (response.ok && data.profile) {
      setProfile(data.profile);
      setHandle(data.profile.handle ?? "");
      setHandleStatus({ tone: "ok", text: data.profile.handle ? `Your boards show as @${data.profile.handle}.` : "Your boards show the default Community name." });
      return;
    }
    setHandleStatus({ tone: "error", text: data.error ?? "That did not save. Try again." });
  };

  return (
    <AccountPageFrame
      title="Profile"
      subtitle="Your student page. Only your Community name and the boards you share are public."
      actions={
        <SiteButton size="sm" onClick={() => router.push("/settings")}>
          Open settings
        </SiteButton>
      }
    >
      <AccountCard title="Identity">
        <div className="flex items-center gap-4">
          {profile?.image && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.image}
              alt=""
              className="h-14 w-14 rounded-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(255,255,255,0.1)] text-sm text-frost">
              {firstName(profile?.name, profile?.email).slice(0, 1)}
            </div>
          )}
          <div>
            <p className="text-sm text-frost">{firstName(profile?.name, profile?.email)}</p>
            <p className="text-xs text-[rgba(237,237,235,0.5)]">
              {profileSubtitle(profile ?? {}) ?? "Finish onboarding to set a goal"}
            </p>
            <p className="text-xs text-[rgba(237,237,235,0.4)]">{profile?.email}</p>
          </div>
        </div>
        <label className="mt-4 block text-xs text-[rgba(237,237,235,0.55)]">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.22)] px-3 py-2 text-sm text-frost outline-none focus:border-sky-500"
          />
        </label>
        <p className="mt-3 text-xs text-[rgba(237,237,235,0.5)]">
          {profile?.examGoal ? EXAM_GOAL_LABELS[profile.examGoal] : "No exam goal"}
          {profile?.classYear ? ` · ${CLASS_YEAR_LABELS[profile.classYear]}` : ""}
        </p>
        <p className="mt-1 text-xs text-[rgba(237,237,235,0.5)]">
          {(profile?.subjects ?? []).map((subject) => SUBJECT_LABELS[subject]).join(" · ") || "No subjects yet"}
        </p>
        <label className="mt-4 block text-xs text-[rgba(237,237,235,0.55)]">
          Learning note
          <textarea
            value={learningNote}
            onChange={(event) => setLearningNote(event.target.value)}
            maxLength={400}
            rows={3}
            placeholder="I mix up unit vectors and displacement"
            className="mt-1 w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.22)] px-3 py-2 text-sm text-frost outline-none focus:border-sky-500"
          />
        </label>
        <SiteButton className="mt-3" variant="ice" size="sm" onClick={() => void save()}>
          {saved ? "Saved" : "Save profile"}
        </SiteButton>
      </AccountCard>

      <AccountCard title="Community name" className="mt-4">
        <p className="text-xs text-[rgba(237,237,235,0.55)]">
          The name under your boards on Community. Without one,{" "}
          {profile?.ageBand === "18_plus" ? "your first name is shown" : "they show as Accelute student"}. Your email and photo are never shown.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-[rgba(237,237,235,0.55)]">@</span>
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            maxLength={24}
            placeholder="your_name"
            aria-label="Community name"
            className="min-w-[12rem] flex-1 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.22)] px-3 py-2 text-sm text-frost outline-none focus:border-sky-500"
          />
          <SiteButton variant="ice" size="sm" onClick={() => void saveHandle()}>
            Save name
          </SiteButton>
        </div>
        {handleStatus ? (
          <p className={`mt-2 text-xs ${handleStatus.tone === "error" ? "text-red-300" : "text-sky-200"}`} role="status">
            {handleStatus.text}
          </p>
        ) : null}
      </AccountCard>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Stat label="Boards" value={snapshot?.boardCount ?? 0} />
        <Stat label="Lessons" value={snapshot?.lessonCount ?? 0} />
        <Stat label="Narration minutes" value={snapshot?.narrationMinutes ?? 0} />
        <Stat label="Exports" value={snapshot?.exportCount ?? 0} />
      </div>

      {snapshot?.lastBoard ? (
        <AccountCard title="Last lesson" className="mt-4">
          <p className="text-sm text-frost">{snapshot.lastBoard.title}</p>
          <SiteButton className="mt-3" size="sm" variant="sky" onClick={() => router.push(boardPath(snapshot.lastBoard!.id))}>
            Continue
          </SiteButton>
        </AccountCard>
      ) : null}

      <AccountCard title="Account" className="mt-4">
        <div className="flex flex-wrap gap-2">
          <SiteButton size="sm" onClick={() => void downloadExport()}>
            Export my data
          </SiteButton>
          <SiteButton
            size="sm"
            variant="danger"
            onClick={() => {
              if (!window.confirm("Delete this account and every board? This cannot be undone.")) return;
              void fetch("/api/account", { method: "DELETE" }).then(() => {
                window.location.href = "/login";
              });
            }}
          >
            Delete account
          </SiteButton>
        </div>
      </AccountCard>
    </AccountPageFrame>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <AccountCard>
      <p className="text-xs text-[rgba(237,237,235,0.5)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-frost">{value}</p>
    </AccountCard>
  );
}

async function downloadExport() {
  const { downloadAccountExport } = await import("@/lib/account/exportClient");
  await downloadAccountExport();
}
