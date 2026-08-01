(() => {
  const ROOT = '/libraries/code-intel-platform/versions/1.0.9/pages';
  const CDN = 'https://cdn.jsdelivr.net/gh/vohongtho/code-intel-platform@docs/vercel-guide-1.0.9/guide/pages';
  const pages = {
    'mcp-client-setup': { title: 'MCP Client Setup', group: 'AI & MCP', file: 'mcp-client-setup.md' },
    'integration-status': { title: 'Agent Integration Status', group: 'AI & MCP', file: 'integration-status.md' },
    'cli-reference': { title: 'CLI Reference', group: 'Reference', file: 'cli-reference.md' },
    'mcp-reference': { title: 'MCP Tools & Resources', group: 'Reference', file: 'mcp-reference.md' },
    'operations-runbook': { title: 'Operations Runbook', group: 'Operations', file: 'operations-runbook.md' },
  };
  const cache = new Map();

  function slugify(value) {
    return String(value || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
  }

  function addCopyButtons(container) {
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
    container.querySelectorAll('h2,h3').forEach((heading) => {
      const base = slugify(heading.textContent);
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

  async function loadMarkdown(page) {
    if (cache.has(page.file)) return cache.get(page.file);
    const response = await fetch(`${CDN}/${page.file}?v=20260801-review2`);
    if (!response.ok) throw new Error(`Unable to load ${page.file}: HTTP ${response.status}`);
    const text = await response.text();
    cache.set(page.file, text);
    return text;
  }

  async function render(slug, push = false) {
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
    if (meta) meta.innerHTML = '<span class="meta-pill">1.0.9</span><span class="meta-pill">Source reviewed</span><span class="meta-pill">Updated 2026-08-01</span>';
    const breadcrumbs = document.querySelector('#breadcrumbs');
    if (breadcrumbs) breadcrumbs.innerHTML = `<span>Libraries</span><span>code-intel-platform</span><span>1.0.9</span><span>${page.group}</span>`;
    document.title = `${page.title} — Code Intelligence Platform 1.0.9`;
    content.innerHTML = '<p>Loading reviewed documentation…</p>';

    try {
      const markdown = await loadMarkdown(page);
      content.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
      content.querySelectorAll('pre code').forEach((block) => window.hljs?.highlightElement(block));
      addCopyButtons(content);
      buildToc(content);
    } catch (error) {
      content.innerHTML = `<div class="callout danger"><strong>Documentation load failed.</strong><br>${String(error.message || error)}</div>`;
    }

    document.querySelectorAll('.page-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.reviewedSlug === slug);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function removeLegacyReferenceLinks(nav) {
    const replaced = new Set(Object.values(pages).map((page) => page.title));
    nav.querySelectorAll('.page-link').forEach((link) => {
      if (replaced.has((link.textContent || '').trim())) link.remove();
    });
    nav.querySelectorAll('.sidebar-heading').forEach((heading) => {
      const next = heading.nextElementSibling;
      if (!next || next.classList.contains('sidebar-heading')) heading.remove();
    });
  }

  function installLinks() {
    const nav = document.querySelector('#pageNav');
    if (!nav || nav.dataset.sourceReviewedInstalled === 'true') return;
    nav.dataset.sourceReviewedInstalled = 'true';
    removeLegacyReferenceLinks(nav);

    const groups = [
      ['AI & MCP', ['mcp-client-setup', 'integration-status']],
      ['Reference', ['cli-reference', 'mcp-reference']],
      ['Operations', ['operations-runbook']],
    ];

    groups.forEach(([groupName, slugs]) => {
      const heading = document.createElement('div');
      heading.className = 'sidebar-heading';
      heading.innerHTML = `<span>${groupName}</span><span class="count">${slugs.length}</span>`;
      nav.appendChild(heading);
      slugs.forEach((slug) => {
        const page = pages[slug];
        const link = document.createElement('a');
        link.className = 'page-link';
        link.href = `${ROOT}/${slug}`;
        link.textContent = page.title;
        link.dataset.reviewedSlug = slug;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          render(slug, true);
        });
        nav.appendChild(link);
      });
    });

    const count = document.querySelector('#pageCount');
    if (count) count.textContent = String(nav.querySelectorAll('.page-link').length);
  }

  function route() {
    installLinks();
    const redirected = new URLSearchParams(location.search).get('route');
    const path = redirected || location.pathname;
    const slug = path.match(/\/pages\/([^/?#]+)/)?.[1];
    if (slug && pages[slug]) render(slug, false);
  }

  window.addEventListener('DOMContentLoaded', () => setTimeout(route, 140));
  window.addEventListener('popstate', () => setTimeout(route, 0));
  setTimeout(route, 460);
})();