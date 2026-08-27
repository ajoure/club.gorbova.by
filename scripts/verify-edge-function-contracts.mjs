import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const functionsRoot = join(root, "supabase", "functions");
const sourceRoots = [join(root, "src"), functionsRoot];
const codeExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return codeExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

const deployedSources = new Set(
  readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
    .filter((entry) => statSync(join(functionsRoot, entry.name, "index.ts")).isFile())
    .map((entry) => entry.name),
);

const referencePatterns = [
  /(?:supabase\.)?functions\.invoke\(\s*["'`]([a-z0-9][a-z0-9-]*)["'`]/g,
  /\/functions\/v1\/([a-z0-9][a-z0-9-]*)/g,
];

const references = new Map();
for (const file of sourceRoots.flatMap(walk)) {
  const source = readFileSync(file, "utf8");
  for (const pattern of referencePatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const functionName = match[1];
      const line = source.slice(0, match.index).split("\n").length;
      const locations = references.get(functionName) ?? [];
      locations.push(`${relative(root, file)}:${line}`);
      references.set(functionName, locations);
    }
  }
}

const missing = [...references.entries()]
  .filter(([functionName]) => !deployedSources.has(functionName))
  .sort(([left], [right]) => left.localeCompare(right));

console.log(
  `Edge Function contracts: ${deployedSources.size} sources, ${references.size} literal references.`,
);

if (missing.length > 0) {
  console.error("Literal references without a matching function source:");
  for (const [functionName, locations] of missing) {
    console.error(`- ${functionName}: ${locations.join(", ")}`);
  }
  process.exitCode = 1;
} else {
  console.log("All literal Edge Function references resolve to a checked-in function source.");
}
