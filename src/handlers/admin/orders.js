const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { adminMainMenu, ordersListKeyboard, orderActionKeyboard } = require('../../keyboards/admin');
const { formatCurrency, formatDate, getOrderStatusText, sendNotification, now, SessionMap } = require('../../utils/helpers');

const PER_PAGE = 5;

// Add a timeline entry for an order
function addTimeline(orderId, status, note = null) {
  db.prepare('INSERT INTO order_timeline (order_id, status, note, created_at) VALUES (?, ?, ?, ?)').run(orderId, status, note, now());
}

// Sessions for admin notes/delivery — auto-expire after 15 minutes
const noteSessions = new SessionMap();

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
  if (order.delivery_details) text += `\n📦 تفاصيل التسليم:\n${order.delivery_details}\n`;
  if (order.subscription_start) {
    text += `\n📅 بداية الاشتراك: ${order.subscription_start}\n`;
    text += `📅 نهاية الاشتراك: ${order.subscription_end || '-'}\n`;
  }

  if (fields.length) {
    text += '\n📝 *البيانات المدخلة:*\n';
    for (const f of fields) {
      if (fieldData[f.field_key]) text += `• ${f.label}: \`${fieldData[f.field_key]}\`\n`;
    }
  }

  const timeline = db.prepare('SELECT * FROM order_timeline WHERE order_id = ? ORDER BY created_at ASC').all(orderId);
  const timelineIcons = { pending: '⏳', accepted: '✅', processing: '🔄', completed: '✔️', rejected: '❌' };
  if (timeline.length) {
    text += '\n📌 *Timeline:*\n';
    for (const t of timeline) {
      text += `${timelineIcons[t.status] || '•'} ${getOrderStatusText(t.status)} — ${formatDate(t.created_at)}\n`;
    }
  }
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...orderActionKeyboard(order) });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', ...orderActionKeyboard(order) });
  }
}

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
  addTimeline(orderId, 'accepted');
  sendNotification(null, order.user_id,
    `✅ *تم قبول طلبك!*\n\n🛍️ ${order.service_name}\n🔖 #${order.uuid}\n\nطلبك الآن قيد التنفيذ.`,
    { orderId: order.id, uuid: order.uuid }
  );
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
  addTimeline(orderId, 'processing');
  sendNotification(null, order.user_id,
    `🔄 *بدأ تنفيذ طلبك!*\n\n🛍️ ${order.service_name}\n🔖 #${order.uuid}\n\nفريقنا يعمل على طلبك الآن.`,
    { orderId: order.id, uuid: order.uuid }
  );
  await ctx.editMessageText(`🔄 تم تغيير حالة الطلب #${order.uuid} إلى "جاري التنفيذ"`);
}

async function completeOrder(ctx, orderId) {
  // Check status first before asking for delivery details
  const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  if (!check || check.status !== 'processing') {
    try { await ctx.editMessageText('⚠️ يجب أن يكون الطلب "جاري التنفيذ" أولاً.'); } catch {}
    return;
  }
  const order = db.prepare('SELECT o.*, s.service_type, s.duration, s.duration_days, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ?').get(orderId);

  if (order.service_type === 'subscription' && order.duration_days) {
    noteSessions.set(ctx.from.id, { type: 'order_complete_sub', orderId, durationDays: order.duration_days });
    try { await ctx.editMessageText(`📅 *تاريخ بدء الاشتراك*\n\nأدخل تاريخ البداية بصيغة YYYY-MM-DD\nأو أرسل "-" لاستخدام تاريخ اليوم:`); }
    catch { await ctx.reply(`📅 أدخل تاريخ بدء الاشتراك (YYYY-MM-DD) أو "-" لليوم:`); }
  } else {
    noteSessions.set(ctx.from.id, { type: 'order_complete_delivery', orderId });
    try { await ctx.editMessageText('📦 *تفاصيل التسليم*\n\nأدخل تفاصيل التسليم للمستخدم\n(بيانات الحساب، تعليمات، روابط، إلخ):'); }
    catch { await ctx.reply('📦 أدخل تفاصيل التسليم:'); }
  }
}

async function resendDelivery(ctx, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !order.delivery_details) return ctx.reply('❌ لا توجد تفاصيل تسليم لهذا الطلب.');
  noteSessions.set(ctx.from.id, { type: 'order_edit_delivery', orderId });
  try { await ctx.editMessageText(`📦 *تعديل/إعادة إرسال التسليم*\n\nالتفاصيل الحالية:\n${order.delivery_details}\n\nأدخل التفاصيل الجديدة:`); }
  catch { await ctx.reply(`📦 أدخل تفاصيل التسليم الجديدة:`); }
}

async function handleAdminNoteInput(ctx) {
  const session = noteSessions.get(ctx.from.id);
  if (!session) return false;

  const text = ctx.message.text?.trim();

  // ── Reject order ──
  if (session.type === 'order_reject') {
    noteSessions.delete(ctx.from.id);
    const note = text === '-' ? null : text;
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
    addTimeline(session.orderId, 'rejected', note);
    sendNotification(null, orderData.user_id,
      `❌ *تم رفض طلبك*\n\n🛍️ ${orderData.service_name}\n🔖 #${orderData.uuid}${note ? '\n\n📝 السبب: ' + note : ''}\n\n💰 تم استرداد المبلغ لرصيدك.`,
      { orderId: orderData.id, uuid: orderData.uuid }
    );
    await ctx.reply(`❌ تم رفض الطلب #${orderData.uuid} وتم استرداد المبلغ.`);
    return true;
  }

  // ── Complete — subscription: ask start date ──
  if (session.type === 'order_complete_sub') {
    noteSessions.delete(ctx.from.id);
    let startDate;
    if (text === '-') {
      startDate = now().split('T')[0]; // today YYYY-MM-DD
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        await ctx.reply('❗ صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD أو "-" لليوم:');
        noteSessions.set(ctx.from.id, session); // restore session
        return true;
      }
      startDate = text;
    }
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + session.durationDays);
    const endDateStr = endDate.toISOString().split('T')[0];

    // Now ask for delivery details
    noteSessions.set(ctx.from.id, {
      type: 'order_complete_delivery',
      orderId: session.orderId,
      subscriptionStart: startDate,
      subscriptionEnd: endDateStr,
    });
    await ctx.reply(`📅 تاريخ البداية: ${startDate}\n📅 تاريخ الانتهاء: ${endDateStr}\n\n📦 الآن أدخل تفاصيل التسليم:`);
    return true;
  }

  // ── Complete — delivery details ──
  if (session.type === 'order_complete_delivery') {
    noteSessions.delete(ctx.from.id);
    const delivery = text;
    if (!delivery) { await ctx.reply('❗ تفاصيل التسليم لا يمكن أن تكون فارغة.'); return true; }

    const order = db.prepare('SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id WHERE o.id = ?').get(session.orderId);
    try {
      db.transaction(() => {
        const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(session.orderId);
        if (!check || check.status !== 'processing') throw new Error('invalid_status');
        db.prepare(`UPDATE orders SET status = "completed", delivery_details = ?,
          subscription_start = ?, subscription_end = ?, updated_at = ? WHERE id = ?`)
          .run(delivery, session.subscriptionStart || null, session.subscriptionEnd || null, now(), session.orderId);
      });
    } catch (e) {
      await ctx.reply('❌ حدث خطأ أثناء إكمال الطلب.'); return true;
    }

    addTimeline(session.orderId, 'completed', delivery);

    let notifMsg = `✔️ *تم إكمال طلبك بنجاح!*\n\n🛍️ ${order.service_name}\n🔖 #${order.uuid}\n\n📦 *تفاصيل التسليم:*\n${delivery}`;
    if (session.subscriptionStart) {
      notifMsg += `\n\n📅 تاريخ البداية: ${session.subscriptionStart}\n📅 تاريخ الانتهاء: ${session.subscriptionEnd}`;
    }
    notifMsg += '\n\n⭐ يسعدنا تقييمك للخدمة!';
    sendNotification(null, order.user_id, notifMsg, { orderId: order.id, uuid: order.uuid });

    // Send rating prompt after a moment
    const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(order.user_id);
    if (user) {
      const { getBot } = require('../../config/bot-instance');
      const bot = getBot();
      if (bot) {
        setTimeout(() => {
          bot.telegram.sendMessage(user.telegram_id,
            `⭐ *كيف كانت تجربتك مع "${order.service_name}"؟*\n\nاختر تقييمك:`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [1, 2, 3, 4, 5].map(n => Markup.button.callback('⭐'.repeat(n), `rate_order_${order.id}_${n}`)),
              ]),
            }
          ).catch(() => {});
        }, 3000);
      }
    }

    await ctx.reply(`✔️ تم إكمال الطلب #${order.uuid} وإرسال التفاصيل للمستخدم.`);
    return true;
  }

  // ── Edit/resend delivery ──
  if (session.type === 'order_edit_delivery') {
    noteSessions.delete(ctx.from.id);
    const delivery = text;
    if (!delivery) { await ctx.reply('❗ لا يمكن أن تكون فارغة.'); return true; }
    db.prepare('UPDATE orders SET delivery_details = ?, updated_at = ? WHERE id = ?').run(delivery, now(), session.orderId);
    const order = db.prepare('SELECT o.*, s.name as service_name, u.telegram_id as user_telegram FROM orders o JOIN services s ON o.service_id = s.id JOIN users u ON o.user_id = u.id WHERE o.id = ?').get(session.orderId);
    const { getBot } = require('../../config/bot-instance');
    const bot = getBot();
    if (bot && order) {
      bot.telegram.sendMessage(order.user_telegram,
        `📦 *تحديث تفاصيل تسليم طلبك #${order.uuid}*\n\n${delivery}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
    await ctx.reply('✅ تم تحديث تفاصيل التسليم وإعادة إرسالها للمستخدم.');
    return true;
  }

  return false;
}

function hasNoteSession(adminId) { return noteSessions.has(adminId); }

module.exports = { showAdminOrders, showOrderDetail, acceptOrder, rejectOrder, processOrder, completeOrder, resendDelivery, handleAdminNoteInput, hasNoteSession };
