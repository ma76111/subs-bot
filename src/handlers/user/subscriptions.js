const { db } = require('../../config/database');
const { categoriesKeyboard, servicesKeyboard, serviceDetailKeyboard, orderConfirmKeyboard } = require('../../keyboards/user');
const { formatCurrency, generateUUID, validateField } = require('../../utils/helpers');

// Session store for order form state
const orderSessions = new Map();

// Auto-expire sessions after 30 minutes
const SESSION_TTL = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of orderSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      orderSessions.delete(userId);
    }
  }
}, 5 * 60 * 1000);

async function showCategories(ctx) {
  const cats = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
  if (!cats.length) return ctx.reply('لا توجد فئات متاحة حالياً.');
  await ctx.reply('🛍️ *اختر الفئة:*', { parse_mode: 'Markdown', ...categoriesKeyboard(cats) });
}

async function showServices(ctx, categoryId) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  const services = db.prepare('SELECT * FROM services WHERE category_id = ? AND is_active = 1 ORDER BY sort_order').all(categoryId);
  if (!services.length) return ctx.editMessageText('لا توجد خدمات في هذه الفئة حالياً.', { ...servicesKeyboard([], categoryId) });
  await ctx.editMessageText(`${cat.icon} *${cat.name}*\n\nاختر الخدمة:`, { parse_mode: 'Markdown', ...servicesKeyboard(services, categoryId) });
}

async function showServiceDetail(ctx, serviceId) {
  const svc = db.prepare('SELECT s.*, c.name as cat_name FROM services s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?').get(serviceId);
  if (!svc) return ctx.editMessageText('❌ الخدمة غير موجودة.');
  const typeText = svc.service_type === 'subscription' ? '🔄 اشتراك' : '1️⃣ مرة واحدة';
  const durationLine = svc.service_type === 'subscription' && svc.duration ? `\n⏱️ المدة: *${svc.duration}*` : '';
  const text = `*${svc.name}*\n\n📝 ${svc.description || 'لا يوجد وصف'}\n\n💰 السعر: *${formatCurrency(svc.price)}*\n📌 النوع: ${typeText}${durationLine}\n📁 التصنيف: ${svc.cat_name || '-'}`;
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...serviceDetailKeyboard(serviceId) });
}

async function startOrderForm(ctx, serviceId) {
  const userId = ctx.dbUser.id;

  // Re-check ban status
  const freshUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (freshUser.is_banned) return ctx.reply('🚫 تم حظر حسابك.');

  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND is_active = 1').get(serviceId);
  if (!svc) return ctx.reply('❌ الخدمة غير متاحة.');

  // Limit pending orders per user (max 5)
  const pendingCount = db.prepare('SELECT COUNT(*) as c FROM orders WHERE user_id = ? AND status = "pending"').get(userId).c;
  if (pendingCount >= 5) {
    return ctx.reply('⚠️ لديك 5 طلبات معلقة كحد أقصى. انتظر معالجتها قبل إضافة طلب جديد.');
  }

  if (freshUser.balance < svc.price) {
    return ctx.reply(`❗ رصيدك غير كافٍ.\nالرصيد الحالي: *${formatCurrency(freshUser.balance)}*\nسعر الخدمة: *${formatCurrency(svc.price)}*\n\nيمكنك شحن رصيدك من قسم 💰 الرصيد`, { parse_mode: 'Markdown' });
  }

  const fields = db.prepare('SELECT * FROM service_fields WHERE service_id = ? ORDER BY sort_order').all(serviceId);

  orderSessions.set(userId, {
    serviceId,
    fields,
    currentFieldIndex: 0,
    data: {},
    chatId: ctx.chat.id,
    messageId: ctx.callbackQuery?.message?.message_id,
    createdAt: Date.now(),
  });

  if (!fields.length) {
    return showOrderSummary(ctx, serviceId, {});
  }

  await askNextField(ctx, userId);
}

async function askNextField(ctx, userId) {
  const session = orderSessions.get(userId);
  if (!session) return;

  const field = session.fields[session.currentFieldIndex];
  if (!field) return showOrderSummary(ctx, session.serviceId, session.data);

  const required = field.is_required ? ' _(مطلوب)_' : ' _(اختياري)_';
  let msg = `📝 *${field.label}*${required}\n`;
  if (field.help_text) msg += `\n💡 ${field.help_text}\n`;
  if (field.placeholder) msg += `\n✏️ مثال: ${field.placeholder}`;

  if (field.type === 'select' || field.type === 'multiselect') {
    const options = JSON.parse(field.options || '[]');
    const { Markup } = require('telegraf');
    const buttons = options.map((opt, i) => [Markup.button.callback(opt, `field_option_${i}_${opt}`)]);
    if (!field.is_required) buttons.push([Markup.button.callback('⏭️ تخطي', `field_skip_${field.id}`)]);
    await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } else if (field.type === 'image') {
    const { Markup } = require('telegraf');
    const skip = !field.is_required ? [Markup.button.callback('⏭️ تخطي', `field_skip_${field.id}`)] : null;
    await ctx.reply(msg + '\n\n📸 أرسل الصورة:', { parse_mode: 'Markdown', ...(skip ? Markup.inlineKeyboard([skip]) : {}) });
  } else {
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  }
}

async function handleFieldInput(ctx, userId, value) {
  const session = orderSessions.get(userId);
  if (!session) return false;

  const field = session.fields[session.currentFieldIndex];
  if (!field) return false;

  // null value = skip (only for optional fields)
  if (value === null) {
    if (field.is_required) {
      await ctx.reply(`❗ حقل "${field.label}" مطلوب ولا يمكن تخطيه.`);
      return true;
    }
    // Skip: don't store anything for this field
    session.currentFieldIndex++;
    orderSessions.set(userId, session);
    if (session.currentFieldIndex >= session.fields.length) {
      await showOrderSummary(ctx, session.serviceId, session.data);
    } else {
      await askNextField(ctx, userId);
    }
    return true;
  }

  const error = validateField(value, field);
  if (error) {
    await ctx.reply(error);
    return true;
  }

  session.data[field.field_key] = value;
  session.currentFieldIndex++;
  orderSessions.set(userId, session);

  if (session.currentFieldIndex >= session.fields.length) {
    await showOrderSummary(ctx, session.serviceId, session.data);
  } else {
    await askNextField(ctx, userId);
  }
  return true;
}

async function showOrderSummary(ctx, serviceId, data) {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  const fields = db.prepare('SELECT * FROM service_fields WHERE service_id = ? ORDER BY sort_order').all(serviceId);

  let summary = `📋 *ملخص الطلب*\n\n🛍️ الخدمة: *${svc.name}*\n💰 السعر: *${formatCurrency(svc.price)}*\n\n`;

  if (fields.length) {
    summary += '📝 *البيانات المدخلة:*\n';
    for (const f of fields) {
      const val = data[f.field_key];
      if (val) summary += `• ${f.label}: ${f.type === 'password' ? '••••••' : val}\n`;
    }
  }

  summary += '\nهل تريد تأكيد الطلب؟';
  await ctx.reply(summary, { parse_mode: 'Markdown', ...orderConfirmKeyboard(serviceId) });
}

async function confirmOrder(ctx, serviceId) {
  const userId = ctx.dbUser.id;
  const session = orderSessions.get(userId);

  // Prevent tampering: serviceId must match what's in the session
  if (!session || session.serviceId !== serviceId) {
    return ctx.editMessageText('❌ انتهت صلاحية الطلب. ابدأ من جديد.');
  }

  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND is_active = 1').get(serviceId);
  if (!svc) return ctx.editMessageText('❌ الخدمة غير موجودة أو موقوفة.');

  // All checks + deduction happen atomically inside the transaction
  const uuid = generateUUID();
  let insufficientBalance = false;
  try {
    db.transaction(() => {
      // Re-read balance INSIDE transaction to prevent race condition
      const locked = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      if (locked.balance < svc.price) {
        insufficientBalance = true;
        throw new Error('insufficient_balance');
      }

      // Validate required fields are present
      const requiredFields = db.prepare('SELECT field_key, label FROM service_fields WHERE service_id = ? AND is_required = 1').all(serviceId);
      for (const f of requiredFields) {
        if (!session.data[f.field_key]) throw new Error(`missing_field:${f.label}`);
      }

      db.prepare('INSERT INTO orders (uuid, user_id, service_id, field_data) VALUES (?, ?, ?, ?)').run(uuid, userId, serviceId, JSON.stringify(session.data));
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(svc.price, userId);
    });
  } catch (e) {
    if (e.message === 'insufficient_balance') {
      const cur = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      return ctx.editMessageText(`❗ رصيدك غير كافٍ.\nالرصيد الحالي: *${formatCurrency(cur.balance)}*\nسعر الخدمة: *${formatCurrency(svc.price)}*`, { parse_mode: 'Markdown' });
    }
    if (e.message?.startsWith('missing_field:')) {
      const label = e.message.split(':')[1];
      return ctx.editMessageText(`❗ حقل "${label}" مطلوب. ابدأ الطلب من جديد.`);
    }
    return ctx.editMessageText('❌ حدث خطأ أثناء إنشاء الطلب. حاول مرة أخرى.');
  }

  orderSessions.delete(userId);

  await ctx.editMessageText(
    `✅ *تم إنشاء طلبك بنجاح!*\n\n🔖 رقم الطلب: \`${uuid}\`\n🛍️ الخدمة: ${svc.name}\n💰 المبلغ المخصوم: ${formatCurrency(svc.price)}\n\n⏳ طلبك قيد المراجعة، سيتم التواصل معك قريباً.`,
    { parse_mode: 'Markdown' }
  );

  // Add pending timeline entry
  const { db: dbRef } = require('../../config/database');
  dbRef.prepare('INSERT INTO order_timeline (order_id, status, created_at) VALUES ((SELECT id FROM orders WHERE uuid = ?), ?, ?)')
    .run(uuid, 'pending', new Date().toISOString());

  // Notify admins
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim()));
  const fieldData = session.data;
  const fields = db.prepare('SELECT * FROM service_fields WHERE service_id = ? ORDER BY sort_order').all(serviceId);
  let adminMsg = `🛎️ *طلب جديد #${uuid}*\n\n👤 المستخدم: ${ctx.dbUser.full_name} (@${ctx.dbUser.username || 'لا يوجد'})\n🛍️ الخدمة: ${svc.name}\n💰 السعر: ${formatCurrency(svc.price)}\n\n`;
  for (const f of fields) {
    if (fieldData[f.field_key]) adminMsg += `• ${f.label}: ${fieldData[f.field_key]}\n`;
  }
  for (const adminId of adminIds) {
    ctx.telegram.sendMessage(adminId, adminMsg, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

function getOrderSession(userId) { return orderSessions.get(userId); }
function clearOrderSession(userId) { orderSessions.delete(userId); }

module.exports = { showCategories, showServices, showServiceDetail, startOrderForm, handleFieldInput, confirmOrder, getOrderSession, clearOrderSession };
