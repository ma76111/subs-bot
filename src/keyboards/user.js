const { Markup } = require('telegraf');
const { db } = require('../config/database');

const mainMenu = () => Markup.keyboard([
  ['🛍️ الاشتراكات', '💰 الرصيد'],
  ['📦 طلباتي', '🔔 الإشعارات'],
  ['📞 الدعم الفني', '👤 حسابي'],
]).resize();

const backToMain = () => Markup.keyboard([['🏠 القائمة الرئيسية']]).resize();

const backButton = (label = '🔙 رجوع') => [[Markup.button.callback(label, 'back')]];

function categoriesKeyboard(categories) {
  const buttons = categories.map(cat => [Markup.button.callback(`${cat.icon} ${cat.name}`, `cat_${cat.id}`)]);
  buttons.push([Markup.button.callback('🏠 القائمة الرئيسية', 'main_menu')]);
  return Markup.inlineKeyboard(buttons);
}

function servicesKeyboard(services, categoryId) {
  const buttons = services.map(s => [Markup.button.callback(`${s.name} - ${s.price} جنيه`, `svc_${s.id}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع للفئات', 'browse_categories')]);
  buttons.push([Markup.button.callback('🏠 القائمة الرئيسية', 'main_menu')]);
  return Markup.inlineKeyboard(buttons);
}

function serviceDetailKeyboard(serviceId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛒 شراء الآن', `buy_${serviceId}`)],
    [Markup.button.callback('🔙 رجوع', 'browse_categories')],
    [Markup.button.callback('🏠 القائمة الرئيسية', 'main_menu')],
  ]);
}

function orderConfirmKeyboard(serviceId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ تأكيد الطلب', `confirm_order_${serviceId}`)],
    [Markup.button.callback('✏️ تعديل البيانات', `edit_order_${serviceId}`)],
    [Markup.button.callback('❌ إلغاء', 'cancel_order')],
  ]);
}

function paymentMethodKeyboard() {
  const wallets = db.prepare('SELECT DISTINCT method FROM payment_wallets WHERE is_active = 1').all();
  const methodMap = { vodafone: '📱 Vodafone Cash', orange: '🟠 Orange Cash', etisalat: '🔵 Etisalat Cash', instapay: '💳 InstaPay' };
  const buttons = wallets.map(w => [Markup.button.callback(methodMap[w.method] || w.method, `pay_method_${w.method}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'back_balance')]);
  return Markup.inlineKeyboard(buttons);
}

function ordersFilterKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏳ قيد المراجعة', 'orders_pending'), Markup.button.callback('✅ مقبول', 'orders_accepted')],
    [Markup.button.callback('🔄 جاري التنفيذ', 'orders_processing'), Markup.button.callback('✔️ مكتمل', 'orders_completed')],
    [Markup.button.callback('❌ مرفوض', 'orders_rejected'), Markup.button.callback('📋 الكل', 'orders_all')],
    [Markup.button.callback('🏠 القائمة الرئيسية', 'main_menu')],
  ]);
}

module.exports = { mainMenu, backToMain, backButton, categoriesKeyboard, servicesKeyboard, serviceDetailKeyboard, orderConfirmKeyboard, paymentMethodKeyboard, ordersFilterKeyboard };
