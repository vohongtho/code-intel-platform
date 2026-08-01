(() => {
  const VERSION = '1.0.9';
  const REF = 'release/1.0.9';
  const ROOT = `/libraries/code-intel-platform/versions/${VERSION}/pages`;

  function replaceText(node) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.includes('1.0.8')) {
      node.nodeValue = node.nodeValue.replaceAll('1.0.8', VERSION);
    }
    node.childNodes?.forEach(replaceText);
  }

  function patchLinks() {
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (href.includes('/versions/1.0.8/pages/')) a.setAttribute('href', href.replace('/versions/1.0.8/pages/', `/versions/${VERSION}/pages/`));
      if (href.includes('release/1.0.8')) a.setAttribute('href', href.replaceAll('release/1.0.8', REF));
    });
  }

  function patchSelect() {
    const select = document.querySelector('#versionSelect');
    if (!select) return;
    select.innerHTML = `<option value="${REF}">${VERSION}</option>`;
    select.value = REF;
  }

  function addReleaseNotes() {
    const content = document.querySelector('#content');
    const title = document.querySelector('#pageTitle')?.textContent || '';
    if (!content || content.dataset.v109Patched === 'true') return;

    let html = '';
    if (/Installation/i.test(title)) {
      html = `<section class="v109-note"><h2>Upgrade notes for 1.0.9</h2><p>Install the current package and confirm the CLI version:</p><pre><code class="language-bash">npm install -g @vohongtho.infotech/code-intel@1.0.9
code-intel --version</code></pre><p>A forced graph rebuild is not required only because of the 1.0.9 vector planner change. Use <code>code-intel analyze --force</code> when upgrading an old pre-1.0.8 index, when metadata is incompatible, when vector storage is missing or stale, or when you intentionally need a complete rebuild.</p></section>`;
    } else if (/Analyze a Repository/i.test(title)) {
      html = `<section class="v109-note"><h2>Incremental graph and vector behavior in 1.0.9</h2><p>Version 1.0.9 separates graph execution scope from vector update scope.</p><ul><li>Any non-empty source change still uses the correctness-first full graph rebuild introduced in 1.0.8.</li><li>Embeddings are deleted and regenerated only for changed files.</li><li>Deleted files remove only their own vectors.</li><li>Unchanged file vectors are preserved.</li><li>Zero-change analysis preserves the vector database without writes.</li></ul><p>A full vector rebuild is limited to first use, <code>--force</code>, missing vector storage, stale or incompatible embedding metadata, or an unknown change scope.</p></section>`;
    } else if (/Troubleshooting/i.test(title)) {
      html = `<section class="v109-note"><h2>Vector troubleshooting in 1.0.9</h2><h3>Vectors rebuild more often than expected</h3><p>Check whether the run used <code>--force</code>, vector storage is missing, metadata is stale or incompatible, or the change scope could not be determined.</p><h3>Deleted source still appears in semantic results</h3><p>Run a normal analysis first. Version 1.0.9 removes vectors belonging to deleted files while preserving unchanged vectors. Use <code>code-intel analyze --force</code> only when storage or metadata is unhealthy.</p><h3>No source changes</h3><p>A zero-change run should not rewrite the vector database. Use debug logs and <code>code-intel doctor</code> if repeated writes are observed.</p></section>`;
    } else if (/Overview/i.test(title)) {
      html = `<section class="v109-note"><h2>What is new in 1.0.9</h2><p>Version 1.0.9 improves incremental vector-update correctness and efficiency. It preserves correctness-first graph rebuilding while limiting embedding writes to changed and deleted files.</p></section>`;
    }

    if (html) {
      content.insertAdjacentHTML('afterbegin', html);
      content.dataset.v109Patched = 'true';
      content.querySelectorAll('pre code').forEach((block) => window.hljs?.highlightElement(block));
    }
  }

  function patch() {
    replaceText(document.body);
    patchLinks();
    patchSelect();
    addReleaseNotes();
    const canonical = location.pathname.replace('/versions/1.0.8/pages/', `/versions/${VERSION}/pages/`);
    if (canonical !== location.pathname) history.replaceState({}, '', canonical + location.search + location.hash);
    document.title = document.title.replaceAll('1.0.8', VERSION);
  }

  const style = document.createElement('style');
  style.textContent = `.v109-note{margin:0 0 28px;padding:20px 22px;border:1px solid #c7d2fe;border-radius:14px;background:#f5f7ff}.v109-note h2{margin-top:0!important}.v109-note pre{margin-bottom:14px}`;
  document.head.appendChild(style);

  new MutationObserver(patch).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', patch);
  window.addEventListener('popstate', patch);
  setTimeout(patch, 500);
})();