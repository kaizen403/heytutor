import { Card } from "@/components/ui/card";
import type { AdminUserChatMessage } from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { formatRelativeTime, truncateText } from "../shared/lib/format";

function RolePill({ role }: { role: string }) {
  const isAssistant = role === "assistant";
  return (
    <span
      className={cn(
        "type-accent-xs shrink-0 rounded-full border px-2 py-0.5",
        isAssistant
          ? "border-border bg-secondary text-foreground"
          : "border-stroke bg-ink-800 text-soft",
      )}
    >
      {role}
    </span>
  );
}

export function UserMessages({
  messages,
}: {
  messages: AdminUserChatMessage[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="type-accent-xs text-faint">
        Chat · newest {messages.length}
      </h2>
      <Card className="gap-0 rounded-lg p-4 shadow-none">
        <ul className="divide-y divide-stroke">
          {messages.map((message) => (
            <li key={message.id} className="flex items-start gap-2.5 py-1.5">
              <RolePill role={message.role} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-frost" title={message.content}>
                  {truncateText(message.content, 110)}
                </p>
                <p className="type-accent-xs mt-0.5 truncate text-faint">
                  {truncateText(message.boardTitle, 28)} ·{" "}
                  {formatRelativeTime(message.createdAt)}
                </p>
              </div>
            </li>
          ))}
          {messages.length === 0 ? (
            <li className="type-accent-xs py-2 text-faint">
              No chat messages yet.
            </li>
          ) : null}
        </ul>
      </Card>
    </section>
  );
}
