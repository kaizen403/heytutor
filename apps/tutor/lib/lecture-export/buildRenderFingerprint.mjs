/** Node-only: source content, never Git refs, mtimes, checkout paths or PR numbers. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, lstatSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const RENDER_SOURCE_ROOTS = Object.freeze([
  'apps/tutor/lib/lecture-export',
  'apps/tutor/lib/code-render',
  'apps/tutor/lib/code-lesson/persistedCodeLesson.ts',
  'apps/tutor/lib/replay',
  'apps/tutor/features/tutor-session/lib/replay',
  'apps/tutor/features/tutor-session/lib/scene',
  'apps/tutor/features/tutor-session/lib/turn/segmentInk.ts',
  'apps/tutor/features/tutor-session/hooks/useCommandExecution.ts',
  'apps/tutor/features/tutor-session/hooks/useBoardLayout.ts',
  'packages/drawing/src',
  'packages/whiteboard/src',
  'packages/scene-engine/src',
]);
const sourceFile = file => /\.(?:[cm]?[jt]sx?|json|css)$/.test(file) && !/(?:^|\/)(?:__tests__|__fixtures__|fixtures)\/|\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(file);
export function renderSourceFiles(root, roots = RENDER_SOURCE_ROOTS) {
  const found = new Set();
  const visit = relative => {
    if (/(?:^|\/)(?:node_modules|\.context|\.git)(?:\/|$)/.test(relative) || relative.startsWith('../')) return;
    const absolute = path.join(root, relative);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) return;
    if (statSync(absolute).isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) visit(`${relative}/${entry}`);
      return;
    }
    if (!sourceFile(relative) || found.has(relative)) return;
    found.add(relative);
    if (!/\.[cm]?[jt]sx?$/.test(relative)) return;
    const syntax = ts.createSourceFile(relative, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, false);
    for (const statement of syntax.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (statement.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!statement.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(entry => entry.isTypeOnly)) continue;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every(entry => entry.isTypeOnly)) continue;
      const id = statement.moduleSpecifier.text;
      let target = id.startsWith('.') ? path.posix.join(path.posix.dirname(relative), id)
        : id.startsWith('@/') ? `apps/tutor/${id.slice(2)}` : null;
      const localPackage = /^@heytutor\/([^/]+)(?:\/(.+))?$/.exec(id);
      if (localPackage) target = `packages/${localPackage[1]}/src/${localPackage[2] ?? 'index'}`;
      if (!target || target.startsWith('../')) continue;
      const resolved = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx'].map(extension => target + extension)
        .find(candidate => existsSync(path.join(root, candidate)) && statSync(path.join(root, candidate)).isFile());
      if (resolved) visit(resolved);
    }
  };
  for (const entry of roots) visit(entry);
  return [...found].sort();
}
export function renderFingerprint(root, roots = RENDER_SOURCE_ROOTS) {
  const files = renderSourceFiles(root, roots);
  if (!files.length) throw new Error('No export rendering sources found');
  const hash = createHash('sha256').update('heytutor-export-render-v1\0');
  for (const file of files) {
    const content = readFileSync(path.join(root, file));
    hash.update(`${file.length}:${file}:${content.length}:`).update(content);
  }
  return hash.digest('hex');
}
