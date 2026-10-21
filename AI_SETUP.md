# AI consultant notes: setup

Every page (except Tracking setup) has an AI consultant notes panel at the bottom. On GitHub Pages it calls Claude through the Apps Script proxy you already use, so the Anthropic API key never appears in the public code.

## 1. API key
Apps Script editor → Project Settings → Script properties → add:
- `ANTHROPIC_API_KEY` = your key from console.anthropic.com

## 2. Add this to the proxy script (next to the existing doGet)

```js
function doPost(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ error: 'Bad request' }); }
  if (req.action !== 'ai') return out({ error: 'Unknown action' });
  // Use the same access-key check as doGet. Replace isValidKey with the function or comparison your doGet uses.
  if (!isValidKey(req.key)) return out({ error: 'UNAUTHORIZED' });
  const b = req.body || {};
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: b.model || 'claude-sonnet-4-5', max_tokens: Math.min(b.max_tokens || 2500, 4000), system: b.system, messages: b.messages }),
  });
  const r = JSON.parse(res.getContentText());
  if (r.error) return out({ error: r.error.message });
  return out({ text: (r.content || []).map(c => c.text || '').join('') });
}
```

## 3. Redeploy
Deploy → Manage deployments → edit the current deployment → Version: **New version** → Deploy. The URL stays the same.

## How it behaves
- The notes are written once every panel has data, then saved in the browser.
- New data (a sync) or a different period or branch changes the figures, and the notes are written again. The same figures reuse the saved notes, so there is no extra API cost.
- **Regenerate** forces a new version.
- Each page sends the figures and table text visible on that page. Executive overview sends aggregated figures only; other pages may include IDs shown in their tables.
