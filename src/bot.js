require('dotenv').config();
const { Telegraf } = require('telegraf');
const { initDatabase } = require('./config/database');
const { setBot } = require('./config/bot-instance');
const { userMiddleware } = require('./middlewares/auth');
const { isAdmin } = require('./utils/helpers');

// User handlers
const { startHandler } = require('./handlers/user/start');
const { showCategories, showServices, showServiceDetail, startOrderForm, handleFieldInput, confirmOrder, getOrderSession, clearOrderSession } = require('./handlers/user/subscriptions');
const { showBalance, startCharge, selectPaymentMethod, handleChargeInput, showChargeHistory, getChargeSession, clearChargeSession } = require('./handlers/user/balance');
const { showOrders, showOrdersByStatus, showOrderDetail } = require('./handlers/user/orders');
const { showNotifications, showProfile, showSupport, startSupportMessage, handleSupportMessage, hasSupportSession } = require('./handlers/user/misc');

// Admin handlers
const { showAdminOrders, showOrderDetail: adminShowOrderDetail, acceptOrder, rejectOrder, processOrder, completeOrder, handleAdminNoteInput } = require('./handlers/admin/orders');
const { showChargeRequests, showChargeDetail, acceptCharge, rejectCharge } = require('./handlers/admin/charges');
const { showServicesMenu, showServicesList, showServiceItem, startAddService, startEditService, toggleService, deleteService, showFieldsMenu, startAddField, showFieldEdit, deleteField, handleAdminServiceInput, handleAdminServiceCallback } = require('./handlers/admin/services');
const { showUsersMenu, showUsersList, startUserSearch, showUserDetail, toggleBan, startEditBalance, showUserOrders, handleUserAdminInput } = require('./handlers/admin/users');
const { showNotificationsMenu, startBroadcast, startUserNotif, startServiceNotif, handleNotifInput, handleNotifCallback } = require('./handlers/admin/notifications');
const { showSettingsMenu, showWallets, startAddWallet, showBotTexts, showStats, showAdminsMenu, handleSettingsInput, handleSettingsCallback } = require('./handlers/admin/settings');
const { showAdminCategories, handleCategoryInput, handleCategoryCallback } = require('./handlers/admin/categories');
const { adminMainMenu } = require('./keyboards/admin');

// Init DB
initDatabase();

const bot = new Telegraf(process.env.BOT_TOKEN);
setBot(bot);

// Global middleware
bot.use(userMiddleware);

// ─── Start / Main Menu ───────────────────────────────────────────────────────
bot.start(startHandler);
bot.hears('🏠 القائمة الرئيسية', startHandler);
bot.hears('🏠 خروج', startHandler);

// ─── Admin Panel Entry ────────────────────────────────────────────────────────
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ ليس لديك صلاحية.');
  await ctx.reply('👨‍💼 *لوحة الإدارة*', { parse_mode: 'Markdown', ...adminMainMenu() });
});

// ─── User: Main Menu Buttons ──────────────────────────────────────────────────
bot.hears('🛍️ الاشتراكات', showCategories);
bot.hears('💰 الرصيد', async (ctx) => {
  clearChargeSession(ctx.dbUser.id);
  await showBalance(ctx);
});
bot.hears('📦 طلباتي', showOrders);
bot.hears('🔔 الإشعارات', showNotifications);
bot.hears('📞 الدعم الفني', showSupport);
bot.hears('👤 حسابي', showProfile);

// ─── Admin: Main Menu Buttons ──────────────────────────────────────────────────
bot.hears('📋 الطلبات', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.reply('📋 *الطلبات*', { parse_mode: 'Markdown' });
  await showAdminOrders(ctx);
});
bot.hears('💳 طلبات الشحن', async (ctx) => { if (!isAdmin(ctx.from.id)) return; await showChargeRequests(ctx); });
bot.hears('⚙️ الخدمات', async (ctx) => { if (!isAdmin(ctx.from.id)) return; await showServicesMenu(ctx); });
bot.hears('👥 المستخدمون', async (ctx) => { if (!isAdmin(ctx.from.id)) return; await showUsersMenu(ctx); });
bot.hears('📢 الإشعارات', async (ctx) => { if (!isAdmin(ctx.from.id)) return; await showNotificationsMenu(ctx); });
bot.hears('📊 الإحصائيات', async (ctx) => { if (!isAdmin(ctx.from.id)) return; await showStats(ctx); });
bot.hears('🔧 الإعدادات', async (ctx) => { if (!isAdmin(ctx.from.id)) return; await showSettingsMenu(ctx); });

// ─── Message Handler (for dynamic form inputs) ────────────────────────────────
bot.on('message', async (ctx, next) => {
  if (!ctx.message) return next();
  const userId = ctx.dbUser.id;
  const adminId = ctx.from.id;

  // Admin input handlers
    if (isAdmin(adminId)) {
      if (await handleAdminNoteInput(ctx)) return;
      if (await handleAdminServiceInput(ctx)) return;
      if (await handleUserAdminInput(ctx)) return;
      if (await handleNotifInput(ctx)) return;
      if (await handleSettingsInput(ctx)) return;
      if (await handleCategoryInput(ctx)) return;
    }

  // User charge photo input
  if (ctx.message.photo && getChargeSession(userId)?.step === 'photo') {
    if (await handleChargeInput(ctx)) return;
  }

  // User charge amount input
  if (ctx.message.text && getChargeSession(userId)?.step === 'amount') {
    if (await handleChargeInput(ctx)) return;
  }

  // User support message
  if (ctx.message.text && hasSupportSession(userId)) {
    if (await handleSupportMessage(ctx)) return;
  }

  // User order form field input
  if (ctx.message.text || ctx.message.photo || ctx.message.document) {
    const session = getOrderSession(userId);
    if (session) {
      let value = ctx.message.text || null;
      const field = session.fields[session.currentFieldIndex];
      if (field) {
        if ((field.type === 'image' || field.type === 'file') && ctx.message.photo) {
          value = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else if (field.type === 'file' && ctx.message.document) {
          value = ctx.message.document.file_id;
        }
        if (value !== null) {
          if (await handleFieldInput(ctx, userId, value)) return;
        }
      }
    }
  }

  return next();
});

// ─── Callback Query Handler ────────────────────────────────────────────────────
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.dbUser.id;
  const adminId = ctx.from.id;

  await ctx.answerCbQuery().catch(() => {});

  // ── User callbacks ──
  if (data === 'main_menu') return startHandler(ctx);
  if (data === 'browse_categories') return showCategories(ctx);
  if (data === 'back_balance') return showBalance(ctx);
  if (data === 'my_orders') return showOrders(ctx);
  if (data === 'charge_start') return startCharge(ctx);
  if (data === 'charge_history') return showChargeHistory(ctx);
  if (data === 'send_support_msg') return startSupportMessage(ctx);

  if (data.startsWith('cat_')) return showServices(ctx, parseInt(data.slice(4)));
  if (data.startsWith('svc_')) return showServiceDetail(ctx, parseInt(data.slice(4)));
  if (data.startsWith('buy_')) return startOrderForm(ctx, parseInt(data.slice(4)));
  if (data.startsWith('confirm_order_')) return confirmOrder(ctx, parseInt(data.split('_')[2]));
  if (data === 'cancel_order') { clearOrderSession(userId); return ctx.editMessageText('❌ تم إلغاء الطلب.'); }
  if (data.startsWith('edit_order_')) { clearOrderSession(userId); return startOrderForm(ctx, parseInt(data.split('_')[2])); }

  if (data.startsWith('charge_method_')) return selectPaymentMethod(ctx, data.replace('charge_method_', ''));
  if (data.startsWith('field_option_')) {
    // format: field_option_{index}_{value}
    const parts = data.split('_');
    // parts[0]=field, parts[1]=option, parts[2]=index, parts[3..]=value
    const value = parts.slice(3).join('_');
    return handleFieldInput(ctx, userId, value);
  }

  if (data.startsWith('field_skip_')) {
    const session = getOrderSession(userId);
    if (session) {
      const field = session.fields[session.currentFieldIndex];
      if (field && !field.is_required) {
        // Pass empty string — handleFieldInput will store null for optional fields
        return handleFieldInput(ctx, userId, null);
      }
    }
    return;
  }

  if (data.startsWith('orders_')) {
    const status = data.replace('orders_', '');
    if (status.startsWith('page_')) return; // pagination not needed for user
    return showOrdersByStatus(ctx, status);
  }
  if (data.startsWith('user_order_')) return showOrderDetail(ctx, parseInt(data.split('_')[2]));

  // ── Admin callbacks ──
  if (!isAdmin(adminId)) return ctx.reply('⛔ ليس لديك صلاحية.');

  if (data === 'admin_back') return ctx.editMessageText('👨‍💼 *لوحة الإدارة*', { parse_mode: 'Markdown', ...adminMainMenu() }).catch(() => {});
  if (data === 'admin_orders') return showAdminOrders(ctx);
  if (data === 'admin_charges') return showChargeRequests(ctx);
  if (data === 'admin_services') return showServicesMenu(ctx);
  if (data === 'admin_services_list') return showServicesList(ctx);
  if (data === 'admin_services_add') return startAddService(ctx);
  if (data === 'admin_users') return showUsersMenu(ctx);
  if (data === 'admin_users_list') return showUsersList(ctx);
  if (data === 'admin_users_search') return startUserSearch(ctx);
  if (data === 'admin_notifications') return showNotificationsMenu(ctx);
  if (data === 'admin_notif_all') return startBroadcast(ctx);
  if (data === 'admin_notif_user') return startUserNotif(ctx);
  if (data === 'admin_notif_service') return startServiceNotif(ctx);
  if (data === 'admin_settings') return showSettingsMenu(ctx);
  if (data === 'admin_wallets') return showWallets(ctx);
  if (data === 'admin_wallet_add') return startAddWallet(ctx);
  if (data === 'admin_texts') return showBotTexts(ctx);
  if (data === 'admin_stats') return showStats(ctx);
  if (data === 'admin_admins') return showAdminsMenu(ctx);
  if (data === 'admin_categories') return showAdminCategories(ctx);

  if (data.startsWith('orders_page_')) return showAdminOrders(ctx, parseInt(data.split('_')[2]));
  if (data.startsWith('admin_order_accept_')) return acceptOrder(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_order_reject_')) return rejectOrder(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_order_process_')) return processOrder(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_order_complete_')) return completeOrder(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_order_')) return adminShowOrderDetail(ctx, parseInt(data.split('_')[2]));

  if (data.startsWith('admin_charge_accept_')) return acceptCharge(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_charge_reject_')) return rejectCharge(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_charge_')) return showChargeDetail(ctx, parseInt(data.split('_')[2]));

  if (data.startsWith('admin_svc_view_')) return showServiceItem(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_svc_edit_')) return startEditService(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_svc_toggle_')) return toggleService(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_svc_delete_')) return deleteService(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_svc_fields_')) return showFieldsMenu(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_field_add_')) return startAddField(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_field_edit_')) return showFieldEdit(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_field_delete_')) return deleteField(ctx, parseInt(data.split('_')[3]));

  if (data.startsWith('admin_user_balance_')) return startEditBalance(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_user_ban_')) return toggleBan(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_user_orders_')) return showUserOrders(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_users_page_')) return showUsersList(ctx, parseInt(data.split('_')[3]));
  if (data.startsWith('admin_user_')) return showUserDetail(ctx, parseInt(data.split('_')[2]));

  // Handle service & field builder callbacks
  if (handleAdminServiceCallback(ctx, data)) return;
  if (handleNotifCallback(ctx, data)) return;
  if (handleSettingsCallback(ctx, data)) return;
  if (handleCategoryCallback(ctx, data)) return;
});

// Error handler
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('❌ حدث خطأ. حاول مرة أخرى.').catch(() => {});
});

bot.launch({ dropPendingUpdates: true });
console.log('✅ البوت يعمل...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
