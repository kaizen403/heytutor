"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="type-accent-xs tabular-nums text-faint">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <SiteButton
          variant="ghost"
          size="xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </SiteButton>
        <span className="type-accent-xs tabular-nums text-soft">
          {page} / {pages}
        </span>
        <SiteButton
          variant="ghost"
          size="xs"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </SiteButton>
      </div>
    </div>
  );
}
