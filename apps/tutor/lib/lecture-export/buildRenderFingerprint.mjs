/** Node-only: source content, never Git refs, mtimes, checkout paths or PR numbers. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isBuiltin } from 'node:module';

// Resolve, never execute, installed runtime packages. Only metadata versions are
// hashed: same-version patched package contents require a version bump to invalidate.
function installedRenderVersions(root, files) {
  // Deterministic traversal IDs retain ownership and cycles without hashing paths.
  // Manifest paths are lookup keys only, never serialized cache identity.
  const visited = new Map();
  const nodes = [];
  const roots = [];
  const visit = (id, importer, optional = false) => {
    if (isBuiltin(id)) return;
    // Metadata ownership is independent of import/require/browser export conditions.
    // Canonical importers preserve pnpm ownership; never consult global lookup paths.
    const name = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
    const start = path.dirname(realpathSync(importer));
    let manifest;
    let directory = start;
    for (;;) {
      const scope = path.join(directory, 'package.json');
      if (existsSync(scope)) {
        if (JSON.parse(readFileSync(scope, 'utf8')).name === name) manifest = scope;
        break; // Only the nearest package scope can own a self-reference.
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    directory = start;
    while (!manifest) {
      if (path.basename(directory) !== 'node_modules') {
        const candidate = path.join(directory, 'node_modules', name);
        let present = false;
        try { lstatSync(candidate); present = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (present) { manifest = path.join(candidate, 'package.json'); break; }
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (!manifest) {
      if (optional) return;
      throw new Error(`Cannot resolve rendering dependency ${id} from ${importer}`);
    }
    manifest = realpathSync(manifest);
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
    if (metadata.name !== name || typeof metadata.version !== 'string' || !metadata.version) {
      throw new Error(`Invalid rendering dependency metadata: ${manifest}`);
    }
    if (visited.has(manifest)) return visited.get(manifest);
    const index = nodes.length;
    const edges = [];
    visited.set(manifest, index);
    nodes.push([metadata.name, metadata.version, edges]);
    const optionalDependencies = metadata.optionalDependencies ?? {};
    const dependencies = { ...metadata.dependencies, ...metadata.peerDependencies, ...optionalDependencies };
    for (const dependency of Object.keys(dependencies).sort()) {
      const optional = Object.hasOwn(optionalDependencies, dependency) ||
        (!Object.hasOwn(metadata.dependencies ?? {}, dependency) && metadata.peerDependenciesMeta?.[dependency]?.optional === true);
      edges.push([dependency, visit(dependency, manifest, optional) ?? null]);
    }
    return index;
  };
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const importer = path.resolve(root, file);
    const syntax = ts.createSourceFile(file, readFileSync(importer, 'utf8'), ts.ScriptTarget.Latest, false);
    for (const statement of syntax.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (statement.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!statement.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(entry => entry.isTypeOnly)) continue;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every(entry => entry.isTypeOnly)) continue;
      const id = statement.moduleSpecifier.text;
      if (id.startsWith('.') || id.startsWith('/') || id.startsWith('@/') || id.startsWith('@heytutor/')) continue;
      roots.push([file, id, visit(id, importer) ?? null]);
    }
  }
  return [JSON.stringify({ roots, nodes })];
}


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
  const fullyVisited = new Set();
  const syntaxCache = new Map();
  const syntaxFor = relative => {
    if (!syntaxCache.has(relative)) syntaxCache.set(relative, ts.createSourceFile(relative, readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, false));
    return syntaxCache.get(relative);
  };
  const resolveImport = (relative, id) => {
    let target = id.startsWith('.') ? path.posix.join(path.posix.dirname(relative), id)
      : id.startsWith('@/') ? `apps/tutor/${id.slice(2)}` : null;
    const localPackage = /^@heytutor\/([^/]+)(?:\/(.+))?$/.exec(id);
    if (localPackage) target = `packages/${localPackage[1]}/src/${localPackage[2] ?? 'index'}`;
    if (target) target = path.posix.normalize(target);
    if (!target || target.startsWith('../') || /(?:^|\/)(?:node_modules|\.context|\.git)(?:\/|$)/.test(target)) return null;
    const parts = target.split('/');
    if (parts.some((_, index) => { const candidate = path.join(root, ...parts.slice(0, index + 1)); return existsSync(candidate) && lstatSync(candidate).isSymbolicLink(); })) return null;
    return ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx'].map(extension => target + extension)
      .find(candidate => existsSync(path.join(root, candidate)) && statSync(path.join(root, candidate)).isFile() && !candidate.split('/').some((_, index, parts) => lstatSync(path.join(root, ...parts.slice(0, index + 1))).isSymbolicLink())) ?? null;
  };
  const hasExport = (relative, name, seen = new Set()) => {
    const key = `${relative}:${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    for (const statement of syntaxFor(relative).statements) {
      if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue;
        if (statement.exportClause && ts.isNamespaceExport(statement.exportClause) && statement.exportClause.name.text === name) return true;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          if (statement.exportClause.elements.some(entry => !entry.isTypeOnly && entry.name.text === name)) return true;
        } else if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          const target = resolveImport(relative, statement.moduleSpecifier.text);
          if (target && hasExport(target, name, seen)) return true;
        }
      } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if (name === 'default' && statement.modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return true;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name) return true;
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => !ts.isIdentifier(declaration.name) || declaration.name.text === name)) return true;
      }
    }
    return false;
  };
  const pureExpression = expression => {
    if (!expression || ts.isLiteralExpression(expression) || ts.isIdentifier(expression) || ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return true;
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isTypeAssertionExpression(expression)) return pureExpression(expression.expression);
    if (ts.isPrefixUnaryExpression(expression) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(expression.operator)) return pureExpression(expression.operand);
    if (ts.isArrayLiteralExpression(expression)) return expression.elements.every(pureExpression);
    if (ts.isObjectLiteralExpression(expression)) return expression.properties.every(property =>
      !ts.isComputedPropertyName(property.name ?? {}) && (ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property) && pureExpression(property.initializer)));
    return false;
  };
  const effectCache = new Map();
  const hasModuleEffects = (relative, seen = new Set()) => {
    if (effectCache.has(relative)) return effectCache.get(relative);
    if (seen.has(relative)) return false;
    seen.add(relative);
    const effectful = syntaxFor(relative).statements.some(statement => {
      if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly || statement.importClause?.isTypeOnly || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
        const target = resolveImport(relative, statement.moduleSpecifier.text);
        return target && /\.[cm]?[jt]sx?$/.test(target) ? hasModuleEffects(target, seen) : false;
      }
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isEmptyStatement(statement)) return false;
      if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration => !ts.isIdentifier(declaration.name) || !pureExpression(declaration.initializer));
      if (ts.isClassDeclaration(statement)) return Boolean(statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.Decorator)) ||
        Boolean(statement.heritageClauses?.some(clause => clause.types.some(type => !pureExpression(type.expression)))) ||
        statement.members.some(member => ts.isClassStaticBlockDeclaration(member) || ts.isComputedPropertyName(member.name ?? {}) ||
          member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.Decorator) ||
          ts.isPropertyDeclaration(member) && member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword) && !pureExpression(member.initializer));
      return true; // Unknown runtime syntax is retained conservatively.
    });
    if (effectful) effectCache.set(relative, true);
    return effectful;
  };
  const barrelRequests = new Set();
  const visitDependency = (relative, names) => {
    if (!names?.length || !/\.[cm]?[jt]sx?$/.test(relative) || lstatSync(path.join(root, relative)).isSymbolicLink()) { visit(relative); return; }
    const statements = syntaxFor(relative).statements;
    // Pure re-export barrels have no independent runtime side effects. Keep
    // their bytes in the hash, but follow only the exports the renderer uses.
    if (!statements.length || !statements.every(statement => ts.isExportDeclaration(statement) && statement.moduleSpecifier)) { visit(relative); return; }
    found.add(relative);
    for (const name of names) {
      const request = `${relative}:${name}`;
      if (barrelRequests.has(request)) continue;
      barrelRequests.add(request);
      for (const statement of statements) {
        if (statement.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const target = resolveImport(relative, statement.moduleSpecifier.text);
        if (!target) continue;
        if (hasModuleEffects(target)) visit(target);
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const entry of statement.exportClause.elements) if (!entry.isTypeOnly && entry.name.text === name) visitDependency(target, [(entry.propertyName ?? entry.name).text]);
        } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause) && statement.exportClause.name.text === name) visit(target);
        else if (!statement.exportClause && hasExport(target, name)) visitDependency(target, [name]);
      }
    }
  };
  const visit = relative => {
    if (/(?:^|\/)(?:node_modules|\.context|\.git)(?:\/|$)/.test(relative) || relative.startsWith('../')) return;
    const absolute = path.join(root, relative);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) return;
    if (statSync(absolute).isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) visit(`${relative}/${entry}`);
      return;
    }
    if (!sourceFile(relative) || fullyVisited.has(relative)) return;
    fullyVisited.add(relative);
    found.add(relative);
    if (!/\.[cm]?[jt]sx?$/.test(relative)) return;
    const syntax = syntaxFor(relative);
    for (const statement of syntax.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (statement.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!statement.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(entry => entry.isTypeOnly)) continue;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every(entry => entry.isTypeOnly)) continue;
      const id = statement.moduleSpecifier.text;
      const resolved = resolveImport(relative, id);
      if (!resolved) continue;
      const names = ts.isImportDeclaration(statement) && statement.importClause && bindings && ts.isNamedImports(bindings)
        ? [...(statement.importClause.name ? ['default'] : []), ...bindings.elements.filter(entry => !entry.isTypeOnly).map(entry => (entry.propertyName ?? entry.name).text)]
        : null;
      visitDependency(resolved, names);
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
  for (const version of installedRenderVersions(root, files)) hash.update(`dependency:${version.length}:${version}`);
  return hash.digest('hex');
}
