/* Offline DOM and stylesheet checks. No real login, messages or database writes. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const resolveDependency = (name) => require(process.env.ZENIT_QA_MODULES ? path.join(process.env.ZENIT_QA_MODULES, name) : name);
const { JSDOM } = resolveDependency('jsdom');
const postcss = resolveDependency('postcss');
const project = path.resolve(__dirname, '..');
const root = fs.existsSync(path.join(project, 'dist', 'index.html')) ? path.join(project, 'dist') : project;
const css = postcss.parse(fs.readFileSync(path.join(root, 'styles.css'), 'utf8'));
const pages = ['index', 'history', 'training', 'team', 'match', 'contacts'];
const widths = [320, 360, 375, 390, 430, 480, 600, 768, 820, 1024, 1366, 1920];
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(page, blockedStorage = false) {
  const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
  const dom = new JSDOM(html, { url: `https://zenit-alanya.vercel.app/${page}.html`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.structuredClone = structuredClone;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.document.addEventListener('click', (event) => { if (event.target.closest('a')) event.preventDefault(); });
  if (blockedStorage) {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(w, key, { get() { throw new w.DOMException('Storage unavailable', 'SecurityError'); } });
  }
  return dom;
}

function effectiveStyle(element, property, width) {
  let winner = null;
  let order = 0;
  css.walkRules((rule) => {
    let allowed = true;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'media') {
        if (!/width/.test(parent.params)) allowed = false;
        for (const [, kind, value] of parent.params.matchAll(/(max|min)-width:\s*(\d+)px/g)) {
          if (kind === 'max' && width > Number(value) || kind === 'min' && width < Number(value)) allowed = false;
        }
      }
      if (parent.type === 'atrule' && /keyframes/.test(parent.name)) allowed = false;
    }
    order++;
    if (!allowed) return;
    const matches = rule.selectors.filter((selector) => { try { return element.matches(selector); } catch (_) { return false; } });
    for (const selector of matches) {
      const ids = (selector.match(/#[\w-]+/g) || []).length;
      const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
      const tags = (selector.match(/(?:^|\s|>)(?:[a-z][\w-]*)/gi) || []).length;
      const specificity = ids * 10000 + classes * 100 + tags;
      rule.nodes.filter((node) => node.type === 'decl' && node.prop === property).forEach((decl) => {
        const score = (decl.important ? 1e8 : 0) + specificity;
        if (!winner || score > winner.score || score === winner.score && order >= winner.order) winner = { score, order, value: decl.value };
      });
    }
  });
  return winner?.value;
}

async function testCommon(page, blockedStorage) {
  const dom = setup(page, blockedStorage);
  const w = dom.window, d = w.document;
  w.eval(fs.readFileSync(path.join(root, 'script.js'), 'utf8'));
  d.querySelector('[data-lang="tr"]').click();
  check(d.documentElement.lang === 'tr', `${page}: Turkish switch`);
  d.querySelector('[data-lang="ru"]').click();
  check(d.documentElement.lang === 'ru', `${page}: Russian switch`);
  const menu = d.querySelector('.menu-toggle');
  menu.click();
  check(d.querySelector('.main-nav').classList.contains('open'), `${page}: open menu`);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!d.querySelector('.main-nav').classList.contains('open'), `${page}: Escape closes menu`);
  menu.click();
  d.querySelector('main').click();
  check(menu.getAttribute('aria-expanded') === 'false', `${page}: outside click closes menu`);
  const ids = [...d.querySelectorAll('[id]')].map((el) => el.id);
  check(ids.length === new Set(ids).size, `${page}: unique IDs`);
  for (const element of d.querySelectorAll('[href], [src]')) {
    const value = element.getAttribute('href') || element.getAttribute('src');
    if (!value || /^(?:https?:|mailto:|tel:|data:|#)/.test(value)) continue;
    const local = value.split(/[?#]/)[0];
    check(fs.existsSync(path.join(root, local)), `${page}: local asset ${local}`);
  }
  if (page === 'index') {
    for (const width of widths) {
      for (const chip of d.querySelectorAll('.hero-chip')) {
        check(effectiveStyle(chip, 'position', width) === 'static', `hero card normal flow at ${width}`);
        check(effectiveStyle(chip, 'width', width) === '100%', `hero card width at ${width}`);
      }
      check(effectiveStyle(d.querySelector('.logo-stage'), 'min-height', width) === '0', `no fixed hero stage height at ${width}`);
      check(effectiveStyle(d.querySelector('.large-emblem'), 'height', width) === 'auto', `logo ratio at ${width}`);
    }
  }
  if (page === 'training') {
    for (const tab of d.querySelectorAll('.schedule-tab')) {
      tab.click();
      check(d.querySelectorAll('.schedule-panel.active').length === 1, 'one schedule panel');
      check(d.querySelector('.schedule-panel.active').dataset.group === tab.dataset.group, 'schedule follows selected age group');
    }
    const questions = [...d.querySelectorAll('.faq-question')];
    let answerHeight = 90;
    const answer = questions[0].closest('.faq-item').querySelector('.faq-answer');
    Object.defineProperty(answer, 'scrollHeight', { get: () => answerHeight });
    questions[0].click();
    check(answer.style.maxHeight === '90px', 'FAQ expands');
    answerHeight = 145;
    w.dispatchEvent(new w.Event('resize'));
    check(answer.style.maxHeight === '145px', 'FAQ responds to orientation/resize');
    answerHeight = 170;
    d.querySelector('[data-lang="tr"]').click();
    check(answer.style.maxHeight === '170px', 'FAQ responds to language');
    questions[1].click();
    check(!questions[0].closest('.faq-item').classList.contains('open'), 'FAQ accordion closes previous answer');
  }
  if (page === 'contacts') {
    let opened = '';
    w.open = (url) => { opened = url; return null; };
    for (const [id, value] of [['name','Test child'],['age','10'],['group','9–12'],['phone','+900000000000'],['note','Offline QA only']]) d.getElementById(id).value = value;
    d.getElementById('signup-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    check(opened.startsWith('https://wa.me/905388899272?text='), 'contact action builds WhatsApp URL without sending');
    check(decodeURIComponent(opened).includes('Test child'), 'contact form includes values');
    check(d.querySelector('.social-link.is-disabled').getAttribute('aria-disabled') === 'true', 'unconfirmed Telegram stays disabled');
    for (const width of widths) check(effectiveStyle(d.querySelector('.map-pin'), 'position', width) === 'relative', `map pin normal flow at ${width}`);
  }
  dom.window.close();
}

async function testMatch(blockedStorage) {
  const dom = setup('match', blockedStorage), w = dom.window, d = w.document;
  const writes = [];
  w.fetch = async (url, options = {}) => {
    if (!options.body) return { ok: true, status: 200, json: async () => [] };
    const body = JSON.parse(options.body);
    writes.push(body);
    return { ok: true, status: 200, json: async () => body.action === 'login' ? { token: 'offline-mock-token', expiresIn: 7200 } : { ok: true } };
  };
  for (const file of ['script.js','match-config.js','match.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await tick();
  check(d.querySelectorAll('.pitch-player').length === 11, 'eleven field players render');
  check([...d.querySelectorAll('.pitch-player')].every((p) => p.style.left.startsWith('clamp(')), 'player positions constrained to visible pitch');
  for (const width of widths) check(effectiveStyle(d.getElementById('football-pitch'), 'touch-action', width) === 'pan-y', `public pitch scrolls at ${width}`);
  d.getElementById('admin-open').click();
  check(!d.getElementById('admin-section').hidden, 'admin login opens');
  d.getElementById('admin-password').value = 'test-only-mock';
  d.getElementById('admin-login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick();
  check(!d.getElementById('admin-panel').hidden, 'mock login opens admin panel');
  check(d.getElementById('football-pitch').classList.contains('is-editing'), 'admin pitch drag mode');
  const formation = d.getElementById('formation-select');
  check(formation.options.length === 7, 'seven formations');
  for (const option of formation.options) {
    formation.value = option.value;
    formation.dispatchEvent(new w.Event('change', { bubbles: true }));
    check(d.getElementById('formation-title').textContent.includes(option.value), 'formation updates heading');
    check(d.querySelectorAll('.pitch-player').length === 11, 'formation retains eleven players');
  }
  d.getElementById('player-number').value = 22;
  d.getElementById('player-name').value = '<b>Offline test</b>';
  d.getElementById('player-role').value = 'bench';
  d.getElementById('add-player-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  check(d.querySelectorAll('.bench-player').length === 1, 'bench player added');
  check(!d.getElementById('bench-list').querySelector('b'), 'player names cannot inject markup');
  d.querySelector('[data-stat="goals"][data-delta="1"]').click();
  check(d.getElementById('events-list').textContent.includes('Гол'), 'goal counter updates events');
  for (const width of widths) check(effectiveStyle(d.querySelector('.event-symbol.goal'), 'position', width) !== 'absolute', `goal marker normal flow at ${width}`);
  d.getElementById('edit-home-score').value = 12;
  d.getElementById('edit-home-score').dispatchEvent(new w.Event('input', { bubbles: true }));
  check(d.getElementById('home-score').textContent === '12', 'score updates preview');
  d.getElementById('save-match').click();
  await tick(); await tick();
  check(writes.at(-1).action === 'save', 'save uses protected backend');
  check(writes.at(-1).data.players.length === 12, 'save includes field and bench');
  d.getElementById('admin-logout').click();
  check(!d.getElementById('football-pitch').classList.contains('is-editing'), 'logout restores public scrolling');
  dom.window.close();
}

(async () => {
  for (const blocked of [false,true]) {
    for (const page of pages) await testCommon(page, blocked);
    await testMatch(blocked);
  }
  for (const file of ['script.js','match.js','match-config.js','styles.css',...pages.map((p) => `${p}.html`)]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    check(!/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|service_role/.test(text), `${file}: no server keys`);
    check(!/head-coach-andrey/.test(text), `${file}: no private coach image`);
  }
  console.log(`PASS: ${assertions} offline checks; ${pages.length} pages; ${widths.length} CSS breakpoints; RU/TR; normal and blocked storage.`);
  console.log('DOM checks use mocked API responses. They do not certify live server authentication or physical iOS/Android rendering.');
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
