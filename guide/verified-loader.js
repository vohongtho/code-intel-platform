(() => {
'use strict';
const VERSION = '1.0.9';
const ROOT = `/libraries/code-intel-platform/versions/${VERSION}/pages`;
const pages = window.CODE_INTEL_VERIFIED_PAGES || [];
const $ = (s) => document.querySelector(s);
const els = {
  nav: $('#pageNav'), count: $('#pageCount'), title: $('#pageTitle'), meta: $('#pageMeta'),
  crumbs: $('#breadcrumbs'), content: $('#content'), toc: $('#tocNav'), search: $('#searchInput'),
  results: $('#searchResults'), mobileTitle: $('#mobilePageTitle'), sidebar: $('#sidebar'),
  tocPanel: $('#toc'), backdrop: $('#backdrop'), toast: $('#toast'), copy: $('#copyMarkdown')
};
marked.setOptions({gfm:true, breaks:false});
function slugify(v) { return String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'section'; }
function route(slug) { return `${ROOT}/${slug}`; }
function requestedSlug() {
  const q = new URLSearchParams(location.search).get('route');
  const p = q || location.pathname;
  const m = p.match(/\/pages\/([^/?#]+)/);
  return m?.[1] || 'overview';
}
function pageBySlug(slug) { return pages.find(p => p.slug === slug) || pages[0]; }
function renderNav(active) {
  els.nav.innerHTML = '';
  let group = '';
  for (const p of pages) {
    if (p.group !== group) {
      group = p.group;
      const h = document.createElement('div');
      h.className = 'nav-group';
      h.textContent = group;
      els.nav.appendChild(h);
    }
    const a = document.createElement('a');
    a.className = 'page-link' + (p.slug === active ? ' active' : '');
    a.href = route(p.slug);
    a.textContent = p.title;
    a.addEventListener('click', e => { e.preventDefault(); navigate(p.slug); });
    els.nav.appendChild(a);
  }
  els.count.textContent = String(pages.length);
}
function renderToc() {
  els.toc.innerHTML = '';
  els.content.querySelectorAll('h2,h3').forEach(h => {
    h.id = slugify(h.textContent);
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    a.className = h.tagName === 'H3' ? 'level-3' : 'level-2';
    els.toc.appendChild(a);
  });
}
function render(slug, push=false) {
  const p = pageBySlug(slug);
  if (!p) return;
  if (push) history.pushState({}, '', route(p.slug));
  renderNav(p.slug);
  els.title.textContent = p.title;
  els.mobileTitle.textContent = p.title;
  els.meta.innerHTML = `<span class="meta-pill">${VERSION}</span><span class="meta-pill">runtime-verified</span><span class="meta-pill">${p.group}</span>`;
  els.crumbs.innerHTML = `<span>Code Intel</span><span>${VERSION}</span><span>${p.group}</span>`;
  els.content.innerHTML = DOMPurify.sanitize(marked.parse(p.markdown));
  els.content.querySelectorAll('pre code').forEach(b => window.hljs?.highlightElement(b));
  document.title = `${p.title} — Code Intelligence Platform ${VERSION}`;
  renderToc();
  window.scrollTo({top:0});
}
function navigate(slug) { render(slug, true); closePanels(); }
function closePanels() {
  els.sidebar?.classList.remove('open');
  els.tocPanel?.classList.remove('open');
  if (els.backdrop) els.backdrop.hidden = true;
}
function doSearch() {
  const q = els.search.value.trim().toLowerCase();
  if (!q) {
    els.results.hidden = true;
    els.results.innerHTML = '';
    return;
  }
  const hits = pages.map(p => ({
    p,
    score: (p.title.toLowerCase().includes(q) ? 5 : 0) +
      (p.markdown.toLowerCase().split(q).length - 1)
  })).filter(x => x.score > 0).sort((a,b) => b.score-a.score).slice(0,12);
  els.results.innerHTML = hits.map(x => `<button data-slug="${x.p.slug}"><strong>${x.p.title}</strong><span>${x.p.group}</span></button>`).join('');
  els.results.hidden = false;
  els.results.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    els.search.value = '';
    els.results.hidden = true;
    navigate(b.dataset.slug);
  }));
}
els.search?.addEventListener('input', doSearch);
els.search?.addEventListener('keydown', e => {
  if (e.key === 'Escape') { els.search.value = ''; doSearch(); }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== els.search) {
    e.preventDefault();
    els.search?.focus();
  }
});
$('#openNav')?.addEventListener('click', () => {
  els.sidebar?.classList.add('open');
  if (els.backdrop) els.backdrop.hidden = false;
});
$('#openToc')?.addEventListener('click', () => {
  els.tocPanel?.classList.add('open');
  if (els.backdrop) els.backdrop.hidden = false;
});
els.backdrop?.addEventListener('click', closePanels);
els.copy?.addEventListener('click', async () => {
  const p = pageBySlug(requestedSlug());
  if (!p) return;
  await navigator.clipboard.writeText(p.markdown);
  if (els.toast) {
    els.toast.textContent = 'Guide copied';
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 1400);
  }
});
$('#versionSelect')?.addEventListener('change', e => { e.target.value = 'release/1.0.9'; });
window.addEventListener('popstate', () => render(requestedSlug(), false));
render(requestedSlug(), false);
})();
