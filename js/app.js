import { api, DEMO } from './api.js';
import { APP_NAME, PROGRAM_NAME } from './config.js';
import { loadReference, store } from './store.js';
import { $, $$, busy, esc, toast } from './ui.js';
import { viewCertificate, viewChallenge, viewLeaderboard, viewProgress, viewRules, viewToday } from './views-student.js';
import { viewAdminCalendar, viewAdminChallenges, viewAdminOverview, viewAdminReview, viewAdminSetup, viewAdminStudent, viewAdminStudents } from './views-admin.js';

const app = document.getElementById('app');
let recovering = false;

const STUDENT_NAV = [
  ['today', 'Today', '✓'],
  ['rules', 'My rules', '§'],
  ['progress', 'Progress', '▦'],
  ['challenge', 'Challenge', '🏆'],
  ['leaderboard', 'Ranks', '★'],
];
const ADMIN_NAV = [
  ['admin', 'Overview', '◎'],
  ['admin/review', 'Review', '⚑'],
  ['admin/students', 'Students', '☰'],
  ['admin/calendar', 'Calendar', '▦'],
  ['admin/challenges', 'Challenges', '🏆'],
  ['leaderboard', 'Ranks', '★'],
  ['admin/setup', 'Setup', '⚙'],
];

const ROUTES = {
  today: viewToday,
  rules: viewRules,
  progress: viewProgress,
  challenge: viewChallenge,
  leaderboard: viewLeaderboard,
  certificate: viewCertificate,
  account: viewAccount,
  admin: viewAdminOverview,
  'admin/review': viewAdminReview,
  'admin/students': viewAdminStudents,
  'admin/student': viewAdminStudent,
  'admin/calendar': viewAdminCalendar,
  'admin/challenges': viewAdminChallenges,
  'admin/setup': viewAdminSetup,
};

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  for (let n = parts.length; n > 0; n--) {
    const key = parts.slice(0, n).join('/');
    if (ROUTES[key]) return { key, params: parts.slice(n) };
  }
  return { key: null, params: [] };
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function shell() {
  const isAdmin = store.me.role === 'admin';
  const nav = isAdmin ? ADMIN_NAV : STUDENT_NAV;
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/${isAdmin ? 'admin' : 'today'}"><span class="logo">W</span><span><b>${esc(APP_NAME)}</b><small>Accountability</small></span></a>
      <nav class="topnav">${nav.map(([k, label]) => `<a href="#/${k}" data-nav="${k}">${label}</a>`).join('')}</nav>
      <a class="avatar" href="#/account" title="My account">${esc(store.me.full_name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</a>
    </header>
    ${DEMO ? '<div class="demo-bar">Demo mode · data stays in this browser · <a href="#" data-signout>switch user</a></div>' : ''}
    <main id="view"></main>
    <nav class="bottomnav ${isAdmin ? 'admin' : ''}">${nav.map(([k, label, icon]) => `<a href="#/${k}" data-nav="${k}"><span>${icon}</span>${label}</a>`).join('')}</nav>`;
  $('[data-signout]', app)?.addEventListener('click', (e) => { e.preventDefault(); api.signOut(); });
}

async function route() {
  if (!store.me) return;
  if (!$('#view')) shell();
  let { key, params } = parseHash();
  const isAdmin = store.me.role === 'admin';
  if (!key || (key.startsWith('admin') && !isAdmin) || (isAdmin && ['today', 'rules', 'progress', 'challenge'].includes(key))) {
    location.replace(`#/${isAdmin ? 'admin' : 'today'}`);
    return;
  }
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === key || (key === 'admin/student' && a.dataset.nav === 'admin/students')));
  const old = $('#view');
  const view = document.createElement('main');
  view.id = 'view';
  old.replaceWith(view);
  window.scrollTo(0, 0);
  try {
    await ROUTES[key](view, params);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h3>Something went wrong</h3><p class="muted">${esc(e.message)}</p><button class="btn ghost" onclick="location.reload()">Reload</button></div>`;
  }
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

function viewAccount(root) {
  root.innerHTML = `
    <section class="hero"><div class="eyebrow">My account</div><h1>${esc(store.me.full_name)}</h1><p class="muted">${esc(store.me.email)}</p></section>
    <div class="card">
      <h3>Change password</h3>
      <form class="form" data-pw>
        <label>New password<input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
        <div class="row-end"><button class="btn primary">Update password</button></div>
      </form>
    </div>
    <div class="card"><button class="btn ghost danger" data-out>Sign out</button></div>`;
  $('[data-pw]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, () => api.updatePassword(new FormData(e.target).get('pw')));
    e.target.reset();
    toast('Password updated');
  });
  $('[data-out]', root).onclick = () => api.signOut();
}

// ---------------------------------------------------------------------------
// Sign in / activate / reset
// ---------------------------------------------------------------------------

function authScreen(tab = 'signin', notice = '') {
  const demoUsers = DEMO ? api.demoUsers() : [];
  app.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <div class="brand big"><span class="logo">W</span><span><b>${esc(APP_NAME)}</b><small>${esc(PROGRAM_NAME)}</small></span></div>
        <p class="auth-tag">Control the input, not the outcome.</p>
        ${recovering ? `
          <h2>Set a new password</h2>
          <form class="form" data-recover>
            <label>New password<input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
            <button class="btn primary block">Save password</button>
          </form>` : `
        <div class="seg full">
          <button class="${tab === 'signin' ? 'on' : ''}" data-tab="signin">Sign in</button>
          <button class="${tab === 'activate' ? 'on' : ''}" data-tab="activate">First time? Activate</button>
        </div>
        ${notice ? `<div class="notice">${notice}</div>` : ''}
        ${tab === 'signin' ? `
          <form class="form" data-signin>
            <label>Email<input class="input" type="email" name="email" required autocomplete="email"></label>
            <label>Password<input class="input" type="password" name="pw" required autocomplete="current-password"></label>
            <button class="btn primary block">Sign in</button>
            <button type="button" class="link" data-tab="reset">Forgot password?</button>
          </form>` : tab === 'activate' ? `
          <p class="muted small">Use the email you gave your coach when you joined. If it's not on the roster yet, ask your coach to add you.</p>
          <form class="form" data-activate>
            <label>Email<input class="input" type="email" name="email" required autocomplete="email"></label>
            <label>Create a password<input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
            <button class="btn primary block">Activate my account</button>
          </form>` : `
          <p class="muted small">We'll email you a link to set a new password.</p>
          <form class="form" data-reset>
            <label>Email<input class="input" type="email" name="email" required autocomplete="email"></label>
            <button class="btn primary block">Send reset link</button>
            <button type="button" class="link" data-tab="signin">Back to sign in</button>
          </form>`}
        ${DEMO ? `
          <div class="demo-users">
            <div class="eyebrow">Demo mode: tap anyone to sign in</div>
            ${demoUsers.map((u) => `<button class="demo-user" data-demo="${esc(u.email)}"><b>${esc(u.full_name)}</b><span>${u.role === 'admin' ? 'Admin' : esc(store.batches.find((b) => b.id === u.batch_id)?.name ?? '')}</span></button>`).join('')}
          </div>` : ''}`}
      </div>
    </div>`;

  app.onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) return authScreen(t.dataset.tab);
    const d = e.target.closest('[data-demo]');
    if (d) await api.signIn(d.dataset.demo, 'demo');
  };
  $('[data-signin]', app)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await busy(e.submitter, () => api.signIn(f.get('email').trim(), f.get('pw')));
  });
  $('[data-activate]', app)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await busy(e.submitter, () => api.activate(f.get('email').trim(), f.get('pw')));
    if (res.needsConfirm) authScreen('signin', 'Almost there. Check your inbox for a confirmation link, then sign in.');
  });
  $('[data-reset]', app)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, () => api.sendReset(new FormData(e.target).get('email').trim()));
    authScreen('signin', 'If that email has an account, a reset link is on its way.');
  });
  $('[data-recover]', app)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, () => api.updatePassword(new FormData(e.target).get('pw')));
    recovering = false;
    toast('Password saved');
    start();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let booting = false;

async function start() {
  booting = true;
  try {
    await boot();
  } finally {
    booting = false;
  }
}

async function boot() {
  app.onclick = null;
  const session = await api.getSession();
  if (!session || recovering) {
    store.me = null;
    if (DEMO) store.batches = await api.listBatches();
    return authScreen();
  }
  app.innerHTML = '<div class="loading full">Loading…</div>';
  try {
    store.me = await api.me();
  } catch (e) {
    store.me = null;
  }
  if (!store.me || store.me.status !== 'active') {
    store.me = null;
    app.innerHTML = `<div class="auth"><div class="auth-card"><h2>Account not active</h2>
      <p class="muted">This login isn't linked to an active student. Ask your coach to check the roster.</p>
      <button class="btn ghost block" data-out>Sign out</button></div></div>`;
    $('[data-out]', app).onclick = () => api.signOut();
    return;
  }
  await loadReference();
  shell();
  route();
}

api.onAuthChange((event) => {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; return start(); }
  if (event === 'SIGNED_IN' && (store.me || booting)) return;
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') start();
});
window.addEventListener('hashchange', route);
start();
