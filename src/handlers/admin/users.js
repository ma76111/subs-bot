const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { usersMenuKeyboard, userActionKeyboard } = require('../../keyboards/admin');
const { formatCurrency, formatDate, SessionMap } = require('../../utils/helpers');

const userSessions = new SessionMap();

async function showUsersMenu(ctx) {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  try {
    await ctx.editMessageText(`👥 *إدارة المستخدمين*\nإجمالي: ${count} مستخدم`, { parse_mode: 'Markdown', ...usersMenuKeyboard() });
  } catch {
    await ctx.reply(`👥 *إدارة المستخدمين*\nإجمالي: ${count} مستخدم`, { parse_mode: 'Markdown', ...usersMenuKeyboard() });
  }
}

async function showUsersList(ctx, page = 0) {
  const perPage = 10;
  const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(perPage, page * perPage);

  const buttons = users.map(u => [Markup.button.callback(`${u.is_banned ? '🚫' : '✅'} ${u.full_name} (@${u.username || '-'})`, `admin_user_${u.id}`)]);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('◀️', `admin_users_page_${page - 1}`));
  if ((page + 1) * perPage < total) nav.push(Markup.button.callback('▶️', `admin_users_page_${page + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_users')]);

  try {
    await ctx.editMessageText(`👥 المستخدمون (${total})`, { ...Markup.inlineKeyboard(buttons) });
  } catch {
    await ctx.reply(`👥 المستخدمون (${total})`, { ...Markup.inlineKeyboard(buttons) });
  }
}

async function startUserSearch(ctx) {
  userSessions.set(ctx.from.id, { action: 'search_user' });
  try { await ctx.editMessageText('🔍 أدخل اسم المستخدم أو اليوزر للبحث:'); }
  catch { await ctx.reply('🔍 أدخل اسم المستخدم أو اليوزر للبحث:'); }
}

async function showUserDetail(ctx, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return ctx.reply('❌ المستخدم غير موجود.');
  const ordersCount = db.prepare('SELECT COUNT(*) as c FROM orders WHERE user_id = ?').get(userId).c;
  const text = `👤 *${user.full_name}*\n\n🆔 Telegram: \`${user.telegram_id}\`\n📛 اليوزر: @${user.username || '-'}\n💰 الرصيد: ${formatCurrency(user.balance)}\n📦 الطلبات: ${ordersCount}\n🚫 محظور: ${user.is_banned ? 'نعم' : 'لا'}\n📅 الانضمام: ${formatDate(user.created_at)}`;
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...userActionKeyboard(user) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...userActionKeyboard(user) }); }
}

async function toggleBan(ctx, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(user.is_banned ? 0 : 1, userId);
  await showUserDetail(ctx, userId);
}

async function startEditBalance(ctx, userId) {
  userSessions.set(ctx.from.id, { action: 'edit_balance', userId });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  await ctx.reply(`💰 الرصيد الحالي: ${formatCurrency(user.balance)}\n\nأدخل المبلغ الجديد (يمكن استخدام + أو - للتعديل، مثل: +100 أو -50):`);
}

async function showUserOrders(ctx, userId) {
  const orders = db.prepare('SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 50').all(userId);
  if (!orders.length) return ctx.reply('📦 لا توجد طلبات لهذا المستخدم.');
  let text = '📦 *طلبات المستخدم:*\n\n';
  for (const o of orders) {
    text += `• #${o.uuid} - ${o.service_name} - ${o.status}\n`;
  }
  await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', `admin_user_${userId}`)]]) });
}

async function handleUserAdminInput(ctx) {
  const session = userSessions.get(ctx.from.id);
  if (!session) return false;

  if (session.action === 'search_user') {
    userSessions.delete(ctx.from.id);
    const q = ctx.message.text.replace('@', '');
    const users = db.prepare('SELECT * FROM users WHERE full_name LIKE ? OR username LIKE ? LIMIT 10').all(`%${q}%`, `%${q}%`);
    if (!users.length) { await ctx.reply('❌ لم يتم العثور على مستخدمين.'); return true; }
    const buttons = users.map(u => [Markup.button.callback(`${u.full_name} (@${u.username || '-'})`, `admin_user_${u.id}`)]);
    await ctx.reply('🔍 *نتائج البحث:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    return true;
  }

  if (session.action === 'edit_balance') {
    userSessions.delete(ctx.from.id);
    // Re-fetch fresh balance from DB
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(session.userId);
    let newBalance;
    const input = ctx.message.text.trim();
    if (input.startsWith('+')) {
      newBalance = user.balance + parseFloat(input.slice(1));
    } else if (input.startsWith('-')) {
      newBalance = user.balance - parseFloat(input.slice(1));
    } else {
      newBalance = parseFloat(input);
    }
    if (isNaN(newBalance) || newBalance < 0) { await ctx.reply('❗ قيمة غير صحيحة. الرصيد لا يمكن أن يكون سالباً.'); return true; }
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, session.userId);
    await ctx.reply(`✅ تم تعديل الرصيد إلى ${formatCurrency(newBalance)}`);
    await showUserDetail(ctx, session.userId);
    return true;
  }

  return false;
}

module.exports = { showUsersMenu, showUsersList, startUserSearch, showUserDetail, toggleBan, startEditBalance, showUserOrders, handleUserAdminInput };
