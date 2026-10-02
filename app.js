/* ScriptShare: edit a trailer script on the phone and save it to a PRIVATE GitHub repo.
   The script text is never part of this public app: it is loaded from / saved to the data repo with
   the GitHub Contents API, using a fine-grained token that lives only in this browser's localStorage. */
'use strict';
const DATA_REPO = 'bradfuturez/scriptshare-data';
const FILE = 'script.json';
const API = 'https://api.github.com';
const K = { token: 'ss.token', draft: 'ss.draft' };
const FIELDS = ['time', 'character', 'shot', 'line', 'notes'];
const LABELS = { time: 'Time', character: 'Character', shot: 'Shot', line: 'Line', notes: 'Notes' };

const $ = s => document.querySelector(s);
let doc = null;        // { title, version, updatedAt, rows:[{id,time,character,shot,line,notes}] }
let baseSha = null;    // sha of script.json on GitHub when we loaded / last saved it
let dirty = false;
let saving = false;

/* ---------- small helpers ---------- */
const uid = () => 'r' + Math.random().toString(36).slice(2, 9);
const niceTime = d => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function b64enc(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
let toastTimer;
function toast(text, bad = false, ms = 3500) {
  const t = $('#toast'); t.textContent = text; t.classList.toggle('bad', bad); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function setStatus(text, kind = '') { const s = $('#saveStatus'); s.textContent = text || '\u00a0'; s.className = 'save-status ' + kind; }
function setBanner(text, warn = false) { const b = $('#statusBar'); b.textContent = text || ''; b.classList.toggle('warn', warn); }
function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  const rows = Array.isArray(d.rows) ? d.rows : [];
  return { ...d, title: String(d.title || 'Untitled script'), version: Number(d.version) || 0, updatedAt: d.updatedAt || null,
    rows: rows.map(r => { const o = { id: (r && r.id) || uid() }; FIELDS.forEach(f => o[f] = r && r[f] != null ? String(r[f]) : ''); return o; }) };
}

/* ---------- local draft (offline-safe) ---------- */
function persist() {
  try { localStorage.setItem(K.draft, JSON.stringify({ doc, baseSha, dirty, at: new Date().toISOString() })); }
  catch (e) { setBanner('Warning: this phone could not store a local copy (storage full?).', true); }
}
let persistTimer;
function markDirty() {
  dirty = true; setStatus('Unsaved changes · kept on this phone', 'dirty');
  clearTimeout(persistTimer); persistTimer = setTimeout(persist, 250);
}
function loadDraft() { try { return JSON.parse(localStorage.getItem(K.draft) || 'null'); } catch (_) { return null; } }

/* ---------- GitHub Contents API ---------- */
class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function gh(path, opts = {}) {
  const token = localStorage.getItem(K.token);
  let r;
  try {
    r = await fetch(API + path, { cache: 'no-store', ...opts, headers: {
      'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch (e) { throw new GhError(0, navigator.onLine ? "Couldn't reach GitHub." : "You're offline."); }
  let data = null; try { data = await r.json(); } catch (_) {}
  if (!r.ok) throw new GhError(r.status, (data && data.message) || ('HTTP ' + r.status));
  return data;
}
function explain(e) {
  if (!(e instanceof GhError)) return e.message || String(e);
  if (e.status === 0) return e.message;
  if (e.status === 401) return 'GitHub rejected the token (expired or wrong). Use Menu → Change token.';
  if (e.status === 403) return 'The token is not allowed to write. It needs Contents: Read and write on ' + DATA_REPO + '.';
  if (e.status === 404) return 'The token cannot see ' + DATA_REPO + '. Make sure that repo is selected for the token.';
  if (e.status === 409 || e.status === 422) return 'The script changed on GitHub while saving. Tap Save again.';
  return 'GitHub said: ' + e.message + ' (' + e.status + ')';
}
/** Returns { doc, sha } or { doc:null, sha:null } if the file doesn't exist yet. */
async function fetchRemote() {
  try {
    const d = await gh(`/repos/${DATA_REPO}/contents/${FILE}?ref=main`);
    return { doc: normalize(JSON.parse(b64dec(d.content))), sha: d.sha };
  } catch (e) {
    if (e.status === 404) { await gh(`/repos/${DATA_REPO}`); return { doc: null, sha: null }; } // repo visible, file missing
    throw e;
  }
}
async function putFile(path, obj, message, sha) {
  const body = { message, content: b64enc(JSON.stringify(obj, null, 2) + '\n'), branch: 'main' };
  if (sha) body.sha = sha;
  return gh(`/repos/${DATA_REPO}/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
}

/* ---------- rendering ---------- */
function grow(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }
function growAll() { document.querySelectorAll('.f textarea').forEach(grow); }
function rowEl(r, i) {
  const el = document.createElement('div'); el.className = 'row'; el.dataset.id = r.id;
  const num = document.createElement('span'); num.className = 'num'; num.textContent = i + 1; el.appendChild(num);
  for (const f of FIELDS) {
    const w = document.createElement('div'); w.className = 'f ' + f;
    const id = `${r.id}-${f}`;
    const lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = LABELS[f];
    const ta = document.createElement('textarea'); ta.id = id; ta.rows = 1; ta.value = r[f]; ta.dataset.field = f;
    ta.placeholder = f === 'line' ? 'Line…' : f === 'notes' ? 'Notes' : '—';
    if (f !== 'line' && f !== 'notes') ta.setAttribute('autocapitalize', f === 'character' ? 'characters' : 'off');
    w.append(lab, ta); el.appendChild(w);
  }
  const acts = document.createElement('div'); acts.className = 'acts';
  acts.innerHTML = '<button type="button" data-act="up" aria-label="Move row up" title="Move up">↑</button>' +
    '<button type="button" data-act="down" aria-label="Move row down" title="Move down">↓</button>' +
    '<button type="button" data-act="insert" aria-label="Insert row below" title="Insert row below">＋</button>' +
    '<button type="button" data-act="del" class="del" aria-label="Delete row" title="Delete row">🗑</button>';
  el.appendChild(acts);
  return el;
}
function render(focusId, focusSel) {
  $('#docTitle').textContent = doc.title + (doc.version ? ` · v${doc.version}` : '');
  const box = $('#rows'); box.textContent = '';
  doc.rows.forEach((r, i) => box.appendChild(rowEl(r, i)));
  requestAnimationFrame(growAll);
  if (focusId) {
    const el = box.querySelector(`[data-id="${focusId}"]`);
    if (el) { el.classList.add('flash'); const t = el.querySelector(focusSel || 'textarea'); if (t) t.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
}

$('#rows').addEventListener('input', e => {
  const ta = e.target; if (ta.tagName !== 'TEXTAREA') return;
  const row = doc.rows.find(r => r.id === ta.closest('.row').dataset.id); if (!row) return;
  row[ta.dataset.field] = ta.value; grow(ta); markDirty();
});
$('#rows').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.row').dataset.id, i = doc.rows.findIndex(r => r.id === id); if (i < 0) return;
  const act = b.dataset.act;
  if (act === 'up' && i > 0) { [doc.rows[i - 1], doc.rows[i]] = [doc.rows[i], doc.rows[i - 1]]; render(id, '[data-act="up"]'); }
  else if (act === 'down' && i < doc.rows.length - 1) { [doc.rows[i + 1], doc.rows[i]] = [doc.rows[i], doc.rows[i + 1]]; render(id, '[data-act="down"]'); }
  else if (act === 'insert') { const n = blankRow(); doc.rows.splice(i + 1, 0, n); render(n.id, 'textarea'); }
  else if (act === 'del') {
    const r = doc.rows[i], label = r.line ? `"${r.line.slice(0, 60)}"` : `row ${i + 1}`;
    if (!confirm(`Delete ${label}?`)) return;
    doc.rows.splice(i, 1); render();
  } else return;
  markDirty();
});
function blankRow() { const o = { id: uid() }; FIELDS.forEach(f => o[f] = ''); return o; }
$('#addRow').addEventListener('click', () => { const n = blankRow(); doc.rows.push(n); render(n.id, 'textarea'); markDirty(); });
function headerH() { document.documentElement.style.setProperty('--toph', $('.top').offsetHeight + 'px'); }
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { growAll(); headerH(); }, 150); });
headerH();

/* ---------- save ---------- */
function fileStamp(iso) { return iso.replace(/:/g, '-'); } // 2026-10-02T15-04-05.123Z (ISO time, colons swapped for dashes)
async function save() {
  if (saving || !doc) return;
  if (!navigator.onLine) { setStatus("You're offline. Edits are kept on this phone; tap Save when you're back online.", 'bad'); return; }
  saving = true; const btn = $('#saveBtn'); btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Saving…'; setStatus('Saving to GitHub…');
  persist();
  try {
    const remote = await fetchRemote();
    if (remote.sha && remote.sha !== baseSha) {
      const when = remote.doc && remote.doc.updatedAt ? ' (saved ' + niceTime(remote.doc.updatedAt) + ')' : '';
      if (!confirm('The script on GitHub changed since this phone loaded it' + when + '.\n\nReplace it with your version?')) {
        setStatus('Not saved. Use Menu → Reload from GitHub to get the newer version.', 'bad'); return;
      }
    }
    const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const out = { ...doc, version: Math.max(doc.version || 0, (remote.doc && remote.doc.version) || 0) + 1, updatedAt: iso };
    const msg = `ScriptShare save ${iso}`;
    const res = await putFile(FILE, out, msg, remote.sha);
    doc = out; baseSha = res.content.sha; dirty = false; persist();
    let histNote = '';
    // GitHub can briefly answer 409 right after a commit on the same branch, so retry the history copy.
    for (let a = 0; ; a++) {
      try { await putFile(`history/${fileStamp(iso)}.json`, out, msg); break; }
      catch (e) {
        if (a < 4 && (e.status === 409 || e.status === 422 || e.status >= 500 || e.status === 0)) { await new Promise(r => setTimeout(r, 800 * (a + 1))); continue; }
        histNote = ' (history copy failed: ' + explain(e) + ')'; break;
      }
    }
    $('#docTitle').textContent = doc.title + ` · v${doc.version}`;
    setStatus(`Saved ✓ ${niceTime(iso)} · v${doc.version}${histNote}`, histNote ? 'bad' : 'ok');
    setBanner('');
    toast('Saved ✓');
  } catch (e) {
    const m = explain(e);
    setStatus("Not saved: " + m + " Your edits are safe on this phone.", 'bad');
    toast("Save failed", true);
    if (e.status === 401) setTimeout(() => { if (confirm('Enter a new token now?')) { localStorage.removeItem(K.token); showSetup(); } }, 300);
  } finally {
    saving = false; btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'Save';
  }
}
$('#saveBtn').addEventListener('click', save);

/* ---------- load ---------- */
async function loadFromGitHub({ force = false } = {}) {
  setBanner('Loading from GitHub…');
  try {
    const remote = await fetchRemote();
    if (dirty && !force) {
      setBanner(remote.sha !== baseSha ? 'Your unsaved edits are restored. Note: the script on GitHub has changed since; Save will ask before replacing it.' : 'Your unsaved edits from this phone are restored. Tap Save to send them.', remote.sha !== baseSha);
      return;
    }
    doc = remote.doc || normalize({ title: 'New script', rows: [blankRow()] });
    baseSha = remote.sha; dirty = false; persist(); render();
    setBanner(remote.doc ? (doc.updatedAt ? 'Last saved ' + niceTime(doc.updatedAt) : '') : 'No script.json in the repo yet. Saving will create it.');
    setStatus('');
  } catch (e) {
    if (e.status === 401 || (e.status === 404 && !doc)) {
      if (!doc) { localStorage.removeItem(K.token); showSetup(explain(e)); return; }
    }
    setBanner((doc ? 'Showing the copy saved on this phone. ' : '') + explain(e), true);
  }
}
function showEditor() {
  $('#setup').hidden = true; $('#editor').hidden = false; $('#saveBar').hidden = false; $('#menuBtn').hidden = false;
  const d = loadDraft();
  if (d && d.doc) {
    doc = normalize(d.doc); baseSha = d.baseSha || null; dirty = !!d.dirty; render();
    if (dirty) setStatus('Unsaved changes · kept on this phone', 'dirty');
  }
  loadFromGitHub();
}
function showSetup(msg) {
  $('#editor').hidden = true; $('#saveBar').hidden = true; $('#menuBtn').hidden = true; $('#setup').hidden = false;
  $('#docTitle').textContent = 'Trailer script editor';
  const m = $('#setupMsg'); m.textContent = msg || ''; m.className = 'msg' + (msg ? ' bad' : '');
}
$('#repoName1').textContent = DATA_REPO; $('#repoName2').textContent = DATA_REPO;
$('#tokenForm').addEventListener('submit', async e => {
  e.preventDefault();
  const v = $('#tokenInput').value.trim(), m = $('#setupMsg');
  if (!v) { $('#tokenInput').focus(); return; }
  localStorage.setItem(K.token, v); m.className = 'msg'; m.textContent = 'Checking with GitHub…';
  try {
    await gh(`/repos/${DATA_REPO}`);
    $('#tokenInput').value = ''; m.textContent = ''; toast('Connected ✓'); showEditor();
  } catch (err) {
    localStorage.removeItem(K.token); m.className = 'msg bad';
    m.textContent = err.status === 401 ? "GitHub didn't accept that token. Check you copied all of it (it starts with github_pat_)." : explain(err);
  }
});

/* ---------- menu ---------- */
const sheet = $('#sheet');
$('#menuBtn').addEventListener('click', () => { sheet.hidden = false; });
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.hidden = true; });
$('#mClose').addEventListener('click', () => { sheet.hidden = true; });
$('#mReload').addEventListener('click', () => {
  sheet.hidden = true;
  if (dirty && !confirm('Discard your unsaved changes on this phone and reload from GitHub?')) return;
  dirty = false; loadFromGitHub({ force: true });
});
$('#mToken').addEventListener('click', () => {
  sheet.hidden = true;
  if (!confirm('Forget the GitHub token on this phone? (Your unsaved edits stay here.)')) return;
  localStorage.removeItem(K.token); showSetup();
});
$('#mHelp').addEventListener('click', () => {
  sheet.hidden = true;
  alert('Edit any cell, use ↑ ↓ to reorder, ＋ to add a row below, 🗑 to delete.\n\n' +
    'Every edit is kept on this phone right away, even offline.\n\n' +
    'Save sends the script to ' + DATA_REPO + ' (script.json) and also keeps a dated copy in history/.');
});
addEventListener('online', () => { if (dirty) setStatus('Back online · tap Save to send your changes', 'dirty'); });

/* ---------- start ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (localStorage.getItem(K.token)) showEditor(); else showSetup();
