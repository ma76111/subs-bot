const { Markup } = require('telegraf');

const adminMainMenu = () => Markup.keyboard([
  ['📋 الطلبات', '💳 طلبات الشحن'],
  ['⚙️ الخدمات', '👥 المستخدمون'],
  ['📢 الإشعارات', '📊 الإحصائيات'],
  ['🔧 الإعدادات', '🏠 خروج'],
]).resize();

function ordersListKeyboard(orders, page = 0, total = 0, perPage = 5) {
  const buttons = orders.map(o => [Markup.button.callback(`#${o.uuid} - ${o.service_name} - ${o.status_text}`, `admin_order_${o.id}`)]);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `orders_page_${page - 1}`));
  if ((page + 1) * perPage < total) nav.push(Markup.button.callback('▶️ التالي', `orders_page_${page + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_back')]);
  return Markup.inlineKeyboard(buttons);
}

function orderActionKeyboard(order) {
  const buttons = [];
  if (order.status === 'pending') {
    buttons.push([Markup.button.callback('✅ قبول', `admin_order_accept_${order.id}`), Markup.button.callback('❌ رفض', `admin_order_reject_${order.id}`)]);
  }
  if (order.status === 'accepted') {
    buttons.push([Markup.button.callback('🔄 بدء التنفيذ', `admin_order_process_${order.id}`)]);
  }
  if (order.status === 'processing') {
    buttons.push([Markup.button.callback('✔️ تم التنفيذ', `admin_order_complete_${order.id}`)]);
  }
  buttons.push([Markup.button.callback('🔙 رجوع للطلبات', 'admin_orders')]);
  return Markup.inlineKeyboard(buttons);
}

function chargeActionKeyboard(charge) {
  const buttons = [];
  if (charge.status === 'pending') {
    buttons.push([Markup.button.callback('✅ قبول الشحن', `admin_charge_accept_${charge.id}`), Markup.button.callback('❌ رفض', `admin_charge_reject_${charge.id}`)]);
  }
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_charges')]);
  return Markup.inlineKeyboard(buttons);
}

function servicesMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 عرض الخدمات', 'admin_services_list')],
    [Markup.button.callback('➕ إضافة خدمة', 'admin_services_add')],
    [Markup.button.callback('📁 إدارة الفئات', 'admin_categories')],
    [Markup.button.callback('🔙 رجوع', 'admin_back')],
  ]);
}

function serviceItemKeyboard(service) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ تعديل', `admin_svc_edit_${service.id}`), Markup.button.callback('🗑️ حذف', `admin_svc_delete_${service.id}`)],
    [Markup.button.callback(service.is_active ? '🔴 إيقاف' : '🟢 تشغيل', `admin_svc_toggle_${service.id}`)],
    [Markup.button.callback('📝 إدارة الحقول', `admin_svc_fields_${service.id}`)],
    [Markup.button.callback('🔙 رجوع للخدمات', 'admin_services_list')],
  ]);
}

function fieldsMenuKeyboard(serviceId, fields) {
  const buttons = fields.map(f => [Markup.button.callback(`${f.label} (${f.type})`, `admin_field_edit_${f.id}`)]);
  buttons.push([Markup.button.callback('➕ إضافة حقل', `admin_field_add_${serviceId}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع للخدمة', `admin_svc_view_${serviceId}`)]);
  return Markup.inlineKeyboard(buttons);
}

function fieldTypeKeyboard(serviceId) {
  const types = [
    ['text', '📝 نص'], ['number', '🔢 أرقام'], ['alphanumeric', '🔤 نص وأرقام'],
    ['email', '📧 بريد إلكتروني'], ['password', '🔑 كلمة مرور'], ['phone', '📱 رقم هاتف'],
    ['url', '🔗 رابط URL'], ['image', '🖼️ صورة'], ['file', '📎 ملف'],
    ['textarea', '📄 نص متعدد'], ['select', '📋 اختيار واحد'], ['multiselect', '☑️ اختيارات متعددة'],
    ['date', '📅 تاريخ'], ['regex', '🔍 نمط مخصص'],
  ];
  const rows = [];
  for (let i = 0; i < types.length; i += 2) {
    const row = [Markup.button.callback(types[i][1], `admin_fieldtype_${serviceId}_${types[i][0]}`)];
    if (types[i + 1]) row.push(Markup.button.callback(types[i + 1][1], `admin_fieldtype_${serviceId}_${types[i + 1][0]}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback('🔙 رجوع', `admin_svc_fields_${serviceId}`)]);
  return Markup.inlineKeyboard(rows);
}

function usersMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 عرض المستخدمين', 'admin_users_list')],
    [Markup.button.callback('🔍 بحث عن مستخدم', 'admin_users_search')],
    [Markup.button.callback('🔙 رجوع', 'admin_back')],
  ]);
}

function userActionKeyboard(user) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💰 تعديل الرصيد', `admin_user_balance_${user.id}`)],
    [Markup.button.callback(user.is_banned ? '✅ فك الحظر' : '🚫 حظر', `admin_user_ban_${user.id}`)],
    [Markup.button.callback('📦 عرض الطلبات', `admin_user_orders_${user.id}`)],
    [Markup.button.callback('🔙 رجوع', 'admin_users_list')],
  ]);
}

function settingsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💳 المحافظ الإلكترونية', 'admin_wallets')],
    [Markup.button.callback('👨‍💼 الأدمنز', 'admin_admins')],
    [Markup.button.callback('📝 نصوص البوت', 'admin_texts')],
    [Markup.button.callback('📊 الإحصائيات', 'admin_stats')],
    [Markup.button.callback('🔙 رجوع', 'admin_back')],
  ]);
}

module.exports = {
  adminMainMenu, ordersListKeyboard, orderActionKeyboard, chargeActionKeyboard,
  servicesMenuKeyboard, serviceItemKeyboard, fieldsMenuKeyboard, fieldTypeKeyboard,
  usersMenuKeyboard, userActionKeyboard, settingsMenuKeyboard,
};
