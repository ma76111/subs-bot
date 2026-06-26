const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { formatCurrency, formatDate, generateUUID, getPaymentMethodText } = require('../../utils/helpers');

// Session store for charge requests
const chargeSessions = new Map();

// Auto-expire charge sessions after 30 minutes
const CHARGE_SESSION_TTL = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of chargeSessions.entries()) {
    if (now - (session.createdAt || 0) > CHARGE_SESSION_TTL) {
      chargeSessions.delete(userId);
    }
  }
}, 5 * 60 * 1000);

async function showBalance(ctx) {
  // Always fetch fresh balance from DB
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.dbUser.id);
  const charges = db.prepare('SELECT * FROM charge_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id);

  let text = `💰 *رصيدك الحالي*\n\n💵 الرصيد: *${formatCurrency(user.balance)}*\n\n`;
  if (charges.length) {
    text += '📜 *آخر عمليات الشحن:*\n';
    for (const c of charges) {
      text += `• ${formatCurrency(c.amount)} - ${getPaymentMethodText(c.payment_method)} - ${c.status === 'accepted' ? '✅' : c.status === 'rejected' ? '❌' : '⏳'}\n`;
    }
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('💳 شحن الرصيد', 'charge_start')],
      [Markup.button.callback('📜 سجل الشحن الكامل', 'charge_history')],
    ]),
  });
}

async function startCharge(ctx) {
  const wallets = db.prepare('SELECT DISTINCT method FROM payment_wallets WHERE is_active = 1').all();
  if (!wallets.length) {
    return ctx.editMessageText('❌ لا توجد وسائل دفع متاحة حالياً. تواصل مع الدعم.');
  }

  const methodMap = { vodafone: '📱 Vodafone Cash', orange: '🟠 Orange Cash', etisalat: '🔵 Etisalat Cash', instapay: '💳 InstaPay' };
  const buttons = wallets.map(w => [Markup.button.callback(methodMap[w.method] || w.method, `charge_method_${w.method}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'back_balance')]);

  await ctx.editMessageText('💳 *اختر وسيلة الدفع:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function selectPaymentMethod(ctx, method) {
  const wallets = db.prepare('SELECT * FROM payment_wallets WHERE method = ? AND is_active = 1').all(method);
  const methodMap = { vodafone: '📱 Vodafone Cash', orange: '🟠 Orange Cash', etisalat: '🔵 Etisalat Cash', instapay: '💳 InstaPay' };

  let text = `${methodMap[method]}\n\n📞 *أرقام التحويل:*\n`;
  for (const w of wallets) {
    text += `• ${w.number}${w.owner_name ? ` (${w.owner_name})` : ''}\n`;
  }
  text += '\n💵 *أدخل المبلغ الذي تريد شحنه:*';

  chargeSessions.set(ctx.dbUser.id, { method, step: 'amount', createdAt: Date.now() });
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'charge_start')]]) });
}

async function handleChargeInput(ctx) {
  const userId = ctx.dbUser.id;
  const session = chargeSessions.get(userId);
  if (!session) return false;

  // Re-check ban status mid-session
  const freshUser = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(userId);
  if (freshUser.is_banned) {
    chargeSessions.delete(userId);
    await ctx.reply('🚫 تم حظر حسابك.');
    return true;
  }

  if (session.step === 'amount') {
    const amount = parseFloat(ctx.message.text);
    const min = parseFloat(process.env.MIN_CHARGE || '50');
    const max = parseFloat(process.env.MAX_CHARGE || '10000');
    if (isNaN(amount) || amount < min) {
      await ctx.reply(`❗ يرجى إدخال مبلغ صحيح لا يقل عن ${min} جنيه`);
      return true;
    }
    if (amount > max) {
      await ctx.reply(`❗ الحد الأقصى للشحن هو ${max} جنيه`);
      return true;
    }

    // Limit pending charge requests (max 2)
    const pendingCharges = db.prepare('SELECT COUNT(*) as c FROM charge_requests WHERE user_id = ? AND status = "pending"').get(userId).c;
    if (pendingCharges >= 2) {
      chargeSessions.delete(userId);
      await ctx.reply('⚠️ لديك طلبا شحن معلقان بالفعل. انتظر معالجتهما أولاً.');
      return true;
    }

    session.amount = amount;
    session.step = 'photo';
    chargeSessions.set(userId, session);
    await ctx.reply(`✅ المبلغ: *${formatCurrency(amount)}*\n\n📸 الآن أرسل صورة إيصال التحويل:`, { parse_mode: 'Markdown' });
    return true;
  }

  if (session.step === 'photo' && ctx.message.photo) {
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const uuid = generateUUID();
    db.prepare('INSERT INTO charge_requests (uuid, user_id, amount, payment_method, photo_file_id) VALUES (?, ?, ?, ?, ?)')
      .run(uuid, userId, session.amount, session.method, photoId);

    chargeSessions.delete(userId);
    await ctx.reply(`✅ *تم إرسال طلب الشحن بنجاح!*\n\n🔖 رقم الطلب: \`${uuid}\`\n💰 المبلغ: ${formatCurrency(session.amount)}\n\n⏳ سيتم مراجعة طلبك وإضافة الرصيد قريباً.`, { parse_mode: 'Markdown' });

    // Notify admins
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim()));
    const methodMap = { vodafone: '📱 Vodafone Cash', orange: '🟠 Orange Cash', etisalat: '🔵 Etisalat Cash', instapay: '💳 InstaPay' };
    const adminMsg = `💳 *طلب شحن جديد #${uuid}*\n\n👤 المستخدم: ${ctx.dbUser.full_name} (@${ctx.dbUser.username || '-'})\n💰 المبلغ: ${formatCurrency(session.amount)}\n💳 وسيلة الدفع: ${methodMap[session.method]}`;
    for (const adminId of adminIds) {
      ctx.telegram.sendPhoto(adminId, photoId, { caption: adminMsg, parse_mode: 'Markdown' }).catch(() => {});
    }
    return true;
  }

  return false;
}

async function showChargeHistory(ctx) {
  const charges = db.prepare('SELECT * FROM charge_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(ctx.dbUser.id);
  if (!charges.length) return ctx.editMessageText('📜 لا توجد عمليات شحن سابقة.');

  let text = '📜 *سجل الشحن:*\n\n';
  for (const c of charges) {
    const statusIcon = c.status === 'accepted' ? '✅' : c.status === 'rejected' ? '❌' : '⏳';
    text += `${statusIcon} ${formatCurrency(c.amount)} - ${getPaymentMethodText(c.payment_method)}\n📅 ${formatDate(c.created_at)}\n\n`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_balance')]]),
  });
}

function getChargeSession(userId) { return chargeSessions.get(userId); }
function clearChargeSession(userId) { chargeSessions.delete(userId); }

module.exports = { showBalance, startCharge, selectPaymentMethod, handleChargeInput, showChargeHistory, getChargeSession, clearChargeSession };
