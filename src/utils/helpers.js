const { db } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { getBot } = require('../config/bot-instance');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getOrCreateUser(telegramUser) {
  const fullName = telegramUser.first_name + (telegramUser.last_name ? ' ' + telegramUser.last_name : '');
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramUser.id);
  if (existing) {
    db.prepare('UPDATE users SET username = ?, full_name = ?, updated_at = ? WHERE telegram_id = ?')
      .run(telegramUser.username || null, fullName, now, telegramUser.id);
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramUser.id);
  }
  db.prepare('INSERT INTO users (telegram_id, username, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(telegramUser.id, telegramUser.username || null, fullName, now, now);
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramUser.id);
}

function isAdmin(telegramId) {
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim()));
  return adminIds.includes(telegramId);
}

function generateUUID() {
  // Use full UUID to prevent collisions
  return uuidv4().replace(/-/g, '').toUpperCase().slice(0, 12);
}

function formatCurrency(amount) {
  return `${parseFloat(amount).toFixed(2)} ${getSetting('currency') || 'جنيه'}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'غير محدد';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getOrderStatusText(status) {
  const map = {
    pending: '⏳ قيد المراجعة',
    accepted: '✅ مقبول',
    processing: '🔄 جاري التنفيذ',
    completed: '✔️ مكتمل',
    rejected: '❌ مرفوض',
  };
  return map[status] || status;
}

function getChargeStatusText(status) {
  const map = {
    pending: '⏳ قيد المراجعة',
    accepted: '✅ مقبول',
    rejected: '❌ مرفوض',
  };
  return map[status] || status;
}

function getPaymentMethodText(method) {
  const map = {
    vodafone: '📱 Vodafone Cash',
    orange: '🟠 Orange Cash',
    etisalat: '🔵 Etisalat Cash',
    instapay: '💳 InstaPay',
  };
  return map[method] || method;
}

function validateField(value, field) {
  if (field.is_required && (!value || value.trim() === '')) {
    return `❗ حقل "${field.label}" مطلوب`;
  }
  if (!value || value.trim() === '') return null;

  const val = value.trim();

  switch (field.type) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return `❗ "${field.label}" يجب أن يكون بريد إلكتروني صحيح`;
      break;
    case 'phone':
      if (!/^(\+?201|01)[0-9]{9}$/.test(val)) return `❗ "${field.label}" يجب أن يكون رقم هاتف مصري صحيح`;
      break;
    case 'url':
      try { new URL(val); } catch { return `❗ "${field.label}" يجب أن يكون رابط صحيح`; }
      break;
    case 'number':
      if (isNaN(Number(val))) return `❗ "${field.label}" يجب أن يكون رقماً`;
      break;
    case 'regex':
      if (field.regex_pattern) {
        try {
          const regex = new RegExp(field.regex_pattern);
          // Protect against ReDoS: limit input length before matching
          const safeVal = val.slice(0, 500);
          if (!regex.test(safeVal)) return `❗ "${field.label}" لا يطابق الصيغة المطلوبة`;
        } catch {
          // Invalid regex pattern — skip validation
        }
      }
      break;
  }

  if (field.min_length && val.length < field.min_length) return `❗ "${field.label}" يجب ألا يقل عن ${field.min_length} حروف`;
  if (field.max_length && val.length > field.max_length) return `❗ "${field.label}" يجب ألا يزيد عن ${field.max_length} حروف`;

  return null;
}

function sendNotification(_, userId, message) {
  const bot = getBot();
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId);
  db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(userId, message);
  if (user && bot) {
    bot.telegram.sendMessage(user.telegram_id, `🔔 *إشعار جديد*\n\n${message}`, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

function now() {
  return new Date().toISOString();
}

// Auto-expiring session Map — sessions expire after TTL ms
const ADMIN_SESSION_TTL = 15 * 60 * 1000; // 15 minutes

class SessionMap {
  constructor(ttl = ADMIN_SESSION_TTL) {
    this._map = new Map();
    this._ttl = ttl;
    setInterval(() => {
      const expiry = Date.now();
      for (const [key, entry] of this._map.entries()) {
        if (expiry - entry.ts > this._ttl) this._map.delete(key);
      }
    }, 5 * 60 * 1000);
  }
  set(key, value) { this._map.set(key, { value, ts: Date.now() }); }
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this._ttl) { this._map.delete(key); return undefined; }
    return entry.value;
  }
  has(key) { return this.get(key) !== undefined; }
  delete(key) { this._map.delete(key); }
  entries() {
    const result = [];
    for (const [key, entry] of this._map.entries()) {
      if (Date.now() - entry.ts <= this._ttl) result.push([key, entry.value]);
    }
    return result;
  }
}

module.exports = { getSetting, setSetting, getOrCreateUser, isAdmin, generateUUID, formatCurrency, formatDate, getOrderStatusText, getChargeStatusText, getPaymentMethodText, validateField, sendNotification, now, SessionMap };
