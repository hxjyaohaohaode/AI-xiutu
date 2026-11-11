/** Read-only source continuity audit. Does not open a browser or execute upstream code.
 * Usage: node scripts/qa/audit-reactbits-reference.mjs /path/to/react-bits report.json
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [referenceArgument, outputArgument] = process.argv.slice(2);
if (!referenceArgument || !outputArgument) {
  throw new Error(
    'Usage: node scripts/qa/audit-reactbits-reference.mjs REFERENCE_ROOT REPORT_JSON',
  );
}
const referenceRoot = resolve(referenceArgument);
const output = resolve(outputArgument);
const manifestPath = 'docs/design/reactbits-r3-20261111.json';
const manifestBytes = await readFile(join(root, manifestPath));
const manifest = JSON.parse(manifestBytes);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const problems = [];
function verify(condition, message) {
  if (!condition) problems.push(message);
}
async function readReference(path) {
  const absolute = resolve(referenceRoot, path);
  const fromRoot = relative(referenceRoot, absolute);
  if (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
    throw new Error('Reference path escapes its root: ' + path);
  }
  const bytes = await readFile(absolute);
  return { path, bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8') };
}
function properties(node) {
  if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected a static object literal.');
  return new Map(
    node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) throw new Error('Unsupported metadata property.');
      return [property.name.text, property.initializer];
    }),
  );
}
function string(node) {
  if (!node || !ts.isStringLiteral(node)) throw new Error('Expected a static string literal.');
  return node.text;
}
function exportedLiteral(file, name) {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (entry) => entry.name.getText(source) === name,
    );
    if (declaration?.initializer) return declaration.initializer;
  }
  throw new Error('Missing static export: ' + name);
}
function inventory(file) {
  return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
}
const sourceCategories = await readReference('src/constants/Categories.js');
const sourceMetadata = await readReference('src/constants/Information.js');
const sourceCatalog = await readReference('src/utils/catalog.js');
const license = await readReference('LICENSE.md');
const categoryLiteral = exportedLiteral(sourceCategories, 'CATEGORIES');
if (!ts.isArrayLiteralExpression(categoryLiteral))
  throw new Error('Expected static CATEGORIES array.');
const categories = categoryLiteral.elements.map((element) => {
  const fields = properties(element);
  const entries = fields.get('subcategories');
  if (!ts.isArrayLiteralExpression(entries)) throw new Error('Expected static subcategory names.');
  return { name: string(fields.get('name')), subcategories: entries.elements.map(string) };
});
const metadata = new Map(
  [...properties(exportedLiteral(sourceMetadata, 'componentMetadata'))].map(([key, element]) => {
    const fields = properties(element);
    return [
      key,
      Object.fromEntries(
        ['name', 'category', 'docsUrl', 'description'].map((field) => [
          field,
          string(fields.get(field)),
        ]),
      ),
    ];
  }),
);
const metadataByPath = new Map(
  [...metadata].map(([key, fields]) => [new URL(fields.docsUrl).pathname, { key, ...fields }]),
);
const slug = (value) => value.replace(/\s+/g, '-').toLowerCase();
const catalog = categories
  .filter((category) => category.name !== 'Get Started')
  .flatMap((category) =>
    category.subcategories.flatMap((title) => {
      const path = `/${slug(category.name)}/${slug(title)}`;
      const item = metadataByPath.get(path);
      verify(Boolean(item), 'Catalog route has no metadata: ' + path);
      return item ? [{ ...item, title, publicCategory: category.name, path }] : [];
    }),
  );
const catalogByKey = new Map(catalog.map((entry) => [entry.key, entry]));
const baselineKeys = new Set(manifest.components.map((entry) => entry.key));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: referenceRoot,
  encoding: 'utf8',
}).trim();
const trackedChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
  cwd: referenceRoot,
  encoding: 'utf8',
}).trim();
verify(commit === manifest.upstreamCommit, 'Upstream commit differs from the historical manifest.');
verify(!trackedChanges, 'Upstream tracked files have local changes.');
verify(
  baselineKeys.size === manifest.components.length,
  'Duplicate component keys in the historical manifest.',
);
verify(
  catalogByKey.size === catalog.length,
  'Duplicate component keys in the public source catalog.',
);
for (const key of baselineKeys)
  verify(catalogByKey.has(key), 'Historical item is absent from the source catalog: ' + key);
for (const key of catalogByKey.keys())
  verify(baselineKeys.has(key), 'Source catalog item has no historical row: ' + key);

const signalPatterns = [
  ['keyboard', /onKeyDown|addEventListener\(['"]keydown/],
  [
    'controlled-value',
    /onChange\??:|onValueChange\??:|onCommit\??:|currentStep:|working\??:|status\??:/,
  ],
  ['reduced-motion', /prefers-reduced-motion|useReducedMotion/],
  ['visibility-observer', /IntersectionObserver/],
  ['resize-observer', /ResizeObserver/],
  ['animation-frame', /requestAnimationFrame/],
  ['graphics-import', /(?:from|import)\s*['"](?:three|ogl|vgpu|@react-three)(?:['"/])/],
  ['webgl-context', /getContext\(['"]webgl2?['"]/],
  ['canvas2d-context', /getContext\(['"]2d['"]/],
];
const components = [];
for (const previous of manifest.components) {
  const source = await readReference(previous.source);
  const expected = catalogByKey.get(previous.key);
  const sourceMatches = source.sha256 === previous.sourceSha256;
  const bytesMatch = source.bytes === previous.sourceBytes;
  verify(sourceMatches, previous.key + ': main source SHA-256 differs.');
  verify(bytesMatch, previous.key + ': main source byte count differs.');
  const metadataMatches = Boolean(
    expected &&
    expected.name === previous.name &&
    expected.category === previous.category &&
    expected.description === previous.description &&
    new URL(previous.url).pathname === expected.path &&
    previous.title === expected.title,
  );
  verify(metadataMatches, previous.key + ': name, title, route, category or description differs.');
  const css = previous.css ? await readReference(previous.css) : null;
  const sourceCategory = previous.source.split('/')[2];
  const demo = await readReference(`src/demo/${sourceCategory}/${previous.name}Demo.jsx`);
  const lines = source.text.split('\n');
  const staticSignals = signalPatterns.flatMap(([kind, pattern]) => {
    const index = lines.findIndex((line) => pattern.test(line));
    return index < 0 ? [] : [{ kind, line: index + 1, excerpt: lines[index].trim() }];
  });
  components.push({
    key: previous.key,
    title: previous.title,
    category: expected?.publicCategory ?? previous.category,
    url: previous.url,
    source: {
      ...inventory(source),
      previousSha256: previous.sourceSha256,
      sourceMatches,
      bytesMatch,
    },
    css: css ? inventory(css) : null,
    demo: inventory(demo),
    metadataMatches,
    decision: previous.proposal.decision,
    target: previous.proposal.target,
    reason: previous.proposal.reason,
    decisionBasis:
      'R3 recorded source/browser research, rechecked for source continuity; not a new visual verification or shipment claim',
    staticSignals,
    priorSourceReview: previous.sourceEvidence,
    priorBrowserEvidenceCount: previous.browserEvidence.length,
  });
}
const counts = (entries, key) =>
  entries.reduce((result, entry) => {
    const value = key(entry);
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
const unlistedMetadata = [...metadata.keys()].filter((key) => !catalogByKey.has(key));
const documentedUnlisted = new Set(manifest.unlistedSourceEntries);
verify(
  unlistedMetadata.every((key) => documentedUnlisted.has(metadata.get(key).name)) &&
    unlistedMetadata.length === documentedUnlisted.size,
  'Unlisted source metadata differs from R3.',
);
verify(catalog.length === manifest.sourceCatalogTotal, 'Public catalog total differs from R3.');
verify(metadata.size === manifest.sourceMetadataCount, 'Metadata total differs from R3.');
for (const category of manifest.counts) {
  verify(
    catalog.filter((entry) => entry.publicCategory === category.category).length === category.count,
    'Category count differs: ' + category.category,
  );
}
const report = {
  auditedAt: new Date().toISOString(),
  upstream: manifest.upstream,
  upstreamCommit: commit,
  historicalManifest: { path: manifestPath, sha256: sha256(manifestBytes) },
  method:
    'Read-only SHA-256 and byte comparison, static TypeScript-AST catalog extraction, exact route/name/category checks, CSS/demo hash inventory and literal source signals. No upstream code execution and no browser control.',
  scopeLimits: [
    'All 216 main source hashes are compared with R3. CSS and demo hashes are newly inventoried; R3 did not contain hashes for those files.',
    'Literal signal matches are an index, not complete semantic review. Canvas2D calls can be probes inside a GPU renderer.',
    'Prior decisions and browser evidence remain historical. This audit does not assert a fresh detail-page visit, successful GPU rendering, exhaustive state review or shipped implementation.',
    'Reference suitability is product-specific. Rejecting a direct renderer does not reject its static composition or interaction principle.',
  ],
  files: [sourceCategories, sourceMetadata, sourceCatalog, license].map(inventory),
  summary: {
    result: problems.length ? 'fail' : 'pass',
    publicCatalogTotal: catalog.length,
    metadataTotal: metadata.size,
    sourceHashesMatched: components.filter((entry) => entry.source.sourceMatches).length,
    sourceBytesMatched: components.filter((entry) => entry.source.bytesMatch).length,
    metadataMatched: components.filter((entry) => entry.metadataMatches).length,
    cssInventoried: components.filter((entry) => entry.css).length,
    demosInventoried: components.length,
    byCategory: counts(components, (entry) => entry.category),
    byDecision: counts(components, (entry) => entry.decision),
    unlistedMetadata,
    problems,
  },
  components,
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: relative(root, output), ...report.summary }, null, 2));
if (problems.length) process.exitCode = 1;
