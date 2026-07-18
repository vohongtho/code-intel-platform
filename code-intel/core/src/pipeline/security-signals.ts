import { Language } from '../shared/languages.js';
import type { SecuritySignal, SecuritySignalType } from '../shared/graph-types.js';

const USER_INPUT_RE = /\b(req|request)\s*\.(query|params|body)\b|\b(query|params|body|input|userInput|user|argv|stdin|env)\b|location\.(hash|search)|document\.(URL|location)|request\.(args|form|json|GET|POST|values)|flask\.request|\$_(GET|POST|REQUEST)|Request\.Query|URLSearchParams|r\.URL\.Query/i;
const SANITIZER_RE = /DOMPurify\.sanitize|sanitizeHtml|escapeHtml|bleach\.clean|html\.escape/i;
const URL_ALLOWLIST_RE = /isAllowedUrl|validateUrl|assertAllowedHost|allowed_hosts?|urlparse\(|startswith\(['"]https:\/\/api\./i;
const PATH_SAFE_RE = /safeJoin|resolveSafePath|assertSafePath|normalizePath|path\.resolve|Path\(.+\)\.resolve/i;
const MAX_MULTILINE = 6;

interface Stmt { text: string; line: number }

type AliasMap = Map<string, string>;

function isJsLike(lang: Language): boolean {
  return lang === Language.TypeScript || lang === Language.JavaScript;
}

function statements(lines: string[]): Stmt[] {
  const out: Stmt[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i]?.trim();
    if (!first || first.startsWith('//') || first.startsWith('#') || first.startsWith('import ')) continue;
    let text = first;
    let depth = (first.match(/\(/g)?.length ?? 0) - (first.match(/\)/g)?.length ?? 0);
    let j = i;
    while (depth > 0 && j + 1 < lines.length && j - i + 1 < MAX_MULTILINE) {
      j++;
      const next = lines[j]?.trim() ?? '';
      text += ' ' + next;
      depth += (next.match(/\(/g)?.length ?? 0) - (next.match(/\)/g)?.length ?? 0);
    }
    out.push({ text: text.replace(/\s+/g, ' ').trim(), line: i + 1 });
    i = j;
  }
  return out;
}

function splitTopLevelArgs(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote: string | null = null;
  let escaped = false;

  for (const ch of input) {
    current += ch;
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      parts.push(current.slice(0, -1).trim());
      current = '';
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isQuotedString(expr: string): boolean {
  return /^(['"])(?:\\.|(?!\1).)*\1$/s.test(expr.trim());
}

function isStaticTemplate(expr: string): boolean {
  return /^`[^$`]*`$/s.test(expr.trim());
}

function isStaticArray(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return false;
  const inner = trimmed.slice(1, -1).trim();
  return !inner || splitTopLevelArgs(inner).every(isStaticExpression);
}

function isStaticExpression(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (isQuotedString(trimmed) || isStaticTemplate(trimmed) || isStaticArray(trimmed)) return true;
  return /^(true|false|null|undefined|None|\d+(?:\.\d+)?)$/.test(trimmed);
}

function buildLiteralAliases(lines: string[]): AliasMap {
  const aliases: AliasMap = new Map();
  for (const s of statements(lines)) {
    const match = s.text.match(/^(?:[\w<[\]>,:&*?$]+\s+)*(?:const|let|var|final|val)?\s*(\$?[A-Za-z_]\w*)\s*(?::=|=)\s*(.+?);?$/);
    if (!match) continue;
    const [, name, rawExpr] = match;
    const expr = rawExpr.trim();
    if (isStaticExpression(expr)) aliases.set(name, expr);
  }
  return aliases;
}

function resolveAlias(expr: string, aliases: AliasMap): string {
  const trimmed = expr.trim();
  if (/^\$?[A-Za-z_]\w*$/.test(trimmed)) return aliases.get(trimmed) ?? trimmed;
  return trimmed;
}

function buildFlags(source: string, type: SecuritySignalType, argList: string[] = []): SecuritySignal['flags'] {
  const joined = [source, ...argList].filter(Boolean).join(', ');
  const firstArg = argList[0]?.trim() ?? source.trim();
  const secondArg = argList[1]?.trim() ?? '';
  const hasSanitizer = SANITIZER_RE.test(joined)
    || (type === 'SSRF' && URL_ALLOWLIST_RE.test(joined))
    || (type === 'PATH_TRAVERSAL' && PATH_SAFE_RE.test(joined));
  const hasInterpolation = /\$\{|#\{|[fF]['"].*\{/.test(source);
  const isParameterized = type === 'SQL_INJECTION'
    && !/[fF]?['"`].*\{/.test(firstArg)
    && !/\$\{|#\{/.test(firstArg)
    && (/\?/.test(firstArg) || /\$\d+/.test(firstArg) || /%s/.test(firstArg))
    && secondArg.length > 0;
  const isDynamic = (!isStaticExpression(source) && !argList.every(isStaticExpression))
    || /\+|%\s/.test(source)
    || hasInterpolation;

  const hasTemplateInterpolation = hasInterpolation;

  return {
    hasUserInput: USER_INPUT_RE.test(joined),
    isDynamic,
    hasStringConcat: /\+/.test(source),
    hasTemplateInterpolation,
    isParameterized,
    hasSanitizer,
  };
}

function makeSignal(
  type: SecuritySignalType,
  sink: string,
  line: number,
  expression: string,
  source: string,
  argList: string[],
  language: Language,
): SecuritySignal {
  const flags = buildFlags(source, type, argList);
  return {
    type,
    sink,
    line,
    expression: expression.trim(),
    source: source.trim(),
    language,
    confidence: flags.hasUserInput ? 0.9 : 0.7,
    flags,
  };
}

function pushCall(signals: SecuritySignal[], s: Stmt, lang: Language, type: SecuritySignalType, sink: string, argsText: string, aliases: AliasMap, sourceIndex = 0): void {
  const args = splitTopLevelArgs(argsText).map((arg) => resolveAlias(arg, aliases));
  const source = args[sourceIndex] ?? args[0] ?? resolveAlias(argsText, aliases);
  signals.push(makeSignal(type, sink, s.line, s.text, source, args, lang));
}

function extractJsSecuritySignals(lines: string[], lang: Language): SecuritySignal[] {
  const signals: SecuritySignal[] = [];
  const aliases = buildLiteralAliases(lines);
  for (const s of statements(lines)) {
    let match: RegExpMatchArray | null;

    match = s.text.match(/\b(fetch|got|axios(?:\.(?:get|post|put|delete|request))?|https?\.(?:request|get))\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'SSRF', match[1], match[2], aliases);

    match = s.text.match(/\b((?:db|database|connection|pool|sequelize|prisma|knex)\.(?:query|execute|raw|\$queryRaw|\$executeRaw)|\w+\.query|\w+\.execute)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'SQL_INJECTION', match[1], match[2], aliases);

    match = s.text.match(/\b(?:fs\.)?(readFile|writeFile|createReadStream|createWriteStream|readFileSync|writeFileSync|open)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'PATH_TRAVERSAL', match[1].startsWith('fs.') ? match[1] : `fs.${match[1]}`, match[2], aliases);

    match = s.text.match(/\bchild_process\.(exec|execSync|execFile|execFileSync|spawn|spawnSync|eval)\s*\((.+)\)/)
      ?? s.text.match(/(?:^|[^\w$.])(exec|execSync|execFile|execFileSync|spawn|spawnSync|eval)\s*\((.+)\)/);
    if (match) {
      const sink = match[1];
      const argsText = match[2];
      const args = splitTopLevelArgs(argsText).map((arg) => resolveAlias(arg, aliases));
      const source = sink.startsWith('spawn') || sink.startsWith('execFile')
        ? [args[0], args[1]].filter(Boolean).join(', ')
        : (args[0] ?? resolveAlias(argsText, aliases));
      signals.push(makeSignal('COMMAND_INJECTION', sink, s.line, s.text, source, args, lang));
    }

    match = s.text.match(/\.[ ]*(innerHTML|outerHTML)\s*=\s*(.+?);?$/) ?? s.text.match(/\.[ ]*(innerHTML|outerHTML)\s*=\s*$/);
    if (match?.[2]) {
      const source = resolveAlias(match[2], aliases);
      signals.push(makeSignal('XSS', match[1], s.line, s.text, source, [source], lang));
    }

    match = s.text.match(/\.(insertAdjacentHTML|html|append)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'XSS', match[1], match[2], aliases, 1);

    match = s.text.match(/document\.write\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'XSS', 'document.write', match[1], aliases);

    match = s.text.match(/dangerouslySetInnerHTML\s*:\s*\{\s*__html\s*:\s*(.+?)\s*}\s*/);
    if (match) {
      const source = resolveAlias(match[1], aliases);
      signals.push(makeSignal('XSS', 'dangerouslySetInnerHTML', s.line, s.text, source, [source], lang));
    }
  }
  return signals;
}

function extractPythonSecuritySignals(lines: string[]): SecuritySignal[] {
  const lang = Language.Python;
  const signals: SecuritySignal[] = [];
  const aliases = buildLiteralAliases(lines);
  for (const s of statements(lines)) {
    let match: RegExpMatchArray | null;

    match = s.text.match(/\b(requests\.(?:get|post|put|delete|request)|urllib\.request\.urlopen|httpx\.(?:get|post|request))\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'SSRF', match[1], match[2], aliases);

    match = s.text.match(/\b(\w+\.execute|\w+\.executemany|db\.session\.execute)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'SQL_INJECTION', match[1], match[2], aliases);

    match = s.text.match(/\b(open|send_file|Path)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'PATH_TRAVERSAL', match[1], match[2], aliases);

    match = s.text.match(/\b(os\.system|os\.popen|subprocess\.(?:run|call|Popen|check_output))\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'COMMAND_INJECTION', match[1], match[2], aliases);

    match = s.text.match(/\b(render_template_string|Markup)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'XSS', match[1], match[2], aliases);
  }
  return signals;
}

function extractGenericSecuritySignals(lines: string[], lang: Language): SecuritySignal[] {
  // ponytail: regex-backed fixture tier; upgrade to AST rules when false positives need per-language precision.
  const signals: SecuritySignal[] = [];
  const aliases = buildLiteralAliases(lines);
  for (const s of statements(lines)) {
    let match: RegExpMatchArray | null;

    match = s.text.match(/\b([\w:$>.-]*(?:Get|Post|get|post|request|openConnection|dataTask|readText|file_get_contents|curl_exec|curl_easy_setopt|Client\.Do|URLSession|HttpClient|Net::HTTP\.get)[\w:$>.-]*)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'SSRF', match[1], match[2], aliases);

    match = s.text.match(/\b([\w:$>.-]*(?:query|Query|execute|Execute|exec|Exec|prepare|rawQuery|executeQuery)[\w:$>.-]*|\$?\w+->query|mysql_query)\s*\((.+)\)/);
    if (match) {
      const sourceIndex = match[1] === 'mysql_query' ? 1 : 0;
      pushCall(signals, s, lang, 'SQL_INJECTION', match[1], match[2], aliases, sourceIndex);
    }

    match = s.text.match(/\b([\w:$>.-]*(?:open|Open|fopen|readFile|read_to_string|readAsString|Paths\.get|path\.Join|File\.read|File\.Open)[\w:$>.-]*)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'PATH_TRAVERSAL', match[1], match[2], aliases);

    match = s.text.match(/\b(exec\.Command(?:Context)?|system|popen|shell_exec|Command::new|ProcessBuilder|cmd\.Run|Runtime\.getRuntime\(\)\.exec|Process\.run)\s*\((.+)\)/);
    if (match) pushCall(signals, s, lang, 'COMMAND_INJECTION', match[1], match[2], aliases);

    match = s.text.match(/\b([\w:$>.-]*(?:innerHTML|Html\.Raw|template\.HTML|html_safe|Response\.Write|respondText|echo|print|printf|write!|write)[\w:$>.-]*)\s*\(?(.+)\)?/);
    if (match) pushCall(signals, s, lang, 'XSS', match[1], match[2], aliases);
  }
  return signals;
}

export function extractSecuritySignals(lines: string[], lang: Language): SecuritySignal[] {
  if (isJsLike(lang)) return extractJsSecuritySignals(lines, lang);
  if (lang === Language.Python) return extractPythonSecuritySignals(lines);
  return extractGenericSecuritySignals(lines, lang);
}
