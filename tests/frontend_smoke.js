// Frontend smoke test: runs public/app.js in jsdom against a fake WebSocket. Needs: npm i jsdom
const { JSDOM } = require('jsdom');
const fs = require('fs');
const root = require('path').join(__dirname, '..', 'public') + '/';
const html = fs.readFileSync(root + 'index.html', 'utf8').replace('<script src="/app.js"></script>', '');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
const sent = [];
let sock;
w.WebSocket = class { constructor() { sock = this; this.readyState = 1; setTimeout(() => this.onopen && this.onopen(), 0); }
  send(s) { sent.push(JSON.parse(s)); } close() {} };
w.WebSocket.OPEN = 1;
w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ user: 'alice' }) });
w.eval(fs.readFileSync(root + 'app.js', 'utf8'));
const push = (o) => sock.onmessage({ data: JSON.stringify(o) });
const $ = (id) => w.document.getElementById(id);
let fails = 0; const ok = (n, c) => { if (!c) { fails++; console.log('FAIL', n); } else console.log('ok  ', n); };
const T = Date.now();

(async () => {
  await new Promise((r) => setTimeout(r, 20));           // boot: /api/me -> startChat -> connect
  push({ type: 'hello', user: 'alice' });
  push({ type: 'users', users: [{ name: 'alice', online: true, last_seen: 0 }, { name: 'bob', online: false, last_seen: T - 3600e3 }, { name: 'carol', online: true, last_seen: 0 }] });
  push({ type: 'convs', convs: [
    { with: '', last_id: '0', last_from: '', last_text: '', last_status: '', last_ts: 0, unread: 0 },
    { with: 'bob', last_id: '7', last_from: 'bob', last_text: 'lunch?', last_status: '', last_ts: T - 60e3, unread: 2 } ] });
  push({ type: 'history', with: '', before: '', more: false, messages: [] });

  ok('chat list shows group + bob, carol under "New chat"',
     $('chat-list').children.length === 2 && $('user-list').textContent.includes('carol') && !$('user-list').textContent.includes('bob'));
  ok('bob row shows preview + unread badge 2', $('chat-list').textContent.includes('lunch?') && $('chat-list').querySelector('.badge').textContent === '2');
  ok('bob (most recent) sorted above empty group', $('chat-list').children[0].textContent.includes('bob'));

  // open bob: history with 3 messages, 2 unread -> divider before the first unread
  $('chat-list').children[0].querySelector('button').click();
  ok('openConv requests history', sent.some((m) => m.type === 'history' && m.with === 'bob'));
  ok('header shows last seen', $('conv-sub').textContent.startsWith('last seen'));
  push({ type: 'history', with: 'bob', before: '', more: true, messages: [
    { id: '5', from: 'alice', to: 'bob', text: 'hey', ts: T - 300e3, status: 'delivered' },
    { id: '6', from: 'bob', to: 'alice', text: 'hi', ts: T - 120e3 },
    { id: '7', from: 'bob', to: 'alice', text: 'lunch?', ts: T - 60e3 } ] });
  ok('unread divider placed before 2nd incoming-from-end (id 6)',
     $('messages').textContent.indexOf('Unread messages') < $('messages').textContent.indexOf('hi') &&
     $('messages').textContent.indexOf('Unread messages') > $('messages').textContent.indexOf('hey'));
  ok('own message shows double grey tick', $('messages').querySelector('.tick.delivered') !== null);
  ok('"Load older messages" button shown when more=true', $('messages').querySelector('button.older') !== null);
  ok('sent read receipt for newest incoming (7)', sent.some((m) => m.type === 'read' && m.with === 'bob' && m.upto === '7'));
  ok('unread badge cleared locally', !$('chat-list').querySelector('.badge'));

  // send + receipts: sent -> delivered -> read
  push({ type: 'msg', id: '8', from: 'alice', to: 'bob', text: 'yes!', ts: T });
  ok('new own msg shows single tick', $('messages').querySelector('.tick.sent') !== null);
  push({ type: 'receipt', with: 'bob', status: 'delivered', upto: '8' });
  ok('delivered receipt -> no sent ticks left', $('messages').querySelector('.tick.sent') === null);
  push({ type: 'receipt', with: 'bob', status: 'read', upto: '8' });
  ok('read receipt covers earlier msgs too -> 2 blue ticks', $('messages').querySelectorAll('.tick.read').length === 2);
  ok('chat-list preview tick upgraded too', $('chat-list').querySelector('.preview .tick.read') !== null);

  // pagination prepend, dedupe
  const oldTop = $('messages').querySelector('button.older');
  oldTop.click();
  ok('"older" requests before=<first id>', sent.some((m) => m.type === 'history' && m.before === '5'));
  push({ type: 'history', with: 'bob', before: '5', more: false, messages: [{ id: '3', from: 'bob', to: 'alice', text: 'ancient', ts: T - 86400e3 * 2 }] });
  ok('older page prepended, button gone, day separator added',
     $('messages').textContent.indexOf('ancient') < $('messages').textContent.indexOf('hey') && !$('messages').querySelector('button.older') && $('messages').querySelectorAll('.daysep').length >= 2);

  // incoming message in a background chat bumps unread + reorders; unread frame syncs from another tab
  push({ type: 'msg', id: '9', from: 'carol', to: 'alice', text: 'ping', ts: T + 1000 });
  ok('background msg adds carol to chat list with badge 1', $('chat-list').textContent.includes('ping') && $('chat-list').querySelector('.badge').textContent === '1');
  ok('carol no longer in "New chat"', !$('user-list').textContent.includes('carol'));
  push({ type: 'unread', with: 'carol', count: 0 });
  ok('unread frame clears badge', !$('chat-list').querySelector('.badge'));

  // XSS: message text only via textContent
  push({ type: 'msg', id: '10', from: 'bob', to: 'alice', text: '<img src=x onerror=alert(1)>', ts: T + 2000 });
  ok('HTML in message stays text', $('messages').querySelector('img') === null && $('messages').textContent.includes('<img src=x'));

  // ---- new features
  push({ type: 'msg', id: '11', from: 'carol', to: 'alice', text: 'hello again', ts: T + 3000 });
  ok('title badge counts unread', w.document.title.startsWith('(1)'));
  push({ type: 'unread', with: 'carol', count: 0 });
  ok('title badge clears', !w.document.title.startsWith('('));

  // click a message -> a menu with only the actions that apply to it
  const labels = () => [...$('msg-menu').querySelectorAll('.item')].map((x) => x.lastElementChild.textContent);
  const find = (id) => [...$('messages').children].find((e) => e.dataset && e.dataset.id === id);
  let bubble = find('6');
  ok('menu hidden until a message is clicked', $('msg-menu').hidden);
  ok('messages are keyboard-focusable buttons that announce a menu', bubble.tabIndex === 0 && bubble.getAttribute('aria-haspopup') === 'menu' && bubble.getAttribute('aria-expanded') === 'false');
  ok('no always-on action buttons inside bubbles', $('messages').querySelector('.actions') === null);
  bubble.click();
  ok('click opens the menu and marks the bubble', !$('msg-menu').hidden && $('msg-menu').getAttribute('role') === 'menu' && bubble.getAttribute('aria-expanded') === 'true' && bubble.classList.contains('menu-open'));
  ok("someone else's message: Reply + Copy only, no Delete", JSON.stringify(labels()) === JSON.stringify(['Reply', 'Copy text']));
  ok('first menu item takes focus', w.document.activeElement === $('msg-menu').firstElementChild);
  bubble.click();
  ok('clicking the same bubble again closes the menu', $('msg-menu').hidden && bubble.getAttribute('aria-expanded') === 'false');
  bubble.click();
  w.document.body.click();
  ok('clicking elsewhere closes the menu', $('msg-menu').hidden);
  bubble.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Escape closes the menu and returns focus to the message', $('msg-menu').hidden && w.document.activeElement === bubble);
  bubble.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok('Enter on a focused message opens the menu', !$('msg-menu').hidden);
  $('msg-menu').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  ok('ArrowDown moves to the next item', w.document.activeElement === $('msg-menu').children[1]);
  $('msg-menu').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  ok('arrow keys wrap around', w.document.activeElement === $('msg-menu').children[0]);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));

  // reply from the menu: bar shown, outgoing msg carries reply id
  bubble.click();
  [...$('msg-menu').querySelectorAll('.item')][0].click();
  ok('choosing Reply closes the menu', $('msg-menu').hidden);
  ok('reply bar shown', !$('reply-bar').hidden && $('reply-text').textContent === 'hi');
  $('msg-input').value = 'answer';
  $('msg-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  ok('outgoing msg includes reply id', sent.some((m) => m.type === 'msg' && m.text === 'answer' && m.reply === '6'));
  ok('reply bar cleared after send', $('reply-bar').hidden);
  push({ type: 'msg', id: '12', from: 'alice', to: 'bob', text: 'answer', ts: T + 4000, reply: { id: '6', from: 'bob', text: 'hi', deleted: false } });
  ok('quote rendered inside bubble', $('messages').querySelector('.quote .qtext').textContent === 'hi' && $('messages').querySelector('.quote .qwho').textContent === 'bob');
  ok('newest message gets the entrance animation, older ones do not', $('messages').querySelectorAll('.msg.enter').length === 1 && find('12').classList.contains('enter'));
  push({ type: 'receipt', with: 'bob', status: 'read', upto: '12' });
  ok('a re-render for a receipt does not replay the animation', $('messages').querySelector('.msg.enter') === null);

  // the quote jumps to the original and must not open the menu
  find('12').querySelector('.quote').click();
  ok('clicking a quote does not open the menu', $('msg-menu').hidden);

  // copy
  let copied = null;
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: (x) => { copied = x; return Promise.resolve(); } } });
  bubble = find('6'); bubble.click();
  [...$('msg-menu').querySelectorAll('.item')][1].click();
  await new Promise((r) => setTimeout(r, 0));
  ok('Copy text writes the message to the clipboard and confirms', copied === 'hi' && $('toast').textContent === 'Copied' && $('toast').classList.contains('ok'));

  // delete: only my own messages offer it; confirm required; frame removes text everywhere
  const mine = find('12');
  mine.click();
  ok('own message: Reply + Copy + Delete for everyone', JSON.stringify(labels()) === JSON.stringify(['Reply', 'Copy text', 'Delete for everyone']));
  ok('delete item is styled as destructive', $('msg-menu').lastElementChild.classList.contains('destructive'));
  w.confirm = () => false;
  $('msg-menu').lastElementChild.click();
  ok('declining the confirmation sends nothing', !sent.some((m) => m.type === 'delete'));
  mine.click();
  w.confirm = () => true;
  $('msg-menu').lastElementChild.click();
  ok('delete frame sent', sent.some((m) => m.type === 'delete' && m.id === '12'));
  push({ type: 'deleted', id: '12', from: 'alice', to: 'bob' });
  const after = find('12');
  ok('deleted bubble shows tombstone, no text, not clickable', after.textContent.includes('This message was deleted') && !after.textContent.includes('answer') &&
     !after.classList.contains('actionable') && !after.hasAttribute('tabindex'));
  after.click();
  ok('clicking a deleted message opens no menu', $('msg-menu').hidden);
  ok('chat-list preview shows deleted', $('chat-list').textContent.includes('This message was deleted'));

  // a message arriving while the menu is open must not kill it: it re-attaches to the rebuilt bubble
  const before6 = find('6'); before6.click();
  push({ type: 'msg', id: '13', from: 'bob', to: 'alice', text: 'still there?', ts: T + 5000 });
  const after6 = find('6');
  ok('menu survives an incoming message and follows the rebuilt bubble', !$('msg-menu').hidden && after6 !== before6 && after6.classList.contains('menu-open') && after6.getAttribute('aria-expanded') === 'true');
  push({ type: 'deleted', id: '6', from: 'bob', to: 'alice' });
  ok('menu closes when its message is deleted', $('msg-menu').hidden);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));

  // offline queue: disconnect, type, reconnect -> flushed in order
  sock.readyState = 3;
  $('msg-input').value = 'queued one';
  $('msg-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  ok('offline message shown dimmed as pending', $('messages').querySelector('.msg.pending') !== null && $('msg-input').value === '');
  ok('a pending bubble is not clickable (nothing to reply to / delete yet)', !$('messages').querySelector('.msg.pending').classList.contains('actionable'));
  const n0 = sent.length;
  sock.readyState = 1; sock.onopen();
  ok('pending message sent on reconnect', sent.slice(n0).some((m) => m.type === 'msg' && m.text === 'queued one' && m.to === 'bob'));
  ok('pending bubble gone after flush', $('messages').querySelector('.msg.pending') === null);

  // emoji picker + settings
  ok('emoji picker populated', $('emoji-pop').children.length >= 16);
  $('emoji-btn').click();
  ok('emoji picker opens', !$('emoji-pop').hidden);
  $('msg-input').value = 'x';
  $('emoji-pop').children[0].click();
  ok('emoji inserted into input', $('msg-input').value.length > 1 && $('msg-input').value.startsWith('x'));
  $('settings-btn').click();
  ok('settings dialog opens', !$('settings').hidden);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Escape closes settings', $('settings').hidden);

  // theme: System (default) / Light / Dark, remembered
  const root = w.document.documentElement;
  ok('theme defaults to following the system', !root.hasAttribute('data-theme'));
  $('settings-btn').click();
  ok('settings shows the current theme choice', w.document.querySelector('input[name=theme][value=system]').checked);
  const pick = (v) => { const r = w.document.querySelector(`input[name=theme][value=${v}]`); r.checked = true; r.dispatchEvent(new w.Event('change', { bubbles: true })); };
  pick('light');
  ok('Light sets data-theme and is remembered', root.getAttribute('data-theme') === 'light' && w.localStorage.getItem('chat-theme') === 'light');
  pick('dark');
  ok('Dark sets data-theme and is remembered', root.getAttribute('data-theme') === 'dark' && w.localStorage.getItem('chat-theme') === 'dark');
  pick('system');
  ok('System clears the override', !root.hasAttribute('data-theme') && w.localStorage.getItem('chat-theme') === null);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  console.log(fails ? `\n${fails} FAILED` : '\nfrontend smoke: all passed');
  process.exit(fails ? 1 : 0);
})();
