(() => {
  const ROOT = '/libraries/code-intel-platform/versions/1.0.9/pages';

  const pages = {
    'openspec-overview': {
      title: 'OpenSpec Integration',
      group: 'OpenSpec Integration',
      markdown: `# OpenSpec + Code Intel Integration

OpenSpec manages **what must change**. Code Intel MCP explains **where and how the code must change**.

Together they create a spec-driven implementation loop:

\`\`\`text
Requirement / CR
  → OpenSpec explore or propose
  → Code Intel repository discovery
  → OpenSpec proposal, specs, design, tasks
  → Code Intel impact and context
  → OpenSpec apply
  → Code Intel verification tools
  → OpenSpec sync and archive
\`\`\`

## Responsibilities

| Tool | Responsibility |
|---|---|
| OpenSpec | Requirement intent, behavioral specs, design decisions, tasks, lifecycle, audit trail |
| Code Intel MCP | Symbol search, repository topology, dependencies, blast radius, implementation context, test impact, health and security signals |

## Initial setup

Run in the project root:

\`\`\`bash
openspec init
code-intel analyze --embeddings
code-intel setup
\`\`\`

The default OpenSpec core profile installs the everyday workflow commands. Expanded workflows can be enabled through the OpenSpec profile configuration and regenerated with \`openspec update\`.

## Recommended project context

Add Code Intel expectations to \`openspec/config.yaml\`:

\`\`\`yaml
schema: spec-driven

context: |
  Use Code Intel MCP before reading or changing source code.
  Investigation order: overview → search → inspect → blast_radius → context.
  Before implementation, map every task to affected symbols and tests.
  After implementation, run detect_changes or pr_impact, suggest_tests,
  health_report, secrets, and vulnerability_scan where relevant.

rules:
  proposal:
    - Include current behavior discovered through Code Intel.
    - List affected repositories, modules, APIs, and risks.
  specs:
    - Describe externally verifiable behavior using requirements and scenarios.
    - Do not copy internal implementation details into behavioral specs.
  design:
    - Cite important symbols, dependencies, data flows, and blast radius.
  tasks:
    - Map each implementation task to symbols or files.
    - Include tests and post-change Code Intel validation.
\`\`\`

## Core operating rule

Do not let the agent jump directly from a CR to editing files. Require it to:

1. Clarify intent with OpenSpec.
2. Ground the plan using Code Intel MCP.
3. Review proposal/spec/design/tasks.
4. Apply the approved change.
5. Verify implementation against both spec and graph impact.
6. Archive the completed change.`
    },

    'openspec-workflows': {
      title: 'OpenSpec Workflows',
      group: 'OpenSpec Integration',
      markdown: `# OpenSpec Integration Workflows

This page lists practical workflows that combine OpenSpec actions with Code Intel MCP tools.

## 1. Standard feature workflow

Best for a clear small or medium feature.

\`\`\`text
/opsx:propose
  → overview
  → search
  → inspect
  → blast_radius
  → context
  → review artifacts
/opsx:apply
  → detect_changes
  → suggest_tests
  → health_report
/opsx:archive
\`\`\`

Example:

\`\`\`text
/opsx:propose add-device-alert-filter

Before finalizing proposal.md, specs, design.md, and tasks.md:
1. Use overview to understand the repository.
2. Search for warning_level, device alerts, and alert filters.
3. Inspect the API handler, service, repository query, and UI contract.
4. Run blast_radius on the filtering service.
5. Build context for the affected symbols.
6. Include affected endpoints, backward compatibility, tests, and rollout risk.
\`\`\`

## 2. Explore-first workflow

Best when the CR is vague or the technical cause is unknown.

\`\`\`text
/opsx:explore
  → overview
  → search
  → clusters
  → find_path
  → inspect
  → explain_relationship
/opsx:propose
  → context
  → blast_radius
/opsx:apply
  → verification
\`\`\`

Concrete example:

\`\`\`text
/opsx:explore

Investigate why vector search sometimes reports vector mode while results are
hybrid-ranked. Use Code Intel MCP search, inspect, find_path, and
explain_relationship. Compare the HTTP and MCP execution paths. Do not modify
code. Produce options, evidence, affected contracts, and a recommended change.
\`\`\`

## 3. Step-by-step controlled workflow

Best for high-risk or architecture-heavy changes. Requires expanded OPSX commands.

\`\`\`text
/opsx:new <change>
  → Code Intel investigation
/opsx:continue
  → proposal
/opsx:continue
  → specs
/opsx:continue
  → design
/opsx:continue
  → tasks
/opsx:apply
/opsx:verify
/opsx:archive
\`\`\`

Use this when each artifact needs separate review or approval.

## 4. Fast-forward planning workflow

Best when the problem is already understood and you want all planning artifacts generated together.

\`\`\`text
/opsx:new improve-incremental-vector-update
  → overview / search / inspect / blast_radius
/opsx:ff
/opsx:apply
/opsx:verify
/opsx:archive
\`\`\`

The agent must still ground generated artifacts in Code Intel evidence before implementation.

## 5. Bug-fix workflow

\`\`\`text
Reproduce
  → search error or behavior
  → inspect suspected symbols
  → find_path / explain_relationship
  → blast_radius
/opsx:propose fix-...
/opsx:apply
  → suggest_tests
  → detect_changes
/opsx:verify
/opsx:archive
\`\`\`

Example prompt:

\`\`\`text
/opsx:propose fix-zero-change-vector-write

Observed behavior: a no-source-change analyze run rewrites vector storage.
Use Code Intel MCP to locate analyze mode selection, embedding update planning,
metadata checks, and vector persistence. Create regression scenarios proving that
zero-change runs perform no vector writes and preserve search results.
\`\`\`

## 6. Refactoring workflow

\`\`\`text
search responsibility
  → inspect primary symbols
  → similar_symbols
  → blast_radius
  → find_path
/opsx:propose refactor-...
  → behavior-preserving specs
  → migration design
/opsx:apply
  → suggest_tests
  → health_report
  → complexity_hotspots
/opsx:verify
\`\`\`

The OpenSpec specs should preserve behavior; design.md captures internal restructuring.

## 7. API or contract change workflow

\`\`\`text
routes / list_exports
  → inspect handlers and contracts
  → blast_radius
  → group_contracts for multi-repo systems
/opsx:propose
  → compatibility scenarios
  → migration and rollout design
/opsx:apply
  → pr_impact
  → suggest_tests
/opsx:sync
/opsx:archive
\`\`\`

Include request/response schemas, status codes, compatibility window, consumers, and deprecation behavior.

## 8. Security remediation workflow

\`\`\`text
secrets / vulnerability_scan
  → inspect finding
  → explain_relationship
  → blast_radius
/opsx:propose remediate-...
  → threat and acceptance scenarios
/opsx:apply
  → vulnerability_scan
  → secrets
  → suggest_tests
/opsx:verify
/opsx:archive
\`\`\`

Example:

\`\`\`text
/opsx:propose prevent-ssrf-in-custom-provider

Use vulnerability_scan to identify SSRF signals. Inspect the URL validation and
HTTP client path. Specify allowed protocols, blocked private address ranges,
redirect handling, error responses, and regression tests.
\`\`\`

## 9. Performance workflow

\`\`\`text
/opsx:explore
  → complexity_hotspots
  → health_report
  → flows
  → find_path
/opsx:propose improve-...
  → measurable performance requirements
/opsx:apply
  → compare profile/load results
/opsx:verify
\`\`\`

Add measurable acceptance criteria such as latency, memory, index duration, or throughput.

## 10. Pull-request review workflow

Use when implementation already exists.

\`\`\`text
detect_changes or pr_impact
  → inspect changed symbols
  → explain_relationship
  → blast_radius
  → suggest_tests
  → health_report
  → vulnerability_scan if relevant
/opsx:verify <change>
\`\`\`

The review should identify mismatches between code, tasks, design, and behavioral scenarios.

## 11. Multi-repository workflow

\`\`\`text
group_list
  → group_status
  → group_sync
  → group_contracts
  → group_query
  → repo-specific inspect / blast_radius
/opsx:propose
  → per-repo tasks and deployment order
/opsx:apply
  → group_status / group_contracts
/opsx:verify
\`\`\`

Use for API providers/consumers, event schemas, shared libraries, or coordinated service releases.

## 12. Long-running change workflow

\`\`\`text
/opsx:propose
  → implementation over multiple PRs
/opsx:sync
  → merge approved delta specs before final completion
  → continue implementation
/opsx:verify
/opsx:archive
\`\`\`

Manual sync is useful when main specs must reflect an approved change before the implementation is fully archived.

## 13. Documentation or tooling-only workflow

\`\`\`text
/opsx:propose update-guide
  → inspect relevant CLI/MCP source
/opsx:apply
  → verify links and rendered content
openspec archive update-guide --skip-specs
\`\`\`

Use \`--skip-specs\` only when the change genuinely does not alter product behavior.

## 14. Parallel completed-change cleanup

Expanded workflows may use bulk archive for multiple completed independent changes.

Before bulk archive:

1. Run verification for each change.
2. Confirm tasks are complete.
3. Confirm delta specs do not conflict.
4. Run Code Intel impact checks for overlapping files or symbols.
5. Archive only changes that are independently releasable.`
    },

    'openspec-prompts': {
      title: 'OpenSpec Prompt Templates',
      group: 'OpenSpec Integration',
      markdown: `# OpenSpec + Code Intel Prompt Templates

These templates can be pasted into an AI coding assistant that has both OpenSpec commands and Code Intel MCP.

## Proposal template

\`\`\`text
/opsx:propose <change-name>

Requirement:
<business or technical requirement>

Before generating the final artifacts, use Code Intel MCP:
- overview for repository shape
- search for the responsible behavior
- inspect all primary symbols
- blast_radius for affected dependencies
- context for the final implementation scope
- routes/list_exports/group_contracts when contracts are involved

proposal.md must include:
- current behavior supported by code evidence
- desired behavior
- affected users, repositories, modules, APIs, and data
- compatibility and rollout risks
- explicit non-goals

specs must include verifiable requirements and GIVEN/WHEN/THEN scenarios.
design.md must cite important symbols and dependency paths.
tasks.md must map work to symbols/files and include tests and validation.
Do not implement code yet.
\`\`\`

## Apply template

\`\`\`text
/opsx:apply <change-name>

Before editing each task:
1. Read the relevant task and acceptance scenarios.
2. Use Code Intel inspect and context for the target symbols.
3. Use blast_radius before modifying shared behavior.
4. Implement only the approved scope.
5. Add or update tests for each scenario.
6. Mark the OpenSpec task complete only after validation.

After implementation run:
- detect_changes or pr_impact
- suggest_tests
- health_report
- complexity_hotspots when refactoring
- secrets and vulnerability_scan for security-sensitive code

Report any mismatch between implementation and OpenSpec artifacts.
\`\`\`

## Verify template

\`\`\`text
/opsx:verify <change-name>

Verify three dimensions:
- Completeness: every task and scenario is implemented.
- Correctness: implementation matches requirement intent and edge cases.
- Coherence: design decisions match actual code structure.

Use Code Intel MCP to:
- detect_changes
- inspect changed symbols
- compute blast_radius
- suggest_tests
- run health_report
- run vulnerability_scan and secrets when relevant

Return a verdict for every requirement and scenario:
PASS, PARTIAL, FAIL, or NOT VERIFIED.
Do not archive when critical requirements fail.
\`\`\`

## Archive template

\`\`\`text
/opsx:archive <change-name>

Before archive:
- confirm all tasks are complete
- confirm verification has no unresolved critical failures
- confirm delta specs match deployed behavior
- sync specs when required
- preserve proposal, design decisions, implementation notes, and validation evidence
\`\`\`

## CR intake example

\`\`\`text
/opsx:propose add-risk-zone-alert-acknowledgement

CR summary:
Operators need to acknowledge a Risk Zone Alert. The latest sensor event should
remain visible, but acknowledged alerts must be distinguishable and auditable.

Use Code Intel MCP to discover:
- alert persistence model
- latest-event selection logic
- REST endpoints and authorization
- notification behavior
- Web UI alert list
- audit-log integration

Specify scenarios for acknowledge, repeated acknowledge, unauthorized user,
new event after acknowledgement, filtering, audit history, and backward
compatibility. Include database migration, API contract, UI impact, and tests.
\`\`\`

## Bug investigation example

\`\`\`text
/opsx:explore

Investigate why incremental analysis can preserve stale vectors after a deleted
source file. Use search, inspect, find_path, and explain_relationship to trace
change detection through embedding planning and vector persistence. Do not edit
code. Produce evidence, reproduction steps, likely root cause, affected versions,
and safe fix options. Then recommend an OpenSpec change name.
\`\`\`

## Multi-repo example

\`\`\`text
/opsx:propose version-device-alert-contract

Use group_list, group_status, group_sync, group_contracts, and group_query across
portal-api, notification-service, and mobile-api. Identify providers and
consumers of the device alert payload. Define a backward-compatible schema
migration, per-repository tasks, deployment order, rollback, and contract tests.
\`\`\``
    },

    'openspec-example': {
      title: 'End-to-End Example',
      group: 'OpenSpec Integration',
      markdown: `# End-to-End OpenSpec Example

This example adds an explicit MCP search-mode selector to an application using Code Intel.

## Step 1 — Explore current behavior

\`\`\`text
/opsx:explore

Use Code Intel MCP to compare MCP search and HTTP search behavior. Search for
executeSearchRequest, execute-scoped-search, hybridSearch, requestedMode,
actualMode, and searchMode. Inspect the handlers and explain the relationship
between MCP, HTTP, BM25, and vector execution. Do not modify code.
\`\`\`

Expected Code Intel sequence:

\`\`\`text
overview
→ search("executeSearchRequest")
→ inspect("executeSearchRequest")
→ find_path(MCP search handler, executeSearchRequest)
→ explain_relationship(MCP handler, hybrid search)
→ blast_radius("executeSearchRequest")
\`\`\`

## Step 2 — Create the OpenSpec change

\`\`\`text
/opsx:propose truthful-mcp-search-mode

Create proposal, specs, design, and tasks. The MCP search tool must accept auto,
bm25, and vector. Responses must report requestedMode and actualMode. Vector
fallback must distinguish unavailable index from query execution failure.
Use the Code Intel evidence collected during explore.
\`\`\`

Example behavioral spec:

\`\`\`markdown
### Requirement: Truthful MCP search mode

The MCP search tool SHALL report the requested mode and the mode actually used.

#### Scenario: Vector search succeeds
- **GIVEN** a ready vector index
- **WHEN** the caller requests vector mode
- **THEN** requestedMode is vector
- **AND** actualMode reflects vector-capable execution

#### Scenario: Vector index is unavailable
- **GIVEN** vector mode is requested
- **AND** no ready vector index exists
- **WHEN** search executes
- **THEN** the request falls back to BM25
- **AND** the response reports VECTOR_INDEX_UNAVAILABLE

#### Scenario: Vector query fails
- **GIVEN** a ready vector index
- **AND** vector execution throws an error
- **WHEN** search executes
- **THEN** the request falls back safely
- **AND** the response reports VECTOR_QUERY_FAILED
\`\`\`

## Step 3 — Review design and impact

Use:

\`\`\`text
inspect executeSearchRequest
inspect normalizeSearchRequest
blast_radius executeSearchRequest
context [executeSearchRequest, normalizeSearchRequest] intent=architecture
suggest_tests executeSearchRequest
\`\`\`

Design should identify:

- Shared search executor as the single contract boundary.
- MCP and HTTP adapters.
- Search mode normalization.
- Vector status and fallback error mapping.
- Compatibility behavior for omitted mode.
- Unit and integration regression tests.

## Step 4 — Apply

\`\`\`text
/opsx:apply truthful-mcp-search-mode

Implement tasks in order. Before changing each symbol, use Code Intel inspect and
blast_radius. Add tests for explicit modes, omitted mode, unavailable vector
index, empty vector result, vector exception, and HTTP/MCP parity.
\`\`\`

## Step 5 — Verify

\`\`\`text
/opsx:verify truthful-mcp-search-mode
\`\`\`

Code Intel validation sequence:

\`\`\`text
detect_changes
→ pr_impact
→ inspect changed symbols
→ suggest_tests
→ health_report
→ vulnerability_scan (if request handling changed)
\`\`\`

Example verdict table:

| Requirement | Evidence | Verdict |
|---|---|---|
| Explicit auto/bm25/vector input | MCP schema + tests | PASS |
| Omitted mode compatibility | regression test | PASS |
| Truthful requested/actual mode | executor contract tests | PASS |
| Unavailable vs failed distinction | fallback tests | PASS |
| HTTP and MCP parity | shared executor integration test | PASS |

## Step 6 — Sync and archive

For a normal completed change:

\`\`\`text
/opsx:archive truthful-mcp-search-mode
\`\`\`

For a long-running approved change where main specs must be updated early:

\`\`\`text
/opsx:sync truthful-mcp-search-mode
# continue implementation and deployment
/opsx:verify truthful-mcp-search-mode
/opsx:archive truthful-mcp-search-mode
\`\`\`

The archived folder preserves requirement intent, design reasoning, tasks, and implementation history.`
    }
  };

  function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
  }

  function addCodeButtons(container) {
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-code')) return;
      const button = document.createElement('button');
      button.className = 'copy-code';
      button.type = 'button';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(pre.querySelector('code')?.innerText || pre.innerText);
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 1200);
      });
      pre.appendChild(button);
    });
  }

  function buildToc(container) {
    const toc = document.querySelector('#tocNav');
    if (!toc) return;
    toc.innerHTML = '';
    const used = new Map();
    container.querySelectorAll('h2, h3').forEach((heading) => {
      const base = slugify(heading.textContent || 'section');
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      heading.id = count ? `${base}-${count + 1}` : base;
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      link.className = heading.tagName === 'H3' ? 'level-3' : 'level-2';
      toc.appendChild(link);
    });
  }

  function render(slug, push = false) {
    const page = pages[slug];
    if (!page) return false;
    if (push) history.pushState({}, '', `${ROOT}/${slug}`);
    const content = document.querySelector('#content');
    const title = document.querySelector('#pageTitle');
    if (!content || !title) return false;
    title.textContent = page.title;
    const mobile = document.querySelector('#mobilePageTitle');
    if (mobile) mobile.textContent = page.title;
    const meta = document.querySelector('#pageMeta');
    if (meta) meta.innerHTML = '<span class="meta-pill">1.0.9</span><span class="meta-pill">OpenSpec OPSX</span><span class="meta-pill">Code Intel MCP</span>';
    const breadcrumbs = document.querySelector('#breadcrumbs');
    if (breadcrumbs) breadcrumbs.innerHTML = '<span>Libraries</span><span>code-intel-platform</span><span>1.0.9</span><span>OpenSpec Integration</span>';
    document.title = `${page.title} — Code Intelligence Platform 1.0.9`;
    content.innerHTML = DOMPurify.sanitize(marked.parse(page.markdown));
    content.querySelectorAll('pre code').forEach((block) => window.hljs?.highlightElement(block));
    addCodeButtons(content);
    buildToc(content);
    document.querySelectorAll('.page-link').forEach((link) => link.classList.toggle('active', link.dataset.openspecSlug === slug));
    window.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function installLinks() {
    const nav = document.querySelector('#pageNav');
    if (!nav || nav.dataset.openspecInstalled === 'true') return;
    nav.dataset.openspecInstalled = 'true';
    const heading = document.createElement('div');
    heading.className = 'sidebar-heading';
    heading.innerHTML = '<span>OpenSpec Integration</span><span class="count">4</span>';
    nav.appendChild(heading);
    Object.entries(pages).forEach(([slug, page]) => {
      const link = document.createElement('a');
      link.className = 'page-link';
      link.href = `${ROOT}/${slug}`;
      link.textContent = page.title;
      link.dataset.openspecSlug = slug;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        render(slug, true);
      });
      nav.appendChild(link);
    });
    const count = document.querySelector('#pageCount');
    if (count) count.textContent = String(Number(count.textContent || '0') + 4);
  }

  function route() {
    installLinks();
    const slug = location.pathname.match(/\/pages\/([^/]+)/)?.[1];
    if (slug && pages[slug]) render(slug);
  }

  window.addEventListener('DOMContentLoaded', () => setTimeout(route, 140));
  window.addEventListener('popstate', () => setTimeout(route, 0));
  setTimeout(route, 450);
})();