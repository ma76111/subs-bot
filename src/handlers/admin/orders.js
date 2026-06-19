const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { adminMainMenu, ordersListKeyboard, orderActionKeyboard } = require('../../keyboards/admin');
const { formatCurrency, formatDate, getOrderStatusText, sendNotification, now, SessionMap } = require('../../utils/helpers');

const PER_PAGE = 5;

async function showAdminOrders(ctx, page = 0) {
  const total = db.prepare('SELECT COUNT(*) as c FROM orders WHERE status = "pending"').get().c;
  const orders = db.prepare(`
    SELECT o.*, s.name as service_name, u.full_name as user_name, u.username
    FROM orders o
    JOIN services s ON o.service_id = s.id
    JOIN users u ON o.user_id = u.id
    WHERE o.status = 'pending'
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(PER_PAGE, page * PER_PAGE);

  const formatted = orders.map(o => ({ ...o, status_text: getOrderStatusText(o.status) }));
  const text = `📋 *الطلبات الجديدة (${total})*`;

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...ordersListKeyboard(formatted, page, total, PER_PAGE) });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', ...ordersListKeyboard(formatted, page, total, PER_PAGE) });
  }
}

async function showOrderDetail(ctx, orderId) {
  const order = db.prepare(`
    SELECT o.*, s.name as service_name, s.price, u.full_name as user_name, u.username, u.telegram_id
    FROM orders o
    JOIN services s ON o.service_id = s.id
    JOIN users u ON o.user_id = u.id
    WHERE o.id = ?
  `).get(orderId);

  if (!order) return ctx.reply('❌ الطلب غير موجود.');

  const fields = db.prepare('SELECT * FROM service_fields WHERE service_id = ? ORDER BY sort_order').all(order.service_id);
  const fieldData = JSON.parse(order.field_data || '{}');

  let text = `📋 *تفاصيل الطلب #${order.uuid}*\n\n`;
  text += `👤 المستخدم: ${order.user_name} (@${order.username || '-'})\n`;
  text += `🆔 Telegram ID: \`${order.telegram_id}\`\n`;
  text += `🛍️ الخدمة: ${order.service_name}\n`;
  text += `💰 السعر: ${formatCurrency(order.price)}\n`;
  text += `📊 الحالة: ${getOrderStatusText(order.status)}\n`;
  text += `📅 التاريخ: ${formatDate(order.created_at)}\n`;
  if (order.admin_note) text += `\n📝 ملاحظة: ${order.admin_note}\n`;

  if (fields.length) {
    text += '\n📝 *البيانات المدخلة:*\n';
    for (const f of fields) {
      if (fieldData[f.field_key]) text += `• ${f.label}: \`${fieldData[f.field_key]}\`\n`;
    }
  }

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...orderActionKeyboard(order) });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', ...orderActionKeyboard(order) });
  }
}

// Sessions for admin notes — auto-expire after 15 minutes
const noteSessions = new SessionMap();

async function acceptOrder(ctx, orderId) {
  try {
    db.transaction(() => {
      const check = db.prepare('SELECT id FROM orders WHERE id = ? AND status = "pending"').get(orderId);
      if (!check) throw new Error('already_processed');
      db.prepare('UPDATE orders SET status = "accepted", updated_at = ? WHERE id = ?').run(now(), orderId);
    });
  } catch (e) {
    if (e.message === 'already_processed') {
      try { await ctx.editMessageText('⚠️ هذا الطلب تمت معالجته بالفعل.'); } catch {}
    }
    return;
  }
  const order = db.prepare('SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ?').get(orderId);
  sendNotification(null, order.user_id, `✅ تم قبول طلبك #${order.uuid} - ${order.service_name}`);
  await ctx.editMessageText(`✅ تم قبول الطلب #${order.uuid}`);
}

async function rejectOrder(ctx, orderId) {
  noteSessions.set(ctx.from.id, { type: 'order_reject', orderId });
  await ctx.editMessageText('📝 أدخل سبب الرفض (أو أرسل "-" لتخطي):');
}

async function processOrder(ctx, orderId) {
  try {
    db.transaction(() => {
      const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
      if (!check || check.status !== 'accepted') throw new Error('invalid_status');
      db.prepare('UPDATE orders SET status = "processing", updated_at = ? WHERE id = ?').run(now(), orderId);
    });
  } catch (e) {
    try { await ctx.editMessageText('⚠️ يجب قبول الطلب أولاً قبل بدء التنفيذ.'); } catch {}
    return;
  }
  const order = db.prepare('SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ?').get(orderId);
  sendNotification(null, order.user_id, `🔄 بدأ تنفيذ طلبك #${order.uuid} - ${order.service_name}`);
  await ctx.editMessageText(`🔄 تم تغيير حالة الطلب #${order.uuid} إلى "جاري التنفيذ"`);
}

async function completeOrder(ctx, orderId) {
  try {
    db.transaction(() => {
      const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
      if (!check || check.status !== 'processing') throw new Error('invalid_status');
      db.prepare('UPDATE orders SET status = "completed", updated_at = ? WHERE id = ?').run(now(), orderId);
    });
  } catch (e) {
    try { await ctx.editMessageText('⚠️ يجب أن يكون الطلب "جاري التنفيذ" أولاً.'); } catch {}
    return;
  }
  const order = db.prepare('SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ?').get(orderId);
  sendNotification(null, order.user_id, `✔️ تم إكمال طلبك #${order.uuid} - ${order.service_name}\nشكراً لثقتك بنا! 🎉`);
  await ctx.editMessageText(`✔️ تم إكمال الطلب #${order.uuid}`);
}

async function handleAdminNoteInput(ctx) {
  const session = noteSessions.get(ctx.from.id);
  if (!session) return false;
  noteSessions.delete(ctx.from.id);

  const note = ctx.message.text === '-' ? null : ctx.message.text;

  if (session.type === 'order_reject') {
    let orderData;
    try {
      db.transaction(() => {
        orderData = db.prepare('SELECT o.*, s.price, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ? AND o.status = "pending"').get(session.orderId);
        if (!orderData) throw new Error('already_processed');
        db.prepare('UPDATE orders SET status = "rejected", admin_note = ?, updated_at = ? WHERE id = ?').run(note, now(), session.orderId);
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(orderData.price, orderData.user_id);
      });
    } catch (e) {
      if (e.message === 'already_processed') { await ctx.reply('⚠️ الطلب تمت معالجته بالفعل.'); return true; }
      await ctx.reply('❌ حدث خطأ. حاول مرة أخرى.'); return true;
    }
    sendNotification(null, orderData.user_id, `❌ تم رفض طلبك #${orderData.uuid}${note ? '\nالسبب: ' + note : ''}\n💰 تم استرداد المبلغ لرصيدك.`);
    await ctx.reply(`❌ تم رفض الطلب #${orderData.uuid} وتم استرداد المبلغ.`);
  }

  return true;
}

function hasNoteSession(adminId) { return noteSessions.has(adminId); }

module.exports = { showAdminOrders, showOrderDetail, acceptOrder, rejectOrder, processOrder, completeOrder, handleAdminNoteInput, hasNoteSession };
