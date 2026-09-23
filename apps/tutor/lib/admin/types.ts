/**
 * Wire payloads for the admin panel APIs. Shared between the API routes
 * (server) and the panel views (client, `import type` only). Everything here
 * is JSON-serializable and deliberately slim: no `rawResponse`, no scene
 * documents, no audio URLs — those stay in the database and object store.
 */
import type {
  DegradationReason,
  OutcomeCounts,
  RepresentationTier,
  TurnOutcome,
} from "./outcome";
import type { DayCount } from "./timeBuckets";

export type { OutcomeCounts };

// --- overview ---------------------------------------------------------------

export interface OverviewKpis {
  usersTotal: number;
  usersNew7d: number;
  usersActive24h: number;
  usersActive7d: number;
  boardsTotal: number;
  chatMessagesTotal: number;
  turnsTotal: number;
  turns24h: number;
  turns7d: number;
  turns30d: number;
  /** Share of 7d turns that taught without a verified diagram (0–1), or null when there were no turns to measure. */
  failRate7d: number | null;
}

export interface TierCounts {
  exactVerified: number;
  qualitativeVerified: number;
  questionRepresentation: number;
}

/** A JSON-parsed aggregation over a bounded set of turns (see overview API). */
export interface BoundedAggregate {
  scanned: number;
  /** True when more rows existed than the scan budget allowed. */
  truncated: boolean;
}

export interface DegradationReasonCount {
  /** `"unrecorded"` marks failed turns that carry no degradation artifact. */
  reason: DegradationReason | "unrecorded";
  count: number;
}

export interface OverviewTopUser {
  userId: string;
  label: string;
  turns: number;
}

export interface OverviewTopBoard {
  boardId: string;
  title: string;
  userId: string;
  userLabel: string;
  turns: number;
}

export interface OverviewLatestTurn {
  turnId: string;
  question: string;
  outcome: TurnOutcome;
  tier: RepresentationTier | null;
  userLabel: string;
  boardTitle: string;
  createdAt: string;
}

export interface OverviewCostPeriod {
  period: string;
  spentMillicents: number;
  bonusMillicents: number;
  users: number;
}

export interface OverviewTopSpender {
  userId: string;
  label: string;
  spentMillicents: number;
}

/** Langfuse-priced AI + voice usage for a bounded window. */
export interface OverviewInference {
  configured: boolean;
  /** 0 when the window is "this user's recorded boards", not a day range. */
  windowDays: number;
  llmUsd: number;
  ttsUsd: number;
  totalUsd: number;
  observations: number;
  truncated: boolean;
  error?: string;
}

export interface OverviewCost {
  period: string;
  spentMillicents: number;
  bonusMillicents: number;
  spendUsers: number;
  previousPeriod: string;
  previousSpentMillicents: number;
  turnsThisPeriod: number;
  series: OverviewCostPeriod[];
  topSpenders: OverviewTopSpender[];
  inference7d: OverviewInference;
}

export interface OverviewPayload {
  generatedAt: string;
  kpis: OverviewKpis;
  cost: OverviewCost;
  /** UTC day buckets, oldest first, 14 days. */
  turnsPerDay: DayCount[];
  newUsersPerDay: DayCount[];
  outcomesAllTime: OutcomeCounts;
  outcomes7d: OutcomeCounts;
  tiers7d: TierCounts & BoundedAggregate;
  degradation7d: { reasons: DegradationReasonCount[] } & BoundedAggregate;
  sceneEngineVersions30d: Array<{ version: string; count: number }>;
  topUsers7d: OverviewTopUser[];
  topBoards7d: OverviewTopBoard[];
  latestTurns: OverviewLatestTurn[];
}

// --- users list -------------------------------------------------------------

export interface AdminUserRow {
  userId: string;
  email: string | null;
  name: string | null;
  image: string | null;
  createdAt: string;
  onboardingCompletedAt: string | null;
  examGoal: string | null;
  classYear: string | null;
  learnerRole: string | null;
  subjects: string[];
  turns: number;
  boards: number;
  chatMessages: number;
  firstTurnAt: string | null;
  lastTurnAt: string | null;
  /** A turn landed within the last 5 minutes. */
  activeNow: boolean;
  /** Current calendar-month spend in millicents, null when no row exists. */
  spendMillicents: number | null;
}

export type UserSort =
  | "recentActivity"
  | "turns"
  | "boards"
  | "messages"
  | "spend"
  | "newest"
  | "oldest";

export interface UsersPagePayload {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  period: string;
}

// --- user detail ------------------------------------------------------------

export interface AdminUserSettings {
  fastMode: boolean;
  narrationEnabled: boolean;
  audioLanguage: string;
  accent: string;
  uiLanguage: string;
  speedMultiplier: number;
  teachingNote: string;
}

export interface AdminUserBoard {
  boardId: string;
  title: string;
  preview: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  turns: number;
}

export interface AdminUserTurn {
  turnId: string;
  question: string;
  outcome: TurnOutcome;
  tier: RepresentationTier | null;
  degradationReason: DegradationReason | null;
  issueCodes: string[];
  boardId: string;
  boardTitle: string;
  createdAt: string;
  segmentCount: number;
  /** Summed segment durations, the closest persisted proxy for lesson length. */
  narratedMs: number | null;
}

export interface AdminUserChatMessage {
  id: string;
  boardId: string;
  boardTitle: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface AdminUserSpendPeriod {
  period: string;
  spentMillicents: number;
  bonusMillicents: number;
}

export interface UserDetailPayload {
  user: AdminUserRow;
  settings: AdminUserSettings | null;
  boards: AdminUserBoard[];
  turns: AdminUserTurn[];
  chatMessages: AdminUserChatMessage[];
  spend: AdminUserSpendPeriod[];
  inference: OverviewInference;
}

// --- turns feed -------------------------------------------------------------

export type TurnsOutcomeFilter = "all" | "validated" | "failed";

export interface AdminTurnRow {
  turnId: string;
  question: string;
  outcome: TurnOutcome;
  tier: RepresentationTier | null;
  degradationReason: DegradationReason | null;
  issueCodes: string[];
  candidateCount: number | null;
  sceneEngineVersion: string | null;
  traceId: string | null;
  /** Langfuse trace URL, present only when Langfuse is configured. */
  traceUrl: string | null;
  userId: string;
  userLabel: string;
  boardId: string;
  boardTitle: string;
  createdAt: string;
  llmUsd: number | null;
  ttsUsd: number | null;
  totalUsd: number | null;
}

export interface TurnsPagePayload {
  turns: AdminTurnRow[];
  total: number;
  page: number;
  pageSize: number;
  outcome: TurnsOutcomeFilter;
  /** Echo of the applied filters so the UI can render what it actually got. */
  userId: string | null;
  query: string;
  days: number | null;
}
