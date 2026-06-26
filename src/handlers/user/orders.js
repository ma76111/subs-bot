const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { formatCurrency, formatDate, getOrderStatusText } = require('../../utils/helpers');
const { ordersFilterKeyboard } = require('../../keyboards/user');

async function showOrders(ctx) {
  await ctx.reply('📦 *طلباتي*\n\nاختر الحالة لعرض الطلبات:', { parse_mode: 'Markdown', ...ordersFilterKeyboard() });
}

async function showOrdersByStatus(ctx, status) {
  const userId = ctx.dbUser.id;
  const LIMIT = 50;
  const query = status === 'all'
    ? 'SELECT o.*, s.name as service_name, s.price FROM orders o JOIN services s ON o.service_id = s.id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT ?'
    : 'SELECT o.*, s.name as service_name, s.price FROM orders o JOIN services s ON o.service_id = s.id WHERE o.user_id = ? AND o.status = ? ORDER BY o.created_at DESC LIMIT ?';
  const orders = status === 'all'
    ? db.prepare(query).all(userId, LIMIT)
    : db.prepare(query).all(userId, status, LIMIT);

  if (!orders.length) return ctx.editMessageText('📦 لا توجد طلبات بهذه الحالة.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'my_orders')]]) });

  const buttons = orders.slice(0, 10).map(o => [Markup.button.callback(`#${o.uuid} - ${o.service_name}`, `user_order_${o.id}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'my_orders')]);

  await ctx.editMessageText(`📦 *الطلبات (${orders.length}${orders.length === LIMIT ? '+' : ''})*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function showOrderDetail(ctx, orderId) {
  const order = db.prepare('SELECT o.*, s.name as service_name, s.price, s.duration, s.service_type FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ? AND o.user_id = ?').get(orderId, ctx.dbUser.id);
  if (!order) return ctx.editMessageText('❌ الطلب غير موجود.');

  const fields = db.prepare('SELECT * FROM service_fields WHERE service_id = ? ORDER BY sort_order').all(order.service_id);
  const fieldData = JSON.parse(order.field_data || '{}');
  const timeline = db.prepare('SELECT * FROM order_timeline WHERE order_id = ? ORDER BY created_at ASC').all(orderId);
  const rating = db.prepare('SELECT * FROM order_ratings WHERE order_id = ?').get(orderId);

  let text = `📋 *تفاصيل الطلب #${order.uuid}*\n\n`;
  text += `🛍️ الخدمة: ${order.service_name}\n`;
  text += `💰 السعر: ${formatCurrency(order.price)}\n`;
  text += `📅 التاريخ: ${formatDate(order.created_at)}\n`;
  text += `📊 الحالة: ${getOrderStatusText(order.status)}\n`;

  // Subscription info
  if (order.service_type === 'subscription' && order.subscription_start) {
    const start = order.subscription_start;
    const end = order.subscription_end;
    const daysLeft = end ? Math.ceil((new Date(end) - new Date()) / (1000 * 60 * 60 * 24)) : null;
    const subStatus = daysLeft === null ? '' : daysLeft < 0 ? '🔴 منتهي' : daysLeft <= 7 ? '🟡 ينتهي قريباً' : '🟢 نشط';
    text += `\n📅 *الاشتراك:*\n`;
    text += `• البداية: ${start}\n`;
    text += `• الانتهاء: ${end || '-'}\n`;
    if (daysLeft !== null) text += `• المتبقي: ${daysLeft > 0 ? daysLeft + ' يوم' : 'منتهي'} ${subStatus}\n`;
  }

  // Delivery details
  if (order.delivery_details) {
    text += `\n📦 *تفاصيل التسليم:*\n${order.delivery_details}\n`;
  }

  if (order.admin_note) text += `\n📝 ملاحظة الإدارة: ${order.admin_note}\n`;

  // Field data
  if (fields.length) {
    text += '\n📝 *البيانات المدخلة:*\n';
    for (const f of fields) {
      if (fieldData[f.field_key]) text += `• ${f.label}: ${f.type === 'password' ? '••••••' : fieldData[f.field_key]}\n`;
    }
  }

  // Timeline
  if (timeline.length) {
    const timelineIcons = { pending: '⏳', accepted: '✅', processing: '🔄', completed: '✔️', rejected: '❌' };
    text += '\n📌 *مراحل الطلب:*\n';
    for (const t of timeline) {
      text += `${timelineIcons[t.status] || '•'} ${getOrderStatusText(t.status)} — ${formatDate(t.created_at)}\n`;
    }
  }

  // Rating
  if (rating) {
    text += `\n⭐ تقييمك: ${'⭐'.repeat(rating.rating)}${rating.comment ? '\n💬 ' + rating.comment : ''}\n`;
  }

  const buttons = [[Markup.button.callback('🔙 رجوع', 'orders_all')]];
  if (order.status === 'completed' && !rating) {
    buttons.unshift([Markup.button.callback('⭐ تقييم الخدمة', `rate_order_start_${orderId}`)]);
  }
  buttons.push([Markup.button.callback('📞 تواصل مع الدعم', 'send_support_msg')]);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

module.exports = { showOrders, showOrdersByStatus, showOrderDetail };
