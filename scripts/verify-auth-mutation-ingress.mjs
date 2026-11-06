import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const mutations = new Set(["signInWithPassword", "signUp", "verifyOtp", "signInWithOtp", "signInWithOAuth", "signInWithSSO", "signInAnonymously", "exchangeCodeForSession", "setSession", "refreshSession", "signOut", "updateUser"]);
const readers = new Set(["getSession", "getUser", "getClaims", "onAuthStateChange", "resend", "resetPasswordForEmail"]);
const factoryFile = "src/lib/authMutationFacade.ts";
const canonicalClient = "src/integrations/supabase/client.ts";
const ownedEscapes = new Map([
  ["src/lib/appAuthMutations.ts", new Set(["createAuthMutationFacade"])],
  ["src/lib/adminReturn.ts", new Set(["createAuthMutationFacade", "verifiedSessionBinding"])],
  ["src/components/layout/ImpersonationBar.tsx", new Set(["saveVerifiedAdminBackup"])],
  ["src/components/admin/ContactDetailSheet.tsx", new Set(["startBoundImpersonation"])],
  ["src/contexts/AuthContext.tsx", new Set(["verifiedSessionBinding"])],
]);
export function inspectAuthSource(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings = [];
  const sdkImports = new Set(["supabase"]);
  const oauthAliases = new Set();
  const canonicalModule = node => node && ts.isStringLiteral(node) && /(?:^|\/)integrations\/supabase\/client(?:\.[cm]?[jt]s)?$/.test(node.text);
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && canonicalModule(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if ((item.propertyName ?? item.name).text === "supabase") sdkImports.add(item.name.text);
      if (bindings && ts.isNamespaceImport(bindings) && !statement.importClause?.isTypeOnly) findings.push({ file, line: ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1, code: "CANONICAL_SDK_NAMESPACE_IMPORT" });
    }
  }
  const issue = (node, code) => findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, code });
  const member = node => ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
  const object = node => ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
  const unwrap = node => { while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression; return node; };
  const dynamicNamespace = node => {
    node = unwrap(node); if (node && ts.isAwaitExpression(node)) node = unwrap(node.expression);
    return node && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && canonicalModule(node.arguments[0]);
  };
  const isSdkAuthMember = node => member(node) === "auth" && (ts.isIdentifier(object(node)) && sdkImports.has(object(node).text)
    || member(object(node)) === "supabase" && dynamicNamespace(object(object(node)))
    || file === "src/lib/adminReturn.ts" && object(node)?.getText(ast) === "this.deps");
  const isAuthObject = node => node && (isSdkAuthMember(node) || file === factoryFile && ts.isIdentifier(node) && node.text === "auth");
  const approvedOAuthNamespace = node => {
    if (file !== "src/pages/OAuthConsent.tsx") return false;
    const type = ast.statements.find(s => ts.isTypeAliasDeclaration(s) && s.name.text === "OAuthNs");
    const names = type && ts.isTypeLiteralNode(type.type) ? type.type.members.map(m => m.name?.getText(ast)).sort() : [];
    if (JSON.stringify(names) !== JSON.stringify(["approveAuthorization", "denyAuthorization", "getAuthorizationDetails"])) return false;
    const inner = node.parent;
    const outer = inner?.parent;
    let declaration = outer?.parent;
    while (declaration && ts.isParenthesizedExpression(declaration)) declaration = declaration.parent;
    if (!inner || !ts.isAsExpression(inner) || inner.type.kind !== ts.SyntaxKind.UnknownKeyword
      || !outer || !ts.isAsExpression(outer) || !ts.isTypeLiteralNode(outer.type)
      || outer.type.members.length !== 1 || outer.type.members[0].name?.getText(ast) !== "oauth"
      || outer.type.members[0].type?.getText(ast) !== "OAuthNs"
      || !declaration || !ts.isVariableDeclaration(declaration) || declaration.name.getText(ast) !== "authAny") return false;
    for (let p = node.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p)) return p.name?.text === "getOAuth" && p.type?.getText(ast) === "OAuthNs";
    return false;
  };
  const enclosingCall = node => {
    for (let p = node.parent; p; p = p.parent) if (ts.isCallExpression(p) && (p.expression.getText(ast) === "invoke" || p.expression.getText(ast) === "runOwnedAuthMutation")) return p;
    return null;
  };
  const safeFactoryCall = node => {
    if (file !== factoryFile || !ts.isCallExpression(node.parent) || node.parent.expression !== node) return false;
    const outer = enclosingCall(node);
    if (!outer || !outer.arguments.some(arg => ts.isIdentifier(arg) && arg.text === "lease")) return false;
    if (member(object(node)) === "admin") {
      return member(node) === "signOut" && node.parent.arguments.length === 2 && ts.isStringLiteral(node.parent.arguments[1]) && node.parent.arguments[1].text === "local";
    }
    return mutations.has(member(node));
  };
  function visit(node) {
    if (ts.isExportDeclaration(node) && canonicalModule(node.moduleSpecifier)) issue(node, "CANONICAL_SDK_REEXPORT");
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && canonicalModule(node.arguments[0])) issue(node, "CANONICAL_SDK_REQUIRE_IMPORT");
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && canonicalModule(node.moduleReference.expression)) issue(node, "CANONICAL_SDK_IMPORT_EQUALS");
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "getOAuth") oauthAliases.add(node.name.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && canonicalModule(node.arguments[0])) {
      let value = node;
      while (value.parent && (ts.isAwaitExpression(value.parent) || ts.isParenthesizedExpression(value.parent))) value = value.parent;
      const exported = value.parent; const auth = exported?.parent; const method = auth?.parent;
      // Resolve only an immediate literal namespace read. A detached/dynamic/destructured SDK object is an escape.
      if (!exported || !ts.isPropertyAccessExpression(exported) || exported.name.text !== "supabase"
        || !auth || !ts.isPropertyAccessExpression(auth) || auth.name.text !== "auth"
        || !method || !ts.isPropertyAccessExpression(method) || !readers.has(method.name.text)) issue(node, "DYNAMIC_SDK_IMPORT_ESCAPE");
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      if ((module === "@supabase/supabase-js" || module === "@supabase/auth-js") && !node.importClause?.isTypeOnly && file !== canonicalClient) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) issue(node, "SDK_NAMESPACE_IMPORT_REQUIRES_REVIEW");
        if (bindings && ts.isNamedImports(bindings)) for (const spec of bindings.elements) {
          if (!spec.isTypeOnly && ["createClient", "GoTrueClient", "SupabaseClient", "AuthClient"].includes((spec.propertyName ?? spec.name).text)) issue(spec, "EXTRA_RUNTIME_SDK_FACTORY");
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const obj = object(node); const name = member(node);
      if (file === "src/pages/OAuthConsent.tsx" && mutations.has(name) && !isAuthObject(obj)) issue(node, "OAUTH_NAMESPACE_SESSION_MUTATION");
      if (file === "src/pages/OAuthConsent.tsx" && ts.isElementAccessExpression(node)
        && (ts.isCallExpression(unwrap(obj)) && unwrap(obj).expression.getText(ast) === "getOAuth" || ts.isIdentifier(unwrap(obj)) && oauthAliases.has(unwrap(obj).text))) issue(node, "COMPUTED_OAUTH_NAMESPACE_ACCESS");
      if (isAuthObject(obj)) {
        if (ts.isElementAccessExpression(node)) issue(node, "COMPUTED_AUTH_ACCESS");
        else if (mutations.has(name) && !safeFactoryCall(node)) issue(node, "RAW_AUTH_MUTATION");
        else if (!mutations.has(name) && !readers.has(name) && name !== "admin") issue(node, "UNKNOWN_AUTH_ACCESS");
      }
      if (member(obj) === "admin" && isAuthObject(object(obj)) && !safeFactoryCall(node)) issue(node, "RAW_ADMIN_AUTH_ACCESS");
      if (isSdkAuthMember(node)) {
        const parent = node.parent;
        const directMember = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
        const approvedCall = ts.isCallExpression(parent) && ownedEscapes.get(file)?.has(parent.expression.getText(ast));
        const construct = parent.parent?.parent;
        const approvedProvider = file === "src/contexts/AdminReturnContext.tsx" && ts.isPropertyAssignment(parent) && parent.name.getText(ast) === "auth"
          && construct && ts.isNewExpression(construct) && construct.expression.getText(ast) === "AdminReturnController";
        if (!directMember && !approvedCall && !approvedProvider && !approvedOAuthNamespace(node)) issue(node, "SDK_AUTH_OBJECT_ESCAPE");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return findings;
}
export function inspectRuntime(root) {
  const findings = []; let files = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (!["src/archive", "src/test"].includes(relative) && entry.name !== "__tests__") walk(absolute);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        files++; findings.push(...inspectAuthSource(relative, fs.readFileSync(absolute, "utf8")));
      }
    }
  }
  walk(path.join(root, "src"));
  return { files, findings };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = inspectRuntime(process.cwd());
  console.log(JSON.stringify(result));
  if (result.findings.length) process.exitCode = 1;
}
