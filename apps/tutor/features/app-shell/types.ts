import type { BoardEntry } from "@/lib/boards/types";
import type { AccountProfile } from "@/lib/account/types";

export type AppShellProfile = Pick<
  AccountProfile,
  "name" | "image" | "email" | "examGoal" | "classYear"
> | null;

export type AppShellBoardHandlers = {
  boards: BoardEntry[];
  activeBoardId: string | null;
  busyBoardId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  disabled?: boolean;
};

export type AppShellVariant = "session" | "account";
