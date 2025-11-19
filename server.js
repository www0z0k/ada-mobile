import express from 'express';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const app = express();
const PORT = process.env.PORT || 3000;

// For now: Part 1, Chapter 1
const CHAPTERS = [
  {
    id: 'p1c1',
    title: 'Part 1, Chapter 1',
    textUrl: 'https://www.ada.auckland.ac.nz/ada11.htm',
    notesUrl: 'https://www.ada.auckland.ac.nz/ada11ann.htm'
  }
];

function getChapter(id) {
  return CHAPTERS.find(ch => ch.id === id);
}

app.use(express.static('public'));

app.get('/api/chapters', (req, res) => {
  res.json(CHAPTERS.map(({ id, title }) => ({ id, title })));
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
        // ignore bad urls
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
 * ADAonline uses 2-column tables:
 *   left column: margin note number (3.05 etc)
 *   right column: actual text, one line per <tr>
 *
 * This flattens such tables into a single <p> with all right-cell
 * contents concatenated, so we get normal flowing paragraphs.
 */
function flattenMarginTables(root) {
  if (!root) return;
  const tables = Array.from(root.querySelectorAll('table'));

  tables.forEach(table => {
    const trs = Array.from(table.querySelectorAll('tr'));
    if (!trs.length) return;

    // Only touch tables that *look* like the margin layout:
    // every row has exactly 2 TDs.
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
      const contentCell = cells[1];

      // Add a separating space between rows (so words don't glue).
      if (idx > 0) {
        wrapper.appendChild(doc.createTextNode(' '));
      }

      // Move all child nodes from contentCell into wrapper
      while (contentCell.firstChild) {
        wrapper.appendChild(contentCell.firstChild);
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
    const [textResp, notesResp] = await Promise.all([
      fetch(chapter.textUrl),
      fetch(chapter.notesUrl)
    ]);

    if (!textResp.ok || !notesResp.ok) {
      return res.status(502).json({ error: 'Failed to fetch source pages' });
    }

    const [textHtml, notesHtml] = await Promise.all([
      textResp.text(),
      notesResp.text()
    ]);

    const textDom = new JSDOM(textHtml);
    const notesDom = new JSDOM(notesHtml);

    const textDoc = textDom.window.document;
    const notesDoc = notesDom.window.document;

    let textRoot = textDoc.querySelector('#text') || textDoc.querySelector('body');
    let notesRoot = notesDoc.querySelector('#annotations') || notesDoc.querySelector('body');

    // Clean & normalize both
    stripLegacyStyling(textRoot);
    stripLegacyStyling(notesRoot);

    stripLineBreaks(textRoot);
    stripLineBreaks(notesRoot);

    flattenMarginTables(textRoot);
    flattenMarginTables(notesRoot);

    fixImages(textRoot, chapter.textUrl);
    fixImages(notesRoot, chapter.notesUrl);

    res.json({
      id: chapter.id,
      title: chapter.title,
      textHtml: textRoot.innerHTML,
      notesHtml: notesRoot.innerHTML
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Ada mobile wrapper on http://localhost:${PORT}`);
});
