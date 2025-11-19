import express from 'express';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const app = express();
const PORT = process.env.PORT || 3000;

// Rough chapter counts per part on AdaOnline
const PART_CHAPTER_COUNTS = {
  1: 43,
  2: 11,
  3: 8,
  4: 1,  // Part 4 is a single page
  5: 6
};

// Which chapters actually have annotation pages
function hasAnnotationPage(part, chapter) {
  if (part === 1 && chapter >= 1 && chapter <= 43) return true;
  if (part === 2 && chapter >= 1 && chapter <= 11) return true;
  if (part === 3 && chapter >= 1 && chapter <= 2) return true;
  return false;
}

function buildChapters() {
  const chapters = [];
  for (let part = 1; part <= 5; part++) {
    const maxCh = PART_CHAPTER_COUNTS[part];
    for (let ch = 1; ch <= maxCh; ch++) {
      const id = `p${part}c${ch}`;

      // File id in AdaOnline URLs
      let textId;
      if (part === 4) {
        textId = '4';            // ada4.htm
      } else {
        textId = `${part}${ch}`; // ada11.htm, ada12.htm, ada21.htm etc.
      }

      const textUrl = `https://www.ada.auckland.ac.nz/ada${textId}.htm`;

      const notesUrl = hasAnnotationPage(part, ch)
        ? `https://www.ada.auckland.ac.nz/ada${textId}ann.htm`
        : null;

      const title =
        part === 4
          ? 'Part 4'
          : `Part ${part}, Chapter ${ch}`;

      chapters.push({ id, part, chapter: ch, textUrl, notesUrl, title });
    }
  }
  return chapters;
}

const CHAPTERS = buildChapters();

function getChapter(id) {
  return CHAPTERS.find(ch => ch.id === id);
}

app.use(express.static('public'));

app.get('/api/chapters', (req, res) => {
  res.json(
    CHAPTERS.map(({ id, title, textUrl }) => ({
      id,
      title,
      textUrl
    }))
  );
});

function stripLegacyStyling(root) {
  if (!root) return;
  root.querySelectorAll('style, link').forEach(el => el.remove());
  root.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
}

function stripLineBreaks(root) {
  if (!root) return;
  root.querySelectorAll('br').forEach(el => el.remove());
}

function fixImages(root, baseUrl) {
  if (!root) return;
  root.querySelectorAll('img[src]').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!src) return;

    if (!/^https?:\/\//i.test(src)) {
      try {
        const abs = new URL(src, baseUrl).toString();
        img.setAttribute('src', abs);
      } catch (e) {
        // ignore
      }
    }

    img.removeAttribute('width');
    img.removeAttribute('height');
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '12px auto';
  });
}

/**
 * Flatten 2-column margin tables into a flowing <p>,
 * but keep markers as their own line:
 *
 * row0: [empty] | "...Mount Tabor"
 * row1: "3.05"  | "Ltd., 1880). That pronouncement..."
 *
 * -> ...Mount Tabor<br>3.05<br>Ltd., 1880). That pronouncement...
 */
function flattenMarginTables(root) {
  if (!root) return;
  const tables = Array.from(root.querySelectorAll('table'));

  tables.forEach(table => {
    const trs = Array.from(table.querySelectorAll('tr'));
    if (!trs.length) return;

    const allTwoCols = trs.every(tr => {
      const cells = tr.children;
      return (
        cells.length === 2 &&
        cells[0].tagName.toLowerCase() === 'td' &&
        cells[1].tagName.toLowerCase() === 'td'
      );
    });

    if (!allTwoCols) return;

    const doc = table.ownerDocument;
    const wrapper = doc.createElement('p');

    trs.forEach((tr, idx) => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 2) return;

      const marginCell  = cells[0];
      const contentCell = cells[1];

      const hasMarker = (marginCell.textContent || '').trim() !== '';

      const markerFrag = doc.createDocumentFragment();
      while (marginCell.firstChild) {
        markerFrag.appendChild(marginCell.firstChild);
      }

      const contentFrag = doc.createDocumentFragment();
      while (contentCell.firstChild) {
        contentFrag.appendChild(contentCell.firstChild);
      }

      if (idx === 0) {
        if (hasMarker) {
          wrapper.appendChild(markerFrag);
          wrapper.appendChild(doc.createElement('br'));
        }
        wrapper.appendChild(contentFrag);
      } else if (hasMarker) {
        wrapper.appendChild(doc.createElement('br'));
        wrapper.appendChild(markerFrag);
        wrapper.appendChild(doc.createElement('br'));
        wrapper.appendChild(contentFrag);
      } else {
        wrapper.appendChild(doc.createTextNode(' '));
        wrapper.appendChild(contentFrag);
      }
    });

    table.replaceWith(wrapper);
  });
}

app.get('/api/chapter/:id', async (req, res) => {
  const chapter = getChapter(req.params.id);
  if (!chapter) {
    return res.status(404).json({ error: 'Unknown chapter id' });
  }

  try {
    const textResp = await fetch(chapter.textUrl);
    if (!textResp.ok) {
      return res.status(502).json({ error: 'Failed to fetch text page' });
    }
    const textHtml = await textResp.text();

    let notesHtmlRaw = '';
    if (chapter.notesUrl) {
      const notesResp = await fetch(chapter.notesUrl);
      if (!notesResp.ok) {
        return res.status(502).json({ error: 'Failed to fetch notes page' });
      }
      notesHtmlRaw = await notesResp.text();
    }

    const textDom = new JSDOM(textHtml);
    const textDoc = textDom.window.document;
    let textRoot = textDoc.querySelector('#text') || textDoc.querySelector('body');

    stripLegacyStyling(textRoot);
    stripLineBreaks(textRoot);
    flattenMarginTables(textRoot);
    fixImages(textRoot, chapter.textUrl);

    let notesHtml = '';
    if (notesHtmlRaw) {
      const notesDom = new JSDOM(notesHtmlRaw);
      const notesDoc = notesDom.window.document;
      let notesRoot = notesDoc.querySelector('#annotations') || notesDoc.querySelector('body');

      stripLegacyStyling(notesRoot);
      stripLineBreaks(notesRoot);
      flattenMarginTables(notesRoot);
      fixImages(notesRoot, chapter.notesUrl);

      notesHtml = notesRoot.innerHTML;
    }

    res.json({
      id: chapter.id,
      title: chapter.title,
      textHtml: textRoot.innerHTML,
      notesHtml
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Generic wrapper for "second-tier" Ada pages like 422viskovatov.htm
 * We only allow simple filenames like 422viskovatov.htm for safety.
 */
app.get('/api/ref/:file', async (req, res) => {
  const file = req.params.file;
  if (!/^[0-9A-Za-z_-]+\.htm$/i.test(file)) {
    return res.status(400).json({ error: 'Invalid reference file' });
  }

  const url = `https://www.ada.auckland.ac.nz/${file}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      return res.status(502).json({ error: 'Failed to fetch reference page' });
    }
    const html = await resp.text();

    const dom = new JSDOM(html);
    const doc = dom.window.document;
    let root = doc.querySelector('body') || doc.documentElement;

    stripLegacyStyling(root);
    stripLineBreaks(root);
    flattenMarginTables(root);
    fixImages(root, url);

    const title =
      (doc.querySelector('title') && doc.querySelector('title').textContent) ||
      file;

    res.json({
      title,
      html: root.innerHTML
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Ada mobile wrapper on http://localhost:${PORT}`);
});
