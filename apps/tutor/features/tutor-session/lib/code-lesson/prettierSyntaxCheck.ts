import type { CodeLessonLanguage, CodeSyntaxCheckResult } from "@heytutor/tutor-core";

/**
 * Syntax gate for JS/TS code-lesson sections via prettier's parser, loaded
 * lazily so the editor toolchain never enters the main bundle. Other
 * languages pass through — the deterministic format gate still applies.
 */
export async function prettierSyntaxCheck(
  code: string,
  language: CodeLessonLanguage,
): Promise<CodeSyntaxCheckResult> {
  if (language !== "javascript" && language !== "typescript") {
    return { ok: true };
  }
  try {
    const [{ format }, babel, estree, typescript] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
      language === "typescript"
        ? import("prettier/plugins/typescript")
        : Promise.resolve(null),
    ]);
    const formatted = await format(code, {
      parser: language === "typescript" ? "typescript" : "babel",
      plugins: [babel, estree.default ?? estree, ...(typescript ? [typescript] : [])],
      printWidth: 58,
      tabWidth: 2,
    });
    return { ok: true, formatted };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    // Prettier throws on parse errors; loader failures must not reject a plan.
    if (/Cannot find module|Failed to fetch|ChunkLoadError/i.test(message ?? "")) {
      return { ok: true };
    }
    return { ok: false, message };
  }
}
