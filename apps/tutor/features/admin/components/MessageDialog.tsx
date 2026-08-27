"use client";

import { Button } from "@/components/ui/button";
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {isConfirm ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className={isConfirm ? "bg-[rgba(224,104,88,0.18)] text-[#E06858] hover:bg-[rgba(224,104,88,0.28)]" : undefined}
            onClick={() => {
              onConfirm?.();
              onOpenChange(false);
            }}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
