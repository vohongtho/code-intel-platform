import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Language } from '../../../src/shared/languages.js';
import { extractSecuritySignals } from '../../../src/pipeline/security-signals.js';

describe('extractSecuritySignals', () => {
  it('extracts supported sink signals from JS source', () => {
    const lines = [
      'fetch(req.query.url);',
      'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',
      'element.innerHTML = req.body.html;',
      'fs.readFile(req.query.path);',
      'exec("cat " + req.query.file);',
      'prisma.$queryRaw(`SELECT * FROM users WHERE id = ${req.params.id}`);',
      'axios.post(req.body.url);',
      'res.html(req.body.html);',
      'fs.open(req.query.path);',
      'execFile("git", [req.query.branch]);',
    ];

    const signals = extractSecuritySignals(lines, Language.JavaScript);

    assert.ok(signals.find((s) => s.type === 'SSRF' && s.sink === 'fetch' && s.flags.hasUserInput));
    assert.ok(signals.find((s) => s.type === 'SQL_INJECTION' && s.sink === 'db.query' && s.flags.hasTemplateInterpolation));
    assert.ok(signals.find((s) => s.type === 'XSS' && s.sink === 'innerHTML' && s.flags.hasUserInput));
    assert.ok(signals.find((s) => s.type === 'PATH_TRAVERSAL' && s.sink === 'fs.readFile' && s.flags.hasUserInput));
    assert.ok(signals.find((s) => s.type === 'COMMAND_INJECTION' && s.sink === 'exec' && s.flags.hasStringConcat));
    assert.ok(signals.find((s) => s.sink === 'prisma.$queryRaw'));
    assert.ok(signals.find((s) => s.sink === 'axios.post'));
    assert.ok(signals.find((s) => s.sink === 'html'));
    assert.ok(signals.find((s) => s.sink === 'fs.open'));
    assert.ok(signals.find((s) => s.sink === 'execFile'));
  });

  it('marks safe static and sanitized cases conservatively', () => {
    const lines = [
      'fetch("https://example.com/api");',
      'const query = "SELECT * FROM users";',
      'db.query("SELECT * FROM users WHERE id = ?", [id]);',
      'knex.raw(query);',
      'element.innerHTML = DOMPurify.sanitize(req.body.html);',
      'fs.readFile("/tmp/file.txt");',
      'exec("ls -la");',
      'spawn("git", ["status"]);',
      'fetch(assertAllowedHost(req.query.url));',
      'fs.readFile(safeJoin(base, req.query.path));',
    ];

    const signals = extractSecuritySignals(lines, Language.TypeScript);

    assert.equal(signals.find((s) => s.type === 'SSRF')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.type === 'SQL_INJECTION' && s.sink === 'db.query')?.flags.isParameterized, true);
    assert.equal(signals.find((s) => s.type === 'SQL_INJECTION' && s.sink === 'knex.raw')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.type === 'XSS')?.flags.hasSanitizer, true);
    assert.equal(signals.find((s) => s.type === 'PATH_TRAVERSAL')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.type === 'COMMAND_INJECTION')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.sink === 'spawn')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.sink === 'fetch' && s.source.includes('assertAllowedHost'))?.flags.hasSanitizer, true);
    assert.equal(signals.find((s) => s.sink === 'fs.readFile' && s.source.includes('safeJoin'))?.flags.hasSanitizer, true);
  });

  it('does not flag sibling options-object keywords as user input', () => {
    const signals = extractSecuritySignals([
      "fetch(`${this.baseUrl}/api/v1/config`, { method: 'PUT', body: JSON.stringify({ config }) });",
    ], Language.TypeScript);

    const ssrf = signals.find((s) => s.type === 'SSRF' && s.sink === 'fetch');
    assert.ok(ssrf, 'fetch call should still produce an SSRF signal');
    assert.equal(ssrf?.flags.hasUserInput, false, 'body: key in the sibling options object must not mark hasUserInput true');
  });

  it('does not flag a non-relational .query() call as SQL injection when the file imports a known non-relational client', () => {
    const signals = extractSecuritySignals([
      "import { DbManager } from '@ladybugdb/core';",
      'const q = `MATCH (n:User {id: ${id}}) RETURN n`;',
      'dbm.query(q);',
    ], Language.TypeScript);

    assert.equal(signals.find((s) => s.type === 'SQL_INJECTION' && s.sink === 'dbm.query'), undefined);
  });

  it('still flags a real SQL client under a generic receiver name with no non-relational import', () => {
    const signals = extractSecuritySignals([
      'client.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',
    ], Language.TypeScript);

    const finding = signals.find((s) => s.type === 'SQL_INJECTION' && s.sink === 'client.query');
    assert.ok(finding, 'real SQL client under a generic receiver name should still be flagged');
    assert.equal(finding?.flags.isDynamic, true);
  });

  it('does not flag a command sink interpolating a same-file enumerated-literal parameter', () => {
    const lines = [
      'const EDITORS = [',
      "  { name: 'VS Code', binaries: ['code'] },",
      "  { name: 'Cursor', binaries: ['cursor'] },",
      '];',
      'function commandExists(bin) {',
      '  execSync(`which ${bin} 2>/dev/null || where ${bin} 2>nul`, { stdio: \'pipe\' });',
      '}',
      'function detectEditors() {',
      '  return EDITORS.filter((e) => e.binaries.some(commandExists)).map((e) => e.name);',
      '}',
    ];

    const signals = extractSecuritySignals(lines, Language.TypeScript);
    const finding = signals.find((s) => s.type === 'COMMAND_INJECTION' && s.sink === 'execSync');
    assert.ok(finding, 'execSync call should still produce a signal');
    assert.equal(finding?.flags.isDynamic, false, 'bin resolved from a hardcoded EDITORS array via .some() must not be dynamic');
  });

  it('still flags a command sink interpolating a parameter with no enumerated call site', () => {
    const lines = [
      'function runTool(bin) {',
      '  execSync(`which ${bin}`);',
      '}',
      'runTool(process.argv[2]);',
    ];

    const signals = extractSecuritySignals(lines, Language.TypeScript);
    const finding = signals.find((s) => s.type === 'COMMAND_INJECTION' && s.sink === 'execSync');
    assert.ok(finding, 'execSync call should still produce a signal');
    assert.equal(finding?.flags.isDynamic, true, 'bin with no enumerated call site must remain dynamic');
  });

  it('normalizes bounded multiline JS sinks', () => {
    const signals = extractSecuritySignals([
      'db.query(',
      '  `SELECT * FROM users WHERE id = ${req.params.id}`',
      ');',
      'element.innerHTML = DOMPurify.sanitize(',
      '  req.body.html',
      ');',
    ], Language.TypeScript);

    assert.ok(signals.find((s) => s.type === 'SQL_INJECTION' && s.line === 1));
    assert.equal(signals.find((s) => s.type === 'XSS')?.flags.hasSanitizer, true);
  });

  it('extracts supported Python sink signals', () => {
    const signals = extractSecuritySignals([
      'query = "SELECT * FROM users"',
      'requests.get(request.args["url"])',
      'cursor.execute(f"SELECT * FROM users WHERE id = {request.args[\'id\']}")',
      'cursor.execute(query)',
      'return render_template_string(request.form["html"])',
      'open(request.args["path"])',
      'subprocess.run(request.args["cmd"], shell=True)',
    ], Language.Python);

    assert.ok(signals.find((s) => s.type === 'SSRF' && s.language === 'python'));
    assert.ok(signals.find((s) => s.type === 'SQL_INJECTION' && s.flags.isDynamic));
    assert.equal(signals.find((s) => s.type === 'SQL_INJECTION' && s.source === '"SELECT * FROM users"')?.flags.isDynamic, false);
    assert.ok(signals.find((s) => s.type === 'XSS'));
    assert.ok(signals.find((s) => s.type === 'PATH_TRAVERSAL'));
    assert.ok(signals.find((s) => s.type === 'COMMAND_INJECTION'));
  });

  it('extracts tier 5.1 language sink signals', () => {
    const cases: Array<[Language, string[]]> = [
      [Language.Go, ['const query := "SELECT * FROM users"', 'http.Get(r.URL.Query().Get("url"))', 'db.Query("SELECT " + user)', 'db.Query(query)', 'os.Open(r.URL.Query().Get("path"))', 'exec.Command("sh", user).Run()', 'respondText(user)']],
      [Language.Java, ['String query = "SELECT * FROM users";', 'HttpClient.newHttpClient().send(request)', 'stmt.executeQuery("SELECT " + user)', 'stmt.executeQuery(query)', 'Paths.get(user)', 'Runtime.getRuntime().exec(user)', 'Response.Write(user)']],
      [Language.PHP, ['$query = "SELECT * FROM users";', 'file_get_contents($_GET["url"])', '$db->query("SELECT " . $_GET["id"])', '$db->query($query)', 'fopen($_GET["path"], "r")', 'shell_exec($_GET["cmd"])', 'Html.Raw($_GET["html"])']],
      [Language.Ruby, ['query = "SELECT * FROM users"', 'Net::HTTP.get(params[:url])', 'db.execute("SELECT #{params[:id]}")', 'db.execute(query)', 'File.read(params[:path])', 'system(params[:cmd])', 'html_safe(params[:html])']],
    ];

    for (const [lang, lines] of cases) {
      const signals = extractSecuritySignals(lines, lang);
      assert.ok(signals.find((s) => s.type === 'SSRF' && s.language === lang), lang);
      assert.ok(signals.find((s) => s.type === 'SQL_INJECTION' && s.flags.isDynamic), lang);
      assert.equal(signals.find((s) => s.type === 'SQL_INJECTION' && s.source === '"SELECT * FROM users"')?.flags.isDynamic, false, lang);
      assert.ok(signals.find((s) => s.type === 'PATH_TRAVERSAL'), lang);
      assert.ok(signals.find((s) => s.type === 'COMMAND_INJECTION'), lang);
      assert.ok(signals.find((s) => s.type === 'XSS'), lang);
    }
  });

  it('extracts tier 5.2 language sink signals', () => {
    const cases: Array<[Language, string[]]> = [
      [Language.C, ['const char* query = "SELECT * FROM users";', 'curl_easy_setopt(curl, CURLOPT_URL, argv[1])', 'mysql_query(conn, user)', 'mysql_query(conn, query)', 'fopen(argv[1], "r")', 'system(argv[1])', 'Response.Write(user)']],
      [Language.Cpp, ['std::string query = "SELECT * FROM users";', 'curl_easy_setopt(curl, CURLOPT_URL, argv[1])', 'db.exec(user)', 'db.exec(query)', 'std::ifstream open(argv[1])', 'system(argv[1])', 'Response.Write(user)']],
      [Language.CSharp, ['var query = "SELECT * FROM users";', 'client.GetAsync(Request.Query["url"])', 'cmd.ExecuteReader(user)', 'cmd.ExecuteReader(query)', 'File.Open(Request.Query["path"])', 'Process.run(user)', 'Response.Write(user)']],
      [Language.Rust, ['let query = "SELECT * FROM users";', 'reqwest::get(env::args().nth(1))', 'conn.execute(user)', 'conn.execute(query)', 'fs::read_to_string(env::args().nth(1))', 'Command::new(user)', 'respondText(user)']],
      [Language.Kotlin, ['val query = "SELECT * FROM users"', 'httpClient.get(user)', 'stmt.executeQuery(user)', 'stmt.executeQuery(query)', 'Paths.get(user)', 'Runtime.getRuntime().exec(user)', 'respondText(user)']],
      [Language.Swift, ['let query = "SELECT * FROM users"', 'URLSession.shared.dataTask(with: user)', 'db.execute(user)', 'db.execute(query)', 'FileManager.default.open(user)', 'Process.run(user)', 'respondText(user)']],
      [Language.Dart, ['final query = "SELECT * FROM users";', 'http.get(Uri.parse(user))', 'db.rawQuery(user)', 'db.rawQuery(query)', 'File.readAsString(user)', 'Process.run(user, [])', 'respondText(user)']],
    ];

    for (const [lang, lines] of cases) {
      const signals = extractSecuritySignals(lines, lang);
      assert.ok(signals.find((s) => s.type === 'SSRF' && s.language === lang), lang);
      assert.ok(signals.find((s) => s.type === 'SQL_INJECTION' && s.flags.isDynamic), lang);
      assert.equal(signals.find((s) => s.type === 'SQL_INJECTION' && s.source === '"SELECT * FROM users"')?.flags.isDynamic, false, lang);
      assert.ok(signals.find((s) => s.type === 'PATH_TRAVERSAL'), lang);
      assert.ok(signals.find((s) => s.type === 'COMMAND_INJECTION'), lang);
      assert.ok(signals.find((s) => s.type === 'XSS'), lang);
    }
  });
});
