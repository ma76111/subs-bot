const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { formatCurrency, formatDate, getSetting } = require('../../utils/helpers');

async function showNotifications(ctx) {
  const userId = ctx.dbUser.id;
  const notifs = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId);

  if (!notifs.length) {
    await ctx.reply('🔔 لا توجد إشعارات حتى الآن.');
    return;
  }

  let text = '🔔 *إشعاراتك:*\n\n';
  for (const n of notifs) {
    // Use is_read BEFORE marking as read so icons are accurate
    const icon = n.is_read ? '📭' : '📬';
    text += `${icon} ${n.message}\n📅 ${formatDate(n.created_at)}\n\n`;
  }

  // Mark as read AFTER building the message
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

async function showProfile(ctx) {
  // Always fetch fresh data from DB to show current balance
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.dbUser.id);
  const ordersCount = db.prepare('SELECT COUNT(*) as c FROM orders WHERE user_id = ?').get(user.id).c;

  const text = `👤 *حسابي*\n\n📛 الاسم: ${user.full_name}\n🆔 اليوزر: ${user.username ? '@' + user.username : 'لا يوجد'}\n💰 الرصيد: *${formatCurrency(user.balance)}*\n📦 عدد الطلبات: ${ordersCount}\n📅 تاريخ الانضمام: ${formatDate(user.created_at)}`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

// Session for support messages
const supportSessions = new Map();

async function showSupport(ctx) {
  const support = getSetting('support_username');
  await ctx.reply(
    `📞 *الدعم الفني*\n\nيمكنك التواصل معنا مباشرة: ${support || '@support'}\n\nأو أرسل رسالتك أدناه وسيتم الرد عليك:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('✉️ إرسال رسالة', 'send_support_msg')]]),
    }
  );
}

async function startSupportMessage(ctx) {
  supportSessions.set(ctx.dbUser.id, true);
  await ctx.editMessageText('✉️ أرسل رسالتك للدعم الفني:');
}

async function handleSupportMessage(ctx) {
  if (!supportSessions.get(ctx.dbUser.id)) return false;
  supportSessions.delete(ctx.dbUser.id);
  db.prepare('INSERT INTO support_messages (user_id, message) VALUES (?, ?)').run(ctx.dbUser.id, ctx.message.text);

  // Notify admins
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim()));
  const msg = `📞 *رسالة دعم جديدة*\n\n👤 من: ${ctx.dbUser.full_name} (@${ctx.dbUser.username || '-'})\n🆔 ID: ${ctx.from.id}\n\n💬 ${ctx.message.text}`;
  for (const adminId of adminIds) {
    ctx.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' }).catch(() => {});
  }

  await ctx.reply('✅ تم إرسال رسالتك بنجاح! سيتم الرد عليك قريباً.');
  return true;
}

function hasSupportSession(userId) { return supportSessions.has(userId); }

module.exports = { showNotifications, showProfile, showSupport, startSupportMessage, handleSupportMessage, hasSupportSession };
