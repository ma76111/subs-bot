const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { servicesMenuKeyboard, serviceItemKeyboard, fieldsMenuKeyboard, fieldTypeKeyboard } = require('../../keyboards/admin');
const { formatCurrency, now, SessionMap } = require('../../utils/helpers');

// Multi-step session for adding/editing services and fields — auto-expire after 15 minutes
const adminSessions = new SessionMap();

async function showServicesMenu(ctx) {
  try { await ctx.editMessageText('⚙️ *إدارة الخدمات*', { parse_mode: 'Markdown', ...servicesMenuKeyboard() }); }
  catch { await ctx.reply('⚙️ *إدارة الخدمات*', { parse_mode: 'Markdown', ...servicesMenuKeyboard() }); }
}

async function showServicesList(ctx) {
  const services = db.prepare(`
    SELECT s.*, c.name as cat_name FROM services s
    LEFT JOIN categories c ON s.category_id = c.id
    ORDER BY s.sort_order, s.id
  `).all();

  if (!services.length) {
    return ctx.editMessageText('لا توجد خدمات. أضف خدمة جديدة.', { ...Markup.inlineKeyboard([[Markup.button.callback('➕ إضافة خدمة', 'admin_services_add'), Markup.button.callback('🔙 رجوع', 'admin_services')]]) });
  }

  const buttons = services.map(s => [Markup.button.callback(`${s.is_active ? '🟢' : '🔴'} ${s.name} - ${formatCurrency(s.price)}`, `admin_svc_view_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ إضافة خدمة', 'admin_services_add')]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_services')]);

  try { await ctx.editMessageText('📋 *قائمة الخدمات:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
  catch { await ctx.reply('📋 *قائمة الخدمات:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
}

async function showServiceItem(ctx, serviceId) {
  const svc = db.prepare('SELECT s.*, c.name as cat_name FROM services s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?').get(serviceId);
  if (!svc) return ctx.reply('❌ الخدمة غير موجودة.');
  const fieldsCount = db.prepare('SELECT COUNT(*) as c FROM service_fields WHERE service_id = ?').get(serviceId).c;
  const typeText = svc.service_type === 'subscription' ? '🔄 اشتراك' : '1️⃣ مرة واحدة';
  const durationText = svc.service_type === 'subscription'
    ? `\n⏱️ المدة: ${svc.duration || '-'} (${svc.duration_days ? svc.duration_days + ' يوم' : 'غير محدد'})`
    : '';
  const text = `⚙️ *${svc.name}*\n\n📝 ${svc.description || 'لا يوجد وصف'}\n💰 السعر: ${formatCurrency(svc.price)}\n📌 النوع: ${typeText}${durationText}\n📁 التصنيف: ${svc.cat_name || '-'}\n📋 الحقول: ${fieldsCount}\n🔘 الحالة: ${svc.is_active ? '🟢 مفعل' : '🔴 موقوف'}`;
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...serviceItemKeyboard(svc) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...serviceItemKeyboard(svc) }); }
}

async function startAddService(ctx) {
  adminSessions.set(ctx.from.id, { action: 'add_service', step: 'name' });
  try { await ctx.editMessageText('➕ *إضافة خدمة جديدة*\n\nأدخل اسم الخدمة:', { parse_mode: 'Markdown' }); }
  catch { await ctx.reply('➕ *إضافة خدمة جديدة*\n\nأدخل اسم الخدمة:', { parse_mode: 'Markdown' }); }
}

async function startEditService(ctx, serviceId) {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  adminSessions.set(ctx.from.id, { action: 'edit_service', serviceId, step: 'field' });
  const text = `✏️ *تعديل خدمة: ${svc.name}*\n\nاختر ما تريد تعديله:`;
  const buttons = [
    [Markup.button.callback('📛 الاسم', `svc_edit_field_name_${serviceId}`), Markup.button.callback('📝 الوصف', `svc_edit_field_desc_${serviceId}`)],
    [Markup.button.callback('💰 السعر', `svc_edit_field_price_${serviceId}`), Markup.button.callback('⏱️ المدة', `svc_edit_field_duration_${serviceId}`)],
    [Markup.button.callback('🔢 أيام الاشتراك', `svc_edit_field_duration_days_${serviceId}`)],
    [Markup.button.callback('🔙 رجوع', `admin_svc_view_${serviceId}`)],
  ];
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
}

async function startEditServiceField(ctx, field, serviceId) {
  adminSessions.set(ctx.from.id, { action: 'edit_service', serviceId, step: 'value', field });
  const labels = { name: 'الاسم', desc: 'الوصف', price: 'السعر', duration: 'المدة' };
  await ctx.reply(`✏️ أدخل القيمة الجديدة لـ *${labels[field] || field}*:`, { parse_mode: 'Markdown' });
}

async function toggleService(ctx, serviceId) {
  const svc = db.prepare('SELECT is_active FROM services WHERE id = ?').get(serviceId);
  db.prepare('UPDATE services SET is_active = ?, updated_at = ? WHERE id = ?').run(svc.is_active ? 0 : 1, now(), serviceId);
  await showServiceItem(ctx, serviceId);
}

async function deleteService(ctx, serviceId) {
  const svc = db.prepare('SELECT name FROM services WHERE id = ?').get(serviceId);
  db.prepare('DELETE FROM services WHERE id = ?').run(serviceId);
  try { await ctx.editMessageText(`🗑️ تم حذف الخدمة "${svc.name}" بنجاح.`); }
  catch { await ctx.reply(`🗑️ تم حذف الخدمة "${svc.name}" بنجاح.`); }
}

// --- Fields management ---
async function showFieldsMenu(ctx, serviceId) {
  const svc = db.prepare('SELECT name FROM services WHERE id = ?').get(serviceId);
  const fields = db.prepare('SELECT * FROM service_fields WHERE service_id = ? ORDER BY sort_order').all(serviceId);
  const text = `📝 *حقول خدمة: ${svc.name}*\n\nعدد الحقول: ${fields.length}`;
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...fieldsMenuKeyboard(serviceId, fields) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...fieldsMenuKeyboard(serviceId, fields) }); }
}

async function startAddField(ctx, serviceId) {
  adminSessions.set(ctx.from.id, { action: 'add_field', serviceId, step: 'type' });
  try { await ctx.editMessageText('➕ *إضافة حقل جديد*\n\nاختر نوع الحقل:', { parse_mode: 'Markdown', ...fieldTypeKeyboard(serviceId) }); }
  catch { await ctx.reply('➕ *إضافة حقل جديد*\n\nاختر نوع الحقل:', { parse_mode: 'Markdown', ...fieldTypeKeyboard(serviceId) }); }
}

async function setFieldType(ctx, serviceId, fieldType) {
  adminSessions.set(ctx.from.id, { action: 'add_field', serviceId, fieldType, step: 'label' });
  await ctx.reply(`✅ النوع: *${fieldType}*\n\nأدخل اسم الحقل (label):`, { parse_mode: 'Markdown' });
}

async function showFieldEdit(ctx, fieldId) {
  const field = db.prepare('SELECT * FROM service_fields WHERE id = ?').get(fieldId);
  if (!field) return ctx.reply('❌ الحقل غير موجود.');
  const text = `📝 *تعديل الحقل: ${field.label}*\n\nالنوع: ${field.type}\nمطلوب: ${field.is_required ? 'نعم' : 'لا'}`;
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🗑️ حذف الحقل', `admin_field_delete_${fieldId}`)],
      [Markup.button.callback('🔙 رجوع', `admin_svc_fields_${field.service_id}`)],
    ]),
  });
}

async function deleteField(ctx, fieldId) {
  const field = db.prepare('SELECT * FROM service_fields WHERE id = ?').get(fieldId);
  db.prepare('DELETE FROM service_fields WHERE id = ?').run(fieldId);
  await ctx.editMessageText(`🗑️ تم حذف الحقل "${field.label}".`);
}

async function handleAdminServiceInput(ctx) {
  const session = adminSessions.get(ctx.from.id);
  if (!session) return false;

  const text = ctx.message.text;

  // Add Service flow
  if (session.action === 'add_service') {
    if (session.step === 'name') {
      session.name = text; session.step = 'description';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('📝 أدخل وصف الخدمة (أو "-" لتخطي):');
      return true;
    }
    if (session.step === 'description') {
      session.description = text === '-' ? null : text; session.step = 'price';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('💰 أدخل سعر الخدمة (بالجنيه):');
      return true;
    }
    if (session.step === 'price') {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) { await ctx.reply('❗ أدخل سعراً صحيحاً:'); return true; }
      session.price = price; session.step = 'service_type';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('📌 اختر نوع الخدمة:', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 اشتراك', 'svc_type_subscription')],
          [Markup.button.callback('1️⃣ خدمة لمرة واحدة', 'svc_type_onetime')],
        ]),
      });
      return true;
    }
    if (session.step === 'duration') {
      session.duration = text === '-' ? null : text; session.step = 'duration_days';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('🔢 أدخل مدة الاشتراك بالأيام (مثال: 30، 90، 365):\n_يُستخدم في حساب تاريخ الانتهاء_', { parse_mode: 'Markdown' });
      return true;
    }
    if (session.step === 'duration_days') {
      const days = parseInt(text);
      if (isNaN(days) || days <= 0) { await ctx.reply('❗ أدخل عدد أيام صحيح:'); return true; }
      session.duration_days = days; session.step = 'category';
      adminSessions.set(ctx.from.id, session);
      const cats = db.prepare('SELECT * FROM categories WHERE is_active = 1').all();
      const buttons = cats.map(c => [Markup.button.callback(`${c.icon} ${c.name}`, `svc_setcat_${c.id}`)]);
      buttons.push([Markup.button.callback('➕ بدون فئة', 'svc_setcat_0')]);
      await ctx.reply('📁 اختر الفئة:', { ...Markup.inlineKeyboard(buttons) });
      return true;
    }
  }

  // Edit Service flow
  if (session.action === 'edit_service' && session.step === 'value') {
    const { serviceId, field } = session;
    adminSessions.delete(ctx.from.id);
    if (field === 'price') {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) { await ctx.reply('❗ سعر غير صحيح.'); return true; }
      db.prepare('UPDATE services SET price = ?, updated_at = ? WHERE id = ?').run(price, now(), serviceId);
    } else if (field === 'name') {
      db.prepare('UPDATE services SET name = ?, updated_at = ? WHERE id = ?').run(text, now(), serviceId);
    } else if (field === 'desc') {
      db.prepare('UPDATE services SET description = ?, updated_at = ? WHERE id = ?').run(text, now(), serviceId);
    } else if (field === 'duration') {
      db.prepare('UPDATE services SET duration = ?, updated_at = ? WHERE id = ?').run(text, now(), serviceId);
    } else if (field === 'duration_days') {
      const days = parseInt(text);
      if (isNaN(days) || days <= 0) { await ctx.reply('❗ عدد أيام غير صحيح.'); return true; }
      db.prepare('UPDATE services SET duration_days = ?, updated_at = ? WHERE id = ?').run(days, now(), serviceId);
    }
    await ctx.reply('✅ تم التعديل بنجاح.');
    await showServiceItem(ctx, serviceId);
    return true;
  }

  // Add Field flow
  if (session.action === 'add_field') {
    if (session.step === 'label') {
      session.label = text; session.step = 'key';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('🔑 أدخل مفتاح الحقل (بالإنجليزية، مثل: email, phone):');
      return true;
    }
    if (session.step === 'key') {
      session.key = text.replace(/\s/g, '_').toLowerCase(); session.step = 'required';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('❓ هل الحقل مطلوب؟', {
        ...Markup.inlineKeyboard([[Markup.button.callback('✅ نعم', 'field_required_1'), Markup.button.callback('⏭️ لا', 'field_required_0')]]),
      });
      return true;
    }
    if (session.step === 'regex_pattern') {
      // Validate the pattern
      try { new RegExp(text); } catch {
        await ctx.reply('❌ نمط غير صحيح. أدخل نمط regex صحيح:');
        return true;
      }
      session.regex_pattern = text;
      session.step = 'placeholder';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('✏️ أدخل النص التوضيحي للحقل (placeholder) أو "-" لتخطي:');
      return true;
    }
    if (session.step === 'placeholder') {
      session.placeholder = text === '-' ? null : text;

      // Validate regex pattern if field type is regex
      if (session.fieldType === 'regex' && session.regex_pattern) {
        try { new RegExp(session.regex_pattern); } catch {
          adminSessions.delete(ctx.from.id);
          await ctx.reply('❌ نمط الـ regex غير صحيح. أعد المحاولة من البداية.');
          return true;
        }
      }

      // Finalize add field
      adminSessions.delete(ctx.from.id);
      const sortOrder = db.prepare('SELECT COUNT(*) as c FROM service_fields WHERE service_id = ?').get(session.serviceId).c;
      db.prepare('INSERT INTO service_fields (service_id, field_key, label, type, is_required, placeholder, regex_pattern, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(session.serviceId, session.key, session.label, session.fieldType, session.required, session.placeholder, session.regex_pattern || null, sortOrder);
      await ctx.reply('✅ تم إضافة الحقل بنجاح!');
      await showFieldsMenu(ctx, session.serviceId);
      return true;
    }
    if (session.step === 'options' && (session.fieldType === 'select' || session.fieldType === 'multiselect')) {
      const options = text.split('\n').map(o => o.trim()).filter(Boolean);
      session.options = JSON.stringify(options); session.step = 'placeholder';
      adminSessions.set(ctx.from.id, session);
      await ctx.reply('✏️ أدخل النص التوضيحي للحقل (placeholder) أو "-" لتخطي:');
      return true;
    }
  }

  return false;
}

function handleAdminServiceCallback(ctx, data) {
  const session = adminSessions.get(ctx.from.id);

  if (data.startsWith('svc_setcat_')) {
    if (!session || session.action !== 'add_service') return false;
    const catId = parseInt(data.split('_')[2]) || null;
    adminSessions.delete(ctx.from.id);
    db.prepare('INSERT INTO services (name, description, price, service_type, duration, duration_days, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      session.name, session.description, session.price,
      session.service_type || 'subscription',
      session.duration || null, session.duration_days || null, catId
    );
    ctx.reply('✅ تم إضافة الخدمة بنجاح! يمكنك الآن إضافة الحقول من إدارة الحقول.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 للخدمات', 'admin_services_list')]]) });
    return true;
  }

  if (data.startsWith('svc_type_')) {
    if (!session || session.action !== 'add_service') return false;
    session.service_type = data.replace('svc_type_', '');
    if (session.service_type === 'subscription') {
      session.step = 'duration';
      adminSessions.set(ctx.from.id, session);
      ctx.reply('⏱️ أدخل مدة العرض للمستخدم (مثال: شهر، 3 أشهر، سنة):');
    } else {
      // onetime — skip duration
      session.step = 'category';
      session.duration = null; session.duration_days = null;
      adminSessions.set(ctx.from.id, session);
      const cats = db.prepare('SELECT * FROM categories WHERE is_active = 1').all();
      const buttons = cats.map(c => [Markup.button.callback(`${c.icon} ${c.name}`, `svc_setcat_${c.id}`)]);
      buttons.push([Markup.button.callback('➕ بدون فئة', 'svc_setcat_0')]);
      ctx.reply('📁 اختر الفئة:', { ...Markup.inlineKeyboard(buttons) });
    }
    return true;
  }

  if (data.startsWith('svc_edit_field_')) {
    const parts = data.split('_');
    // format: svc_edit_field_{fieldname}_{serviceId}
    // field could be 'duration_days' (two parts) or single word
    const serviceId = parseInt(parts[parts.length - 1]);
    const field = parts.slice(3, parts.length - 1).join('_');
    startEditServiceField(ctx, field, serviceId);
    return true;
  }

  if (data.startsWith('admin_fieldtype_')) {
    const parts = data.replace('admin_fieldtype_', '').split('_');
    const serviceId = parseInt(parts[0]);
    const fieldType = parts.slice(1).join('_');
    setFieldType(ctx, serviceId, fieldType);
    return true;
  }

  if (data.startsWith('field_required_')) {
    if (!session || session.action !== 'add_field') return false;
    session.required = parseInt(data.split('_')[2]);

    // If type is regex, ask for the pattern first
    if (session.fieldType === 'regex') {
      session.step = 'regex_pattern';
      adminSessions.set(ctx.from.id, session);
      ctx.reply('🔍 أدخل نمط الـ regex (مثال: `^[a-z]+$`):', { parse_mode: 'Markdown' });
      return true;
    }

    if (session.fieldType === 'select' || session.fieldType === 'multiselect') {
      session.step = 'options';
      adminSessions.set(ctx.from.id, session);
      ctx.reply('📋 أدخل خيارات القائمة (كل خيار في سطر منفصل):');
    } else {
      session.step = 'placeholder';
      adminSessions.set(ctx.from.id, session);
      ctx.reply('✏️ أدخل النص التوضيحي للحقل (placeholder) أو "-" لتخطي:');
    }
    return true;
  }

  return false;
}

module.exports = {
  showServicesMenu, showServicesList, showServiceItem, startAddService, startEditService,
  toggleService, deleteService, showFieldsMenu, startAddField, showFieldEdit, deleteField,
  handleAdminServiceInput, handleAdminServiceCallback,
};
