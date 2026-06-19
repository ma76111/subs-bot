const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { SessionMap } = require('../../utils/helpers');

const notifSessions = new SessionMap();

async function showNotificationsMenu(ctx) {
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('📢 إشعار جماعي', 'admin_notif_all')],
    [Markup.button.callback('👤 إشعار لمستخدم', 'admin_notif_user')],
    [Markup.button.callback('🛍️ إشعار لمشتركي خدمة', 'admin_notif_service')],
    [Markup.button.callback('🔙 رجوع', 'admin_back')],
  ]);
  try { await ctx.editMessageText('📢 *إرسال الإشعارات*', { parse_mode: 'Markdown', ...buttons }); }
  catch { await ctx.reply('📢 *إرسال الإشعارات*', { parse_mode: 'Markdown', ...buttons }); }
}

async function startBroadcast(ctx) {
  notifSessions.set(ctx.from.id, { type: 'broadcast' });
  try { await ctx.editMessageText('📢 أدخل نص الإشعار الجماعي:'); }
  catch { await ctx.reply('📢 أدخل نص الإشعار الجماعي:'); }
}

async function startUserNotif(ctx) {
  notifSessions.set(ctx.from.id, { type: 'user_notif', step: 'search' });
  try { await ctx.editMessageText('👤 أدخل اسم المستخدم أو اليوزر:'); }
  catch { await ctx.reply('👤 أدخل اسم المستخدم أو اليوزر:'); }
}

async function startServiceNotif(ctx) {
  const services = db.prepare('SELECT * FROM services WHERE is_active = 1').all();
  const buttons = services.map(s => [Markup.button.callback(s.name, `admin_notif_svc_${s.id}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_notifications')]);
  try { await ctx.editMessageText('🛍️ اختر الخدمة:', { ...Markup.inlineKeyboard(buttons) }); }
  catch { await ctx.reply('🛍️ اختر الخدمة:', { ...Markup.inlineKeyboard(buttons) }); }
}

async function handleNotifServiceSelect(ctx, serviceId) {
  notifSessions.set(ctx.from.id, { type: 'service_notif', serviceId });
  await ctx.reply('📝 أدخل نص الإشعار:');
}

async function handleNotifInput(ctx) {
  const session = notifSessions.get(ctx.from.id);
  if (!session) return false;

  if (session.type === 'broadcast') {
    notifSessions.delete(ctx.from.id);
    const users = db.prepare('SELECT * FROM users WHERE is_banned = 0').all();
    let sent = 0;
    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user.telegram_id, `📢 *إشعار عام*\n\n${ctx.message.text}`, { parse_mode: 'Markdown' });
        db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(user.id, ctx.message.text);
        sent++;
      } catch {}
    }
    await ctx.reply(`✅ تم إرسال الإشعار لـ ${sent} مستخدم.`);
    return true;
  }

  if (session.type === 'user_notif') {
    if (session.step === 'search') {
      const q = ctx.message.text.replace('@', '');
      const users = db.prepare('SELECT * FROM users WHERE full_name LIKE ? OR username LIKE ? LIMIT 5').all(`%${q}%`, `%${q}%`);
      if (!users.length) { await ctx.reply('❌ لم يتم العثور على مستخدمين.'); notifSessions.delete(ctx.from.id); return true; }
      session.step = 'select';
      notifSessions.set(ctx.from.id, session);
      const buttons = users.map(u => [Markup.button.callback(`${u.full_name} (@${u.username || '-'})`, `admin_notif_target_${u.id}`)]);
      await ctx.reply('اختر المستخدم:', { ...Markup.inlineKeyboard(buttons) });
      return true;
    }
    if (session.step === 'message') {
      notifSessions.delete(ctx.from.id);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.targetUserId);
      try {
        await ctx.telegram.sendMessage(user.telegram_id, `🔔 *إشعار شخصي*\n\n${ctx.message.text}`, { parse_mode: 'Markdown' });
        db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(user.id, ctx.message.text);
        await ctx.reply('✅ تم إرسال الإشعار بنجاح.');
      } catch {
        await ctx.reply('❌ تعذر إرسال الإشعار. ربما قام المستخدم بحظر البوت.');
      }
      return true;
    }
  }

  if (session.type === 'service_notif') {
    notifSessions.delete(ctx.from.id);
    const buyers = db.prepare('SELECT DISTINCT u.* FROM users u JOIN orders o ON u.id = o.user_id WHERE o.service_id = ? AND u.is_banned = 0').all(session.serviceId);
    let sent = 0;
    for (const user of buyers) {
      try {
        await ctx.telegram.sendMessage(user.telegram_id, `🔔 *إشعار*\n\n${ctx.message.text}`, { parse_mode: 'Markdown' });
        db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(user.id, ctx.message.text);
        sent++;
      } catch {}
    }
    await ctx.reply(`✅ تم إرسال الإشعار لـ ${sent} مستخدم.`);
    return true;
  }

  return false;
}

function handleNotifCallback(ctx, data) {
  if (data.startsWith('admin_notif_target_')) {
    const userId = parseInt(data.split('_')[3]);
    const session = notifSessions.get(ctx.from.id);
    if (session && session.type === 'user_notif') {
      session.targetUserId = userId;
      session.step = 'message';
      notifSessions.set(ctx.from.id, session);
      ctx.reply('✉️ أدخل نص الإشعار:');
      return true;
    }
  }
  if (data.startsWith('admin_notif_svc_')) {
    const serviceId = parseInt(data.split('_')[3]);
    handleNotifServiceSelect(ctx, serviceId);
    return true;
  }
  return false;
}

module.exports = { showNotificationsMenu, startBroadcast, startUserNotif, startServiceNotif, handleNotifInput, handleNotifCallback };
