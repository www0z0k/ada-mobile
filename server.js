import express from 'express';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const app = express();
const PORT = process.env.PORT || 3000;

// One chapter to start: Part 1, Chapter 1
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

    textRoot.querySelectorAll('style, link').forEach(el => el.remove());
    notesRoot.querySelectorAll('style, link').forEach(el => el.remove());
    textRoot.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
    notesRoot.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));

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
