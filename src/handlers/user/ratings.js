const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { SessionMap } = require('../../utils/helpers');

const ratingSessions = new SessionMap();

async function startRating(ctx, orderId) {
  const order = db.prepare('SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ? AND o.user_id = ? AND o.status = "completed"').get(orderId, ctx.dbUser.id);
  if (!order) return ctx.answerCbQuery('❌ الطلب غير موجود أو لم يكتمل بعد.', { show_alert: true });

  const existing = db.prepare('SELECT id FROM order_ratings WHERE order_id = ?').get(orderId);
  if (existing) return ctx.answerCbQuery('لقد قمت بتقييم هذه الخدمة بالفعل.', { show_alert: true });

  try {
    await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
      [[1, 2, 3, 4, 5].map(n => Markup.button.callback('⭐'.repeat(n), `rate_order_${orderId}_${n}`))],
      [Markup.button.callback('🔙 رجوع', `user_order_${orderId}`)],
    ]).reply_markup);
  } catch {
    await ctx.reply(
      `⭐ *تقييم "${order.service_name}"*\n\nاختر تقييمك:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
        [[1, 2, 3, 4, 5].map(n => Markup.button.callback('⭐'.repeat(n), `rate_order_${orderId}_${n}`))],
      ]) }
    );
  }
}

async function submitRating(ctx, orderId, stars) {
  const order = db.prepare('SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ? AND o.user_id = ?').get(orderId, ctx.dbUser.id);
  if (!order) return ctx.answerCbQuery('❌ الطلب غير موجود.', { show_alert: true });

  const existing = db.prepare('SELECT id FROM order_ratings WHERE order_id = ?').get(orderId);
  if (existing) return ctx.answerCbQuery('لقد قمت بتقييم هذه الخدمة بالفعل.', { show_alert: true });

  // Ask for comment
  ratingSessions.set(ctx.dbUser.id, { orderId, stars });
  try {
    await ctx.editMessageText(
      `${'⭐'.repeat(stars)} شكراً على تقييمك!\n\nأضف تعليقاً (اختياري) أو أرسل "-" لتخطي:`,
      { parse_mode: 'Markdown' }
    );
  } catch {
    await ctx.reply(`${'⭐'.repeat(stars)} أضف تعليقاً (اختياري) أو أرسل "-" لتخطي:`);
  }
}

async function handleRatingInput(ctx) {
  const session = ratingSessions.get(ctx.dbUser.id);
  if (!session) return false;
  ratingSessions.delete(ctx.dbUser.id);

  const comment = ctx.message.text === '-' ? null : ctx.message.text;
  db.prepare('INSERT OR IGNORE INTO order_ratings (order_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(session.orderId, ctx.dbUser.id, session.stars, comment);

  await ctx.reply(`✅ تم حفظ تقييمك ${'⭐'.repeat(session.stars)}\nشكراً على تعليقك! 🙏`);
  return true;
}

function hasRatingSession(userId) { return ratingSessions.has(userId); }

module.exports = { startRating, submitRating, handleRatingInput, hasRatingSession };
