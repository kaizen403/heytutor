export const HEYTUTOR_FAST_MODE_HEADER = "x-heytutor-fast-mode";

export function parseFastModeHeader(value: string | null | undefined): boolean {
  if (value == null || value === "") {
    return true;
  }

  return value !== "0" && value.toLowerCase() !== "false";
}

export function withFastModeHeader(
  headers: Record<string, string>,
  fastMode = true,
): Record<string, string> {
  return {
    ...headers,
    [HEYTUTOR_FAST_MODE_HEADER]: fastMode ? "1" : "0",
  };
}
