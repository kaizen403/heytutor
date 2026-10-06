import { handleTurnCheckpoint, handleTurnClose } from "@/lib/boards/turnCheckpoint";

interface RouteContext {
  params: Promise<{ boardId: string; turnId: string }>;
}

/** Save the lesson so far: create on the first checkpoint, append on later ones. */
export async function PUT(request: Request, context: RouteContext) {
  return handleTurnCheckpoint(request, await context.params);
}

/** The small keepalive close sent when the page goes away. */
export async function PATCH(request: Request, context: RouteContext) {
  return handleTurnClose(request, await context.params);
}
