/**
 * Telegram bot messages (free). The bot token is kept in Script Properties.
 * Owner chats: Script Property OWNER_CHATS = [{chat_id, email, name, linked_on}]
 */

function tgToken_() { return prop_('TELEGRAM_BOT_TOKEN'); }

function tgCall_(method, payload) {
  var token = tgToken_();
  if (!token) return null;
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'post', payload: payload, muteHttpExceptions: true
    });
    var body = JSON.parse(res.getContentText() || '{}');
    if (!body.ok) console.warn('Telegram ' + method + ' failed: ' + res.getContentText());
    if (/^send/.test(method)) tgRecord_(method, body.ok, body.ok ? '' : (body.description || ('HTTP ' + res.getResponseCode())), payload.chat_id);
    return body;
  } catch (err) {
    console.warn('Telegram ' + method + ' error: ' + err);
    if (/^send/.test(method)) tgRecord_(method, false, String(err), payload.chat_id);
    return null;
  }
}

/** Remembers the last successful and last failed send, so the owner app can show what happened. */
function tgRecord_(method, ok, error, chatId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var stamp = JSON.stringify({ at: Date.now(), method: method, chat_id: String(chatId || ''), error: error || '' });
    props.setProperty(ok ? 'TG_LAST_OK' : 'TG_LAST_ERROR', stamp);
  } catch (e) { /* ignore */ }
}

function ownerChats_() {
  try { return JSON.parse(prop_('OWNER_CHATS') || '[]'); } catch (e) { return []; }
}

function saveOwnerChats_(list) { setProp_('OWNER_CHATS', JSON.stringify(list)); }

/** Send to every linked owner/admin chat. photoBlob is optional. */
function notifyOwners_(text, photoBlob) {
  var chats = ownerChats_();
  if (!tgToken_()) { tgRecord_('notify', false, 'No bot token saved', ''); return; }
  if (!chats.length) { tgRecord_('notify', false, 'No Telegram chat is connected, so nobody receives alerts', ''); return; }
  chats.forEach(function (c) {
    if (photoBlob) {
      var r = tgCall_('sendPhoto', { chat_id: String(c.chat_id), caption: text.slice(0, 1024), photo: photoBlob.copyBlob() });
      if (!r || !r.ok) tgCall_('sendMessage', { chat_id: String(c.chat_id), text: text, disable_web_page_preview: 'true' });
    } else {
      tgCall_('sendMessage', { chat_id: String(c.chat_id), text: text, disable_web_page_preview: 'true' });
    }
  });
}

function notifyChat_(chatId, text) {
  if (!chatId) return;
  tgCall_('sendMessage', { chat_id: String(chatId), text: text, disable_web_page_preview: 'true' });
}

function adminLink_(hash) {
  var url = settings_().admin_url;
  return url ? url + (hash ? '#' + hash : '') : '';
}

/* ---------- Linking chats with a one-time /start code ---------- */

function tgLinkCode_(target) {
  var me = tgCall_('getMe', {});
  if (!me || !me.ok) throw apiError_('TELEGRAM_NOT_SET', 'Add the Telegram bot token first (Setup → Telegram).');
  var code = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  CacheService.getScriptCache().put('tg_' + code, JSON.stringify(target), 1800);
  return { code: code, url: 'https://t.me/' + me.result.username + '?start=' + code, bot: me.result.username };
}

/** Reads new bot messages and completes any pending links. Returns what was linked. */
function tgPollLinks_() {
  if (!tgToken_()) return [];
  var props = PropertiesService.getScriptProperties();
  var offset = Number(props.getProperty('TG_OFFSET') || 0);
  var res = tgCall_('getUpdates', { offset: String(offset), timeout: '0', allowed_updates: '["message"]' });
  if (!res || !res.ok) return [];
  var cache = CacheService.getScriptCache();
  var linked = [];
  res.result.forEach(function (u) {
    offset = Math.max(offset, u.update_id + 1);
    var msg = u.message;
    if (!msg || !msg.text) return;
    var m = /^\/start\s+([a-f0-9]{10})/.exec(msg.text.trim());
    if (!m) {
      if (/^\/start/.test(msg.text)) notifyChat_(msg.chat.id, 'Hi! This bot sends attendance updates for the store. Ask the owner for a link to connect.');
      return;
    }
    var raw = cache.get('tg_' + m[1]);
    if (!raw) { notifyChat_(msg.chat.id, 'This link has expired. Please ask for a new one.'); return; }
    cache.remove('tg_' + m[1]);
    var target = JSON.parse(raw);
    var who = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
    if (target.type === 'admin') {
      var chats = ownerChats_().filter(function (c) { return String(c.chat_id) !== String(msg.chat.id); });
      chats.push({ chat_id: msg.chat.id, email: target.email, name: who, linked_on: istParts_(Date.now()).date });
      saveOwnerChats_(chats);
      notifyChat_(msg.chat.id, '✅ Connected. You will now get every punch and alert from ' + settings_().store_name + ' here.');
      linked.push({ type: 'admin', email: target.email, name: who });
    } else if (target.type === 'staff') {
      var emp = employeeById_(target.emp_id);
      if (emp) {
        emp.telegram_chat_id = String(msg.chat.id);
        emp.telegram_receipts = 'yes';
        updateObject_(SHEET.EMP, emp._row, emp);
        notifyChat_(msg.chat.id, '✅ Hi ' + emp.name + '! You will now get a receipt here every time you punch at ' + settings_().store_name + '.');
        linked.push({ type: 'staff', emp_id: emp.emp_id, name: emp.name });
      }
    }
  });
  props.setProperty('TG_OFFSET', String(offset));
  return linked;
}
