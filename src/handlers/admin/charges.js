const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { chargeActionKeyboard } = require('../../keyboards/admin');
const { formatCurrency, formatDate, getPaymentMethodText, sendNotification, now } = require('../../utils/helpers');

async function showChargeRequests(ctx) {
  const charges = db.prepare(`
    SELECT cr.*, u.full_name as user_name, u.username
    FROM charge_requests cr
    JOIN users u ON cr.user_id = u.id
    WHERE cr.status = 'pending'
    ORDER BY cr.created_at DESC
  `).all();

  if (!charges.length) {
    try { await ctx.editMessageText('💳 لا توجد طلبات شحن معلقة.'); }
    catch { await ctx.reply('💳 لا توجد طلبات شحن معلقة.'); }
    return;
  }

  const buttons = charges.map(c => [Markup.button.callback(`#${c.uuid} - ${formatCurrency(c.amount)} - ${c.user_name}`, `admin_charge_${c.id}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_back')]);

  try {
    await ctx.editMessageText(`💳 *طلبات الشحن المعلقة (${charges.length})*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch {
    await ctx.reply(`💳 *طلبات الشحن المعلقة (${charges.length})*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

async function showChargeDetail(ctx, chargeId) {
  const charge = db.prepare(`
    SELECT cr.*, u.full_name as user_name, u.username, u.telegram_id
    FROM charge_requests cr
    JOIN users u ON cr.user_id = u.id
    WHERE cr.id = ?
  `).get(chargeId);

  if (!charge) return ctx.reply('❌ الطلب غير موجود.');

  const caption = `💳 *طلب شحن #${charge.uuid}*\n\n👤 المستخدم: ${charge.user_name} (@${charge.username || '-'})\n💰 المبلغ: *${formatCurrency(charge.amount)}*\n💳 وسيلة الدفع: ${getPaymentMethodText(charge.payment_method)}\n📅 التاريخ: ${formatDate(charge.created_at)}`;

  try {
    if (charge.photo_file_id) {
      await ctx.replyWithPhoto(charge.photo_file_id, { caption, parse_mode: 'Markdown', ...chargeActionKeyboard(charge) });
    } else {
      await ctx.reply(caption, { parse_mode: 'Markdown', ...chargeActionKeyboard(charge) });
    }
  } catch {
    await ctx.reply(caption, { parse_mode: 'Markdown', ...chargeActionKeyboard(charge) });
  }
}

async function acceptCharge(ctx, chargeId) {
  let charge;
  try {
    db.transaction(() => {
      charge = db.prepare('SELECT * FROM charge_requests WHERE id = ? AND status = "pending"').get(chargeId);
      if (!charge) throw new Error('already_processed');
      db.prepare('UPDATE charge_requests SET status = "accepted", updated_at = ? WHERE id = ?').run(now(), chargeId);
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(charge.amount, charge.user_id);
    });
  } catch (e) {
    if (e.message === 'already_processed') {
      try { await ctx.editMessageCaption('⚠️ هذا الطلب تمت معالجته بالفعل.'); } catch { await ctx.reply('⚠️ هذا الطلب تمت معالجته بالفعل.'); }
    } else {
      try { await ctx.editMessageCaption('❌ حدث خطأ. حاول مرة أخرى.'); } catch { await ctx.reply('❌ حدث خطأ.'); }
    }
    return;
  }

  sendNotification(null, charge.user_id, `✅ تم قبول طلب شحن رصيدك!\n💰 تم إضافة *${formatCurrency(charge.amount)}* لرصيدك.`);

  try {
    await ctx.editMessageCaption(`✅ تم قبول الشحن وإضافة ${formatCurrency(charge.amount)} لرصيد المستخدم.`);
  } catch {
    await ctx.reply(`✅ تم قبول الشحن وإضافة ${formatCurrency(charge.amount)} لرصيد المستخدم.`);
  }
}

async function rejectCharge(ctx, chargeId) {
  let charge;
  try {
    db.transaction(() => {
      charge = db.prepare('SELECT * FROM charge_requests WHERE id = ? AND status = "pending"').get(chargeId);
      if (!charge) throw new Error('already_processed');
      db.prepare('UPDATE charge_requests SET status = "rejected", updated_at = ? WHERE id = ?').run(now(), chargeId);
    });
  } catch (e) {
    if (e.message === 'already_processed') {
      try { await ctx.editMessageCaption('⚠️ هذا الطلب تمت معالجته بالفعل.'); } catch { await ctx.reply('⚠️ هذا الطلب تمت معالجته بالفعل.'); }
    } else {
      try { await ctx.editMessageCaption('❌ حدث خطأ. حاول مرة أخرى.'); } catch { await ctx.reply('❌ حدث خطأ.'); }
    }
    return;
  }
  sendNotification(null, charge.user_id, `❌ تم رفض طلب شحن رصيدك بمبلغ ${formatCurrency(charge.amount)}.\nتواصل مع الدعم إذا كان هناك خطأ.`);

  try {
    await ctx.editMessageCaption('❌ تم رفض طلب الشحن.');
  } catch {
    await ctx.reply('❌ تم رفض طلب الشحن.');
  }
}

module.exports = { showChargeRequests, showChargeDetail, acceptCharge, rejectCharge };
