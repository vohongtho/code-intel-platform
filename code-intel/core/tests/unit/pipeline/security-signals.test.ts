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
      'db.query("SELECT * FROM users WHERE id = ?", [id]);',
      'element.innerHTML = DOMPurify.sanitize(req.body.html);',
      'fs.readFile("/tmp/file.txt");',
      'exec("ls -la");',
      'spawn("git", ["status"]);',
      'fetch(assertAllowedHost(req.query.url));',
      'fs.readFile(safeJoin(base, req.query.path));',
    ];

    const signals = extractSecuritySignals(lines, Language.TypeScript);

    assert.equal(signals.find((s) => s.type === 'SSRF')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.type === 'SQL_INJECTION')?.flags.isParameterized, true);
    assert.equal(signals.find((s) => s.type === 'XSS')?.flags.hasSanitizer, true);
    assert.equal(signals.find((s) => s.type === 'PATH_TRAVERSAL')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.type === 'COMMAND_INJECTION')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.sink === 'spawn')?.flags.isDynamic, false);
    assert.equal(signals.find((s) => s.sink === 'fetch' && s.source.includes('assertAllowedHost'))?.flags.hasSanitizer, true);
    assert.equal(signals.find((s) => s.sink === 'fs.readFile' && s.source.includes('safeJoin'))?.flags.hasSanitizer, true);
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
      'requests.get(request.args["url"])',
      'cursor.execute(f"SELECT * FROM users WHERE id = {request.args[\'id\']}")',
      'return render_template_string(request.form["html"])',
      'open(request.args["path"])',
      'subprocess.run(request.args["cmd"], shell=True)',
    ], Language.Python);

    assert.ok(signals.find((s) => s.type === 'SSRF' && s.language === 'python'));
    assert.ok(signals.find((s) => s.type === 'SQL_INJECTION'));
    assert.ok(signals.find((s) => s.type === 'XSS'));
    assert.ok(signals.find((s) => s.type === 'PATH_TRAVERSAL'));
    assert.ok(signals.find((s) => s.type === 'COMMAND_INJECTION'));
  });

  it('extracts tier 5.1 language sink signals', () => {
    const cases: Array<[Language, string[]]> = [
      [Language.Go, ['http.Get(r.URL.Query().Get("url"))', 'db.Query("SELECT " + user)', 'os.Open(r.URL.Query().Get("path"))', 'exec.Command("sh", user).Run()', 'fmt.Fprintf(w, user)']],
      [Language.Java, ['HttpClient.newHttpClient().send(request)', 'stmt.executeQuery("SELECT " + user)', 'Paths.get(user)', 'Runtime.getRuntime().exec(user)', 'response.getWriter().print(user)']],
      [Language.PHP, ['file_get_contents($_GET["url"])', '$db->query("SELECT " . $_GET["id"])', 'fopen($_GET["path"], "r")', 'shell_exec($_GET["cmd"])', 'echo $_GET["html"]']],
      [Language.Ruby, ['Net::HTTP.get(params[:url])', 'db.execute("SELECT #{params[:id]}")', 'File.read(params[:path])', 'system(params[:cmd])', 'html_safe(params[:html])']],
    ];

    for (const [lang, lines] of cases) {
      const signals = extractSecuritySignals(lines, lang);
      assert.ok(signals.find((s) => s.type === 'SSRF' && s.language === lang), lang);
      assert.ok(signals.find((s) => s.type === 'SQL_INJECTION'), lang);
      assert.ok(signals.find((s) => s.type === 'PATH_TRAVERSAL'), lang);
      assert.ok(signals.find((s) => s.type === 'COMMAND_INJECTION'), lang);
      assert.ok(signals.find((s) => s.type === 'XSS'), lang);
    }
  });

  it('extracts tier 5.2 language sink signals', () => {
    const cases: Array<[Language, string[]]> = [
      [Language.C, ['curl_easy_setopt(curl, CURLOPT_URL, argv[1])', 'mysql_query(conn, user)', 'fopen(argv[1], "r")', 'system(argv[1])', 'printf(user)']],
      [Language.Cpp, ['curl_easy_setopt(curl, CURLOPT_URL, argv[1])', 'db.exec(user)', 'std::ifstream open(argv[1])', 'system(argv[1])', 'write(user)']],
      [Language.CSharp, ['client.GetAsync(Request.Query["url"])', 'cmd.ExecuteReader(user)', 'File.Open(Request.Query["path"])', 'Process.run(user)', 'Response.Write(user)']],
      [Language.Rust, ['reqwest::get(env::args().nth(1))', 'conn.execute(user)', 'fs::read_to_string(env::args().nth(1))', 'Command::new(user)', 'write!(res, user)']],
      [Language.Kotlin, ['httpClient.get(user)', 'stmt.executeQuery(user)', 'Paths.get(user)', 'Runtime.getRuntime().exec(user)', 'call.respondText(user)']],
      [Language.Swift, ['URLSession.shared.dataTask(with: user)', 'db.execute(user)', 'FileManager.default.open(user)', 'Process.run(user)', 'response.write(user)']],
      [Language.Dart, ['http.get(Uri.parse(user))', 'db.rawQuery(user)', 'File.readAsString(user)', 'Process.run(user, [])', 'response.write(user)']],
    ];

    for (const [lang, lines] of cases) {
      const signals = extractSecuritySignals(lines, lang);
      assert.ok(signals.find((s) => s.type === 'SSRF' && s.language === lang), lang);
      assert.ok(signals.find((s) => s.type === 'SQL_INJECTION'), lang);
      assert.ok(signals.find((s) => s.type === 'PATH_TRAVERSAL'), lang);
      assert.ok(signals.find((s) => s.type === 'COMMAND_INJECTION'), lang);
      assert.ok(signals.find((s) => s.type === 'XSS'), lang);
    }
  });
});
