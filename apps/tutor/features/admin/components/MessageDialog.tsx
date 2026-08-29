"use client";

import { SiteButton } from "@/components/ui/site-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type MessageDialogMode = "confirm" | "notice";

interface MessageDialogProps {
  open: boolean;
  title: string;
  description: string;
  mode?: MessageDialogMode;
  confirmLabel?: string;
  cancelLabel?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm?: () => void;
}

export function MessageDialog({
  open,
  title,
  description,
  mode = "notice",
  confirmLabel,
  cancelLabel = "Cancel",
  onOpenChange,
  onConfirm,
}: MessageDialogProps) {
  const isConfirm = mode === "confirm";
  const actionLabel = confirmLabel ?? (isConfirm ? "Delete" : "OK");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="site-theme border-stroke bg-ink-900 text-frost">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {isConfirm ? (
            <SiteButton variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </SiteButton>
          ) : null}
          <SiteButton
            variant={isConfirm ? "danger" : "ice"}
            size="sm"
            onClick={() => {
              onConfirm?.();
              onOpenChange(false);
            }}
          >
            {actionLabel}
          </SiteButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
