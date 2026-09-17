"use client";

import { useRouter } from "next/navigation";
import { SiteButton } from "@/components/ui/site-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  OUT_OF_USAGE_TITLE,
  UPGRADE_LABEL,
  outOfCreditsDescription,
} from "@/lib/billing/studentCopy";

export function OutOfCreditsDialog({
  open,
  onOpenChange,
  ageBand,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ageBand?: string | null;
}) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="site-theme border-stroke bg-ink-900 text-frost">
        <DialogHeader>
          <DialogTitle>{OUT_OF_USAGE_TITLE}</DialogTitle>
          <DialogDescription>{outOfCreditsDescription(ageBand)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <SiteButton variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Not now
          </SiteButton>
          <SiteButton
            variant="ice"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              router.push("/usage");
            }}
          >
            {UPGRADE_LABEL}
          </SiteButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
