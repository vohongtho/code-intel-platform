const REPO = 'vohongtho/code-intel-platform';
const DEFAULT_REF = 'release/1.0.8';
const ROOT_ROUTE = '/libraries/code-intel-platform';

const state = {
  ref: localStorage.getItem('code-intel-docs-ref') || DEFAULT_REF,
  markdown: '',
  pages: [],
  activeSlug: 'README',
  activeMarkdown: '',
};

const els = {
  version: document.querySelector('#versionSelect'),
  pageNav: document.querySelector('#pageNav'),
  pageCount: document.querySelector('#pageCount'),
  title: document.querySelector('#pageTitle'),
  meta: document.querySelector('#pageMeta'),
  breadcrumbs: document.querySelector('#breadcrumbs'),
  content: document.querySelector('#content'),
  toc: document.querySelector('#toc'),
  tocNav: document.querySelector('#tocNav'),
  source: document.querySelector('#sourceLink'),
  sidebarSource: document.querySelector('#sidebarSourceLink'),
  copy: document.querySelector('#copyMarkdown'),
  search: document.querySelector('#searchInput'),
  searchResults: document.querySelector('#searchResults'),
  mobilePageTitle: document.querySelector('#mobilePageTitle'),
  sidebar: document.querySelector('#sidebar'),
  openNav: document.querySelector('#openNav'),
  openToc: document.querySelector('#openToc'),
  backdrop: document.querySelector('#backdrop'),
  toast: document.querySelector('#toast'),
};

marked.setOptions({
  gfm: true,
  breaks: false,
});

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'section';
}

function refLabel(ref) {
  return ref === 'main' ? 'main' : ref.replace(/^release\//, '');
}

function rawReadmeUrl(ref) {
  return `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(ref).replace(/%2F/g, '/')}/README.md`;
}

function sourceReadmeUrl(ref) {
  return `https://github.com/${REPO}/blob/${encodeURIComponent(ref).replace(/%2F/g, '/')}/README.md`;
}

function parseRoute() {
  const match = location.pathname.match(/\/versions\/([^/]+)\/pages\/([^/]+)/);
  if (!match) return;
  const version = decodeURIComponent(match[1]);
  state.ref = version === '1.0.8' ? 'release/1.0.8' : version;
  state.activeSlug = decodeURIComponent(match[2]);
}

function routeFor(slug) {
  return `${ROOT_ROUTE}/versions/${encodeURIComponent(refLabel(state.ref))}/pages/${encodeURIComponent(slug)}`;
}

function setRoute(slug, replace = false) {
  state.activeSlug = slug;
  const url = routeFor(slug);
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function splitMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = { title: 'README', slug: 'README', level: 1, lines: [] };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*#*$/);
    if (match) {
      sections.push(current);
      const title = match[1].replace(/[`*_]/g, '').trim();
      current = { title, slug: slugify(title), level: 2, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const fullTitle = (markdown.match(/^#\s+(.+)$/m)?.[1] || 'Code Intelligence Platform').replace(/[`*_]/g, '').trim();
  const fullPage = { title: 'README', displayTitle: fullTitle, slug: 'README', markdown };
  const sectionPages = sections
    .filter((section) => section.slug !== 'README' && section.lines.join('\n').trim())
    .map((section) => ({ ...section, displayTitle: section.title, markdown: section.lines.join('\n').trim() }));

  return [fullPage, ...sectionPages];
}

function uniqueHeadingIds(container) {
  const used = new Map();
  container.querySelectorAll('h1, h2, h3, h4').forEach((heading) => {
    const base = slugify(heading.textContent || 'section');
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    heading.id = count ? `${base}-${count + 1}` : base;
  });
}

function fixRelativeUrls(container) {
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${state.ref}/`;
  const sourceBase = `https://github.com/${REPO}/blob/${state.ref}/`;

  container.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && !/^(https?:|data:|\/\/)/i.test(src)) img.src = rawBase + src.replace(/^\.\//, '');
    img.loading = 'lazy';
  });

  container.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(href)) return;
    link.href = sourceBase + href.replace(/^\.\//, '');
    link.target = '_blank';
    link.rel = 'noreferrer';
  });
}

function addCodeCopyButtons(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.type = 'button';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.querySelector('code')?.innerText || pre.innerText);
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1300);
    });
    pre.appendChild(button);
  });
}

function buildToc(container) {
  const headings = [...container.querySelectorAll('h2, h3')];
  els.tocNav.innerHTML = '';
  if (!headings.length) {
    els.tocNav.innerHTML = '<span class="search-empty">No subsections</span>';
    return;
  }

  headings.forEach((heading) => {
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent;
    link.className = heading.tagName === 'H3' ? 'level-3' : 'level-2';
    link.addEventListener('click', () => closeDrawers());
    els.tocNav.appendChild(link);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (!visible) return;
      els.tocNav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.hash === `#${visible.target.id}`));
    },
    { rootMargin: '-90px 0px -72% 0px' },
  );
  headings.forEach((heading) => observer.observe(heading));
}

function renderSidebar() {
  els.pageNav.innerHTML = '';
  els.pageCount.textContent = state.pages.length;
  state.pages.forEach((page) => {
    const link = document.createElement('a');
    link.className = `page-link${page.slug === state.activeSlug ? ' active' : ''}`;
    link.href = routeFor(page.slug);
    link.textContent = page.title;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setRoute(page.slug);
      renderPage();
      closeDrawers();
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    els.pageNav.appendChild(link);
  });
}

function renderPage() {
  let page = state.pages.find((item) => item.slug === state.activeSlug);
  if (!page) {
    page = state.pages[0];
    setRoute(page.slug, true);
  }
  state.activeMarkdown = page.markdown;

  els.title.textContent = page.displayTitle || page.title;
  els.mobilePageTitle.textContent = page.title;
  document.title = `${page.displayTitle || page.title} — Code Intelligence Platform`;
  els.meta.innerHTML = [
    `<span class="meta-pill">${escapeHtml(refLabel(state.ref))}</span>`,
    `<span class="meta-pill">${Math.max(1, Math.round(page.markdown.length / 1024))} KB Markdown</span>`,
    '<span class="meta-pill">GitHub synchronized</span>',
  ].join('');
  els.breadcrumbs.innerHTML = `<span>Libraries</span><span>code-intel-platform</span><span>${escapeHtml(refLabel(state.ref))}</span>`;

  const clean = DOMPurify.sanitize(marked.parse(page.markdown), {
    ADD_ATTR: ['target'],
  });
  els.content.innerHTML = clean;
  uniqueHeadingIds(els.content);
  fixRelativeUrls(els.content);
  els.content.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
  addCodeCopyButtons(els.content);
  buildToc(els.content);
  renderSidebar();

  const source = sourceReadmeUrl(state.ref);
  els.source.href = source;
  els.sidebarSource.href = `https://github.com/${REPO}/tree/${state.ref}`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function buildSearchIndex() {
  return state.pages.map((page) => {
    const text = page.markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`\[\]()|~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { ...page, searchable: `${page.title} ${text}`.toLowerCase(), plainText: text };
  });
}

function renderSearch(query) {
  const value = query.trim().toLowerCase();
  if (!value) {
    els.searchResults.hidden = true;
    els.searchResults.innerHTML = '';
    return;
  }

  const results = buildSearchIndex()
    .filter((page) => page.searchable.includes(value))
    .slice(0, 8);

  els.searchResults.hidden = false;
  els.searchResults.innerHTML = `<h2>${results.length} result${results.length === 1 ? '' : 's'} for “${escapeHtml(query)}”</h2>`;

  if (!results.length) {
    els.searchResults.insertAdjacentHTML('beforeend', '<div class="search-empty">No matching sections in this version.</div>');
    return;
  }

  results.forEach((page) => {
    const index = page.searchable.indexOf(value);
    const start = Math.max(0, index - 80);
    const snippet = page.plainText.slice(start, start + 190);
    const link = document.createElement('a');
    link.className = 'search-result';
    link.href = routeFor(page.slug);
    link.innerHTML = `<strong>${escapeHtml(page.title)}</strong><span>${escapeHtml(snippet)}…</span>`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setRoute(page.slug);
      renderPage();
      els.search.value = '';
      renderSearch('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    els.searchResults.appendChild(link);
  });
}

async function loadGuide() {
  els.version.value = state.ref;
  const url = rawReadmeUrl(state.ref);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    state.markdown = await response.text();
    state.pages = splitMarkdown(state.markdown);
    renderPage();
  } catch (error) {
    els.title.textContent = 'Guide unavailable';
    els.content.innerHTML = `
      <div class="loading-card">
        <div>
          <strong>Unable to load README from GitHub.</strong>
          <p>${escapeHtml(error.message)}. Open the original repository or try again.</p>
        </div>
      </div>`;
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function openDrawer(target) {
  closeDrawers();
  target.classList.add('open');
  els.backdrop.hidden = false;
}

function closeDrawers() {
  els.sidebar.classList.remove('open');
  els.toc.classList.remove('open');
  els.backdrop.hidden = true;
}

els.version.addEventListener('change', async () => {
  state.ref = els.version.value;
  localStorage.setItem('code-intel-docs-ref', state.ref);
  setRoute('README', true);
  els.content.innerHTML = '<div class="loading-card"><span class="spinner"></span><p>Loading selected version…</p></div>';
  await loadGuide();
});

els.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.activeMarkdown);
  showToast('Markdown copied to clipboard');
});

els.search.addEventListener('input', (event) => renderSearch(event.target.value));
els.search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.target.value = '';
    renderSearch('');
    event.target.blur();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== els.search) {
    event.preventDefault();
    els.search.focus();
  }
});

els.openNav.addEventListener('click', () => openDrawer(els.sidebar));
els.openToc.addEventListener('click', () => openDrawer(els.toc));
els.backdrop.addEventListener('click', closeDrawers);
window.addEventListener('popstate', () => {
  parseRoute();
  renderPage();
});

parseRoute();
loadGuide();
