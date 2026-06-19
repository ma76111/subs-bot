const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { settingsMenuKeyboard } = require('../../keyboards/admin');
const { getSetting, setSetting, SessionMap } = require('../../utils/helpers');

const settingsSessions = new SessionMap();

// ─── Admin Management ──────────────────────────────────────────────────────────

async function showAdminsMenu(ctx) {
  // Only show admins that are in .env (the "master" admin list)
  const envAdmins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  let text = '👨‍💼 *الأدمنز الحاليون:*\n\n';
  for (const id of envAdmins) {
    text += `• \`${id}\`\n`;
  }
  text += '\n_الأدمنز مأخوذون من متغير `ADMIN_IDS` في ملف `.env` فقط._';

  // Only the first admin in .env (owner) can add/remove
  const ownerId = envAdmins[0];
  const isOwner = String(ctx.from.id) === ownerId;

  const buttons = [];
  if (isOwner) {
    buttons.push([Markup.button.callback('➕ إضافة أدمن', 'admin_add_admin')]);
    // Add remove buttons for all except owner
    for (const id of envAdmins.slice(1)) {
      buttons.push([Markup.button.callback(`🗑️ حذف ${id}`, `admin_remove_admin_${id}`)]);
    }
  }
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_settings')]);

  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
}

async function startAddAdmin(ctx) {
  // Only owner (first in ADMIN_IDS) can add
  const envAdmins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (String(ctx.from.id) !== envAdmins[0]) {
    return ctx.reply('⛔ فقط المالك يمكنه إضافة أدمنز.');
  }
  settingsSessions.set(ctx.from.id, { action: 'add_admin' });
  try { await ctx.editMessageText('🆔 أدخل Telegram ID للأدمن الجديد (رقم فقط):'); }
  catch { await ctx.reply('🆔 أدخل Telegram ID للأدمن الجديد (رقم فقط):'); }
}

async function showSettingsMenu(ctx) {
  try { await ctx.editMessageText('🔧 *الإعدادات*', { parse_mode: 'Markdown', ...settingsMenuKeyboard() }); }
  catch { await ctx.reply('🔧 *الإعدادات*', { parse_mode: 'Markdown', ...settingsMenuKeyboard() }); }
}

async function showWallets(ctx) {
  const wallets = db.prepare('SELECT * FROM payment_wallets ORDER BY method').all();
  const methodMap = { vodafone: '📱 Vodafone Cash', orange: '🟠 Orange Cash', etisalat: '🔵 Etisalat Cash', instapay: '💳 InstaPay' };

  let text = '💳 *المحافظ الإلكترونية:*\n\n';
  if (wallets.length) {
    for (const w of wallets) {
      text += `${w.is_active ? '🟢' : '🔴'} ${methodMap[w.method] || w.method}: ${w.number}${w.owner_name ? ` (${w.owner_name})` : ''}\n`;
    }
  } else {
    text += 'لا توجد محافظ مضافة.\n';
  }

  const buttons = [
    [Markup.button.callback('➕ إضافة محفظة', 'admin_wallet_add')],
    ...wallets.map(w => [Markup.button.callback(`🗑️ حذف ${w.number}`, `admin_wallet_delete_${w.id}`)]),
    [Markup.button.callback('🔙 رجوع', 'admin_settings')],
  ];

  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
}

async function startAddWallet(ctx) {
  settingsSessions.set(ctx.from.id, { action: 'add_wallet', step: 'method' });
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('📱 Vodafone Cash', 'wallet_method_vodafone')],
    [Markup.button.callback('🟠 Orange Cash', 'wallet_method_orange')],
    [Markup.button.callback('🔵 Etisalat Cash', 'wallet_method_etisalat')],
    [Markup.button.callback('💳 InstaPay', 'wallet_method_instapay')],
  ]);
  try { await ctx.editMessageText('💳 اختر نوع المحفظة:', { ...buttons }); }
  catch { await ctx.reply('💳 اختر نوع المحفظة:', { ...buttons }); }
}

async function showBotTexts(ctx) {
  const keys = ['bot_welcome_message', 'bot_name', 'support_username'];
  const labels = { bot_welcome_message: 'رسالة الترحيب', bot_name: 'اسم البوت', support_username: 'حساب الدعم' };
  let text = '📝 *نصوص البوت:*\n\n';
  for (const k of keys) {
    text += `• ${labels[k]}: ${getSetting(k)}\n`;
  }
  const buttons = keys.map(k => [Markup.button.callback(`✏️ تعديل ${labels[k]}`, `admin_text_edit_${k}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_settings')]);
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
}

async function showStats(ctx) {
  const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const ordersCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingCount = db.prepare('SELECT COUNT(*) as c FROM orders WHERE status = "pending"').get().c;
  const totalSales = db.prepare('SELECT COALESCE(SUM(s.price), 0) as t FROM orders o JOIN services s ON o.service_id = s.id WHERE o.status = "completed"').get().t;
  const totalCharges = db.prepare('SELECT COALESCE(SUM(amount), 0) as t FROM charge_requests WHERE status = "accepted"').get().t;
  const topServices = db.prepare('SELECT s.name, COUNT(*) as c FROM orders o JOIN services s ON o.service_id = s.id GROUP BY o.service_id ORDER BY c DESC LIMIT 5').all();

  let text = `📊 *الإحصائيات*\n\n👥 المستخدمون: ${usersCount}\n📦 إجمالي الطلبات: ${ordersCount}\n⏳ الطلبات المعلقة: ${pendingCount}\n💰 إجمالي المبيعات: ${parseFloat(totalSales).toFixed(2)} جنيه\n💳 إجمالي الشحن: ${parseFloat(totalCharges).toFixed(2)} جنيه\n\n🏆 *أكثر الخدمات مبيعاً:*\n`;
  for (const s of topServices) {
    text += `• ${s.name}: ${s.c} طلب\n`;
  }

  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'admin_back')]]) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'admin_back')]]) }); }
}

async function handleSettingsInput(ctx) {
  const session = settingsSessions.get(ctx.from.id);
  if (!session) return false;

  if (session.action === 'add_admin') {
    settingsSessions.delete(ctx.from.id);
    const newId = ctx.message.text.trim();
    if (!/^\d+$/.test(newId)) { await ctx.reply('❗ يجب أن يكون ID رقماً صحيحاً.'); return true; }
    const current = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (current.includes(newId)) { await ctx.reply('⚠️ هذا الأدمن موجود بالفعل.'); return true; }
    current.push(newId);
    process.env.ADMIN_IDS = current.join(',');

    // Persist to .env file
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(process.cwd(), '.env');
    try {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('ADMIN_IDS=')) {
        envContent = envContent.replace(/ADMIN_IDS=.*/,  `ADMIN_IDS=${current.join(',')}`);
      } else {
        envContent += `\nADMIN_IDS=${current.join(',')}`;
      }
      fs.writeFileSync(envPath, envContent);
      await ctx.reply(`✅ تم إضافة الأدمن \`${newId}\` بنجاح!\n\n_ملاحظة: التغيير سيكون فعالاً فوراً._`, { parse_mode: 'Markdown' });
    } catch {
      await ctx.reply(`✅ تم إضافة الأدمن في الذاكرة. أضف \`${newId}\` يدوياً لـ ADMIN_IDS في .env`, { parse_mode: 'Markdown' });
    }
    return true;
  }

  if (session.action === 'add_wallet') {
    if (session.step === 'number') {
      session.number = ctx.message.text.trim(); session.step = 'owner';
      settingsSessions.set(ctx.from.id, session);
      await ctx.reply('👤 أدخل اسم صاحب المحفظة (أو "-" لتخطي):');
      return true;
    }
    if (session.step === 'owner') {
      settingsSessions.delete(ctx.from.id);
      const owner = ctx.message.text === '-' ? null : ctx.message.text;
      db.prepare('INSERT INTO payment_wallets (method, number, owner_name) VALUES (?, ?, ?)').run(session.method, session.number, owner);
      await ctx.reply('✅ تم إضافة المحفظة بنجاح!');
      await showWallets(ctx);
      return true;
    }
  }

  if (session.action === 'edit_text') {
    settingsSessions.delete(ctx.from.id);
    setSetting(session.key, ctx.message.text);
    await ctx.reply('✅ تم تعديل النص بنجاح!');
    return true;
  }

  return false;
}

function handleSettingsCallback(ctx, data) {
  if (data.startsWith('wallet_method_')) {
    const method = data.replace('wallet_method_', '');
    const session = settingsSessions.get(ctx.from.id);
    if (session && session.action === 'add_wallet') {
      session.method = method; session.step = 'number';
      settingsSessions.set(ctx.from.id, session);
      ctx.reply('📞 أدخل رقم المحفظة:');
      return true;
    }
  }
  if (data.startsWith('admin_wallet_delete_')) {
    const walletId = parseInt(data.split('_')[3]);
    db.prepare('DELETE FROM payment_wallets WHERE id = ?').run(walletId);
    ctx.reply('🗑️ تم حذف المحفظة.').then(() => showWallets(ctx));
    return true;
  }
  if (data.startsWith('admin_text_edit_')) {
    const key = data.replace('admin_text_edit_', '');
    settingsSessions.set(ctx.from.id, { action: 'edit_text', key });
    ctx.reply(`✏️ أدخل القيمة الجديدة لـ "${key}":`);
    return true;
  }
  if (data === 'admin_admins') {
    showAdminsMenu(ctx);
    return true;
  }
  if (data === 'admin_add_admin') {
    startAddAdmin(ctx);
    return true;
  }
  if (data.startsWith('admin_remove_admin_')) {
    const removeId = data.replace('admin_remove_admin_', '');
    const current = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(id => id && id !== removeId);
    process.env.ADMIN_IDS = current.join(',');
    const fs = require('fs');
    const path = require('path');
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = envContent.replace(/ADMIN_IDS=.*/, `ADMIN_IDS=${current.join(',')}`);
      fs.writeFileSync(envPath, envContent);
    } catch {}
    ctx.reply(`✅ تم إزالة الأدمن \`${removeId}\`.`, { parse_mode: 'Markdown' }).then(() => showAdminsMenu(ctx));
    return true;
  }
  return false;
}

module.exports = { showSettingsMenu, showWallets, startAddWallet, showBotTexts, showStats, showAdminsMenu, startAddAdmin, handleSettingsInput, handleSettingsCallback };
