type ExportItem = Record<string, unknown> & { id: string; boardId?: string };

/** Assemble the download in the browser from bounded server pages. */
export async function downloadAccountExport(): Promise<void> {
  const profileResponse = await fetch("/api/account/export");
  if (!profileResponse.ok) return;
  const profile = await profileResponse.json() as Record<string, unknown>;
  const boards = new Map<string, ExportItem & { turns: ExportItem[]; notes: ExportItem[] }>();
  for (const section of ["boards", "turns", "notes"] as const) {
    let page = 0;
    for (let attempt = 0; attempt < 10_001; attempt++) {
      const response = await fetch(`/api/account/export?section=${section}&page=${page}`);
      if (!response.ok) return;
      const data = await response.json() as { items: ExportItem[]; nextPage: number | null };
      for (const item of data.items) {
        if (section === "boards") boards.set(item.id, { ...item, turns: [], notes: [] });
        else {
          const board = typeof item.boardId === "string" ? boards.get(item.boardId) : undefined;
          if (board) board[section].push(item);
        }
      }
      if (data.nextPage === null) break;
      if (!Number.isSafeInteger(data.nextPage) || data.nextPage <= page) return;
      page = data.nextPage;
      if (attempt === 10_000) return;
    }
  }
  for (const board of boards.values()) board.turns.sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
  const document = { ...profile };
  delete document.sections;
  const blob = new Blob([JSON.stringify({ ...document, boards: [...boards.values()] }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = "accelute-export.json";
  link.click();
  URL.revokeObjectURL(url);
}
