const ADA_BASE = 'https://www.ada.auckland.ac.nz/';

const chapterSelect   = document.getElementById('chapter-select');
const chapterTitle    = document.getElementById('chapter-title');
const textContainer   = document.getElementById('text');
const tooltip         = document.getElementById('tooltip');
const overlay         = document.getElementById('overlay');
const overlayContent  = document.getElementById('overlay-content');
const overlayTitle    = document.getElementById('overlay-title');
const overlayClose    = document.getElementById('overlay-close');
const overlayBack     = document.getElementById('overlay-back');

let notesDom = null;
let notesHtml = '';
let overlayStack = [];

// loaded from /api/chapters
let chaptersMeta = [];
// maps "ada12.htm" -> "p1c2"
let chapterHrefMap = {};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function buildChapterHrefMap(chapters) {
  const map = {};
  chapters.forEach(ch => {
    if (!ch.textUrl) return;
    try {
      const u = new URL(ch.textUrl);
      const file = (u.pathname.split('/').pop() || '').toLowerCase();
      if (file) {
        map[file] = ch.id;
      }
    } catch (e) {
      // ignore bad urls
    }
  });
  return map;
}

async function loadChapterList() {
  const chapters = await fetchJSON('/api/chapters');
  chaptersMeta = chapters;
  chapterHrefMap = buildChapterHrefMap(chapters);

  chapterSelect.innerHTML = '';
  chapters.forEach((ch, idx) => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = ch.title;
    if (idx === 0) opt.selected = true;
    chapterSelect.appendChild(opt);
  });

  if (chapters.length) {
    await loadChapter(chapters[0].id);
  } else {
    textContainer.textContent = 'No chapters configured yet.';
  }
}

async function loadChapter(id) {
  textContainer.textContent = 'Loading…';
  tooltip.style.display = 'none';
  closeOverlayCompletely();

  const data = await fetchJSON('/api/chapter/' + encodeURIComponent(id));

  chapterTitle.textContent = data.title;
  textContainer.innerHTML = data.textHtml || '';
  notesHtml = data.notesHtml || '';

  if (notesHtml) {
    const doc = new DOMParser().parseFromString(
      '<div id="notes-root">' + notesHtml + '</div>',
      'text/html'
    );
    notesDom = doc.getElementById('notes-root');
  } else {
    notesDom = null;
  }

  wireTextLinks(textContainer);
}

function isAdaNoteHref(href) {
  if (!href) return true;
  href = href.trim();
  if (href === '' || href === '#') return true;
  if (href.startsWith('#')) return true;
  if (/ada\d+ann\.htm/i.test(href)) return true; // annotation files
  return false;
}

function isRelativeAdaDoc(href) {
  if (!href) return false;
  if (/^https?:\/\//i.test(href)) {
    return /^https?:\/\/www\.ada\.auckland\.ac\.nz/i.test(href);
  }
  return /\.htm(\?|#|$)/i.test(href);
}

function makeAdaAbsolute(href) {
  if (!href) return ADA_BASE;
  if (/^https?:\/\//i.test(href)) return href;
  return ADA_BASE + href.replace(/^\/+/, '');
}

function normalizeAdaHref(href) {
  if (!href) return null;
  let s = href.trim();
  if (!s) return null;

  // strip query/hash
  const hashIdx = s.indexOf('#');
  const qIdx = s.indexOf('?');
  let cut = s.length;
  if (hashIdx >= 0) cut = Math.min(cut, hashIdx);
  if (qIdx >= 0) cut = Math.min(cut, qIdx);
  s = s.slice(0, cut);
  if (!s) return null;

  // absolute: take last path segment
  if (/^https?:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      s = url.pathname.split('/').pop() || '';
    } catch (e) {
      // keep as is
    }
  } else {
    // relative: take last segment
    s = s.split('/').pop() || '';
  }

  return s.toLowerCase() || null;
}

function lookupChapterIdForHref(href) {
  const key = normalizeAdaHref(href);
  if (!key) return null;
  return chapterHrefMap[key] || null;
}

function wireTextLinks(root) {
  const links = root.querySelectorAll('a');
  links.forEach(a => {
    const rawHref = a.getAttribute('href') || '';

    // 1) Ada notes / inline anchors -> open commentary overlay
    if (isAdaNoteHref(rawHref)) {
      a.classList.add('note-link');
      a.addEventListener('click', onNoteClick);
      return;
    }

    // 2) Internal navigation to another chapter (e.g. ada12.htm)
    const chapterId = lookupChapterIdForHref(rawHref);
    if (chapterId) {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        chapterSelect.value = chapterId;
        loadChapter(chapterId).catch(err => console.error(err));
      });
      return;
    }

    // 3) Other Ada docs -> open original AdaOnline page
    if (isRelativeAdaDoc(rawHref)) {
      const abs = makeAdaAbsolute(rawHref);
      a.setAttribute('href', abs);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else {
      // 4) Generic external / relative links
      if (rawHref && !/^https?:\/\//i.test(rawHref)) {
        a.href = rawHref;
      }
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });
}

function wireOverlayLinks() {
  const links = overlayContent.querySelectorAll('a');
  links.forEach(a => {
    const rawHref = a.getAttribute('href') || '';

    // 1) Notes inside notes -> stacked overlays
    if (isAdaNoteHref(rawHref)) {
      a.addEventListener('click', onOverlayNoteClick);
      return;
    }

    // 2) Internal chapter navigation from within notes
    const chapterId = lookupChapterIdForHref(rawHref);
    if (chapterId) {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        closeOverlayCompletely();
        chapterSelect.value = chapterId;
        loadChapter(chapterId).catch(err => console.error(err));
      });
      return;
    }

    // 3) Other Ada docs
    if (isRelativeAdaDoc(rawHref)) {
      const abs = makeAdaAbsolute(rawHref);
      a.setAttribute('href', abs);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else {
      if (rawHref && !/^https?:\/\//i.test(rawHref)) {
        a.href = rawHref;
      }
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });
}

function onNoteClick(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  const phrase = (ev.currentTarget.textContent || '').trim();
  openNoteForPhrase(phrase);
}

function onOverlayNoteClick(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  const phrase = (ev.currentTarget.textContent || '').trim();
  openNoteForPhrase(phrase);
}

function normalize(str) {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

function findNoteSnippet(phrase) {
  const normPhrase = normalize(phrase);
  if (!normPhrase || !notesDom) return '';

  const candidates = Array.from(notesDom.querySelectorAll('p, div, li, dd'));
  let best = null;
  let bestLen = Infinity;

  for (const el of candidates) {
    const text = normalize(el.textContent || '');
    if (!text) continue;
    const idx = text.indexOf(normPhrase);
    if (idx !== -1 && text.length < bestLen) {
      best = el;
      bestLen = text.length;
    }
  }

  if (best) {
    const buf = [best.outerHTML];
    let next = best.nextElementSibling;
    while (next && buf.length < 4) {
      const t = normalize(next.textContent || '');
      if (!t) break;
      buf.push(next.outerHTML);
      next = next.nextElementSibling;
    }
    return buf.join('\n');
  }

  const fullText = normalize(notesDom.textContent || '');
  if (fullText.includes(normPhrase)) return '';

  return '';
}

function openNoteForPhrase(phrase) {
  if (!notesDom) {
    pushOverlay(notesHtml, 'Commentary');
    return;
  }
  const snippet = phrase ? findNoteSnippet(phrase) : '';
  const html = snippet || notesHtml;
  const title = phrase || 'Commentary';
  pushOverlay(html, title);
}

function pushOverlay(html, title) {
  overlayStack.push({ html: html || '<p>No commentary found.</p>', title });
  renderOverlay();
}

function renderOverlay() {
  if (!overlayStack.length) {
    closeOverlayCompletely();
    return;
  }
  const top = overlayStack[overlayStack.length - 1];
  overlayContent.innerHTML = top.html;
  overlayTitle.textContent = top.title || 'Commentary';
  overlay.classList.add('visible');
  if (overlayStack.length > 1) {
    overlay.classList.add('has-stack');
  } else {
    overlay.classList.remove('has-stack');
  }
  document.body.classList.add('modal-open'); // lock background scroll
  wireOverlayLinks();
}

function popOverlay() {
  if (overlayStack.length > 1) {
    overlayStack.pop();
    renderOverlay();
  } else {
    closeOverlayCompletely();
  }
}

function closeOverlayCompletely() {
  overlayStack = [];
  overlay.classList.remove('visible');
  overlay.classList.remove('has-stack');
  overlayContent.innerHTML = '';
  document.body.classList.remove('modal-open');
}

overlayBack.addEventListener('click', () => {
  popOverlay();
});

overlayClose.addEventListener('click', () => {
  closeOverlayCompletely();
});

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) {
    closeOverlayCompletely();
  }
});

chapterSelect.addEventListener('change', () => {
  const id = chapterSelect.value;
  loadChapter(id).catch(err => {
    console.error(err);
    textContainer.textContent = 'Failed to load chapter.';
  });
});

// init
loadChapterList().catch(err => {
  console.error(err);
  textContainer.textContent = 'Failed to load chapter list.';
});
