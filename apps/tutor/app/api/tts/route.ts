import { handleTtsRequest } from "@/lib/tts/handleTtsRequest";

export async function POST(request: Request): Promise<Response> {
  return handleTtsRequest(request, new URL(request.url).searchParams.get("timestamps") === "true");
}
