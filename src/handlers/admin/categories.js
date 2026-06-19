const { db } = require('../../config/database');
const { Markup } = require('telegraf');
const { SessionMap } = require('../../utils/helpers');

const catSessions = new SessionMap();

async function showAdminCategories(ctx) {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  let text = '📁 *إدارة الفئات*\n\nعدد الفئات: ' + cats.length;
  const buttons = cats.map(c => [
    Markup.button.callback(`${c.is_active ? '🟢' : '🔴'} ${c.icon} ${c.name}`, `admin_cat_view_${c.id}`),
  ]);
  buttons.push([Markup.button.callback('➕ إضافة فئة', 'admin_cat_add')]);
  buttons.push([Markup.button.callback('🔙 رجوع', 'admin_services')]);
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }); }
}

async function showCategoryItem(ctx, catId) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
  if (!cat) return ctx.reply('❌ الفئة غير موجودة.');
  const svcCount = db.prepare('SELECT COUNT(*) as c FROM services WHERE category_id = ?').get(catId).c;
  const text = `📁 *${cat.icon} ${cat.name}*\n\n🔢 الترتيب: ${cat.sort_order}\n🛍️ الخدمات: ${svcCount}\n🔘 الحالة: ${cat.is_active ? '🟢 مفعلة' : '🔴 موقوفة'}`;
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ تعديل الاسم', `admin_cat_edit_name_${catId}`), Markup.button.callback('🎨 تعديل الأيقونة', `admin_cat_edit_icon_${catId}`)],
    [Markup.button.callback(cat.is_active ? '🔴 إيقاف' : '🟢 تشغيل', `admin_cat_toggle_${catId}`)],
    [Markup.button.callback('🗑️ حذف الفئة', `admin_cat_delete_${catId}`)],
    [Markup.button.callback('🔙 رجوع', 'admin_categories')],
  ]);
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...buttons }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...buttons }); }
}

async function startAddCategory(ctx) {
  catSessions.set(ctx.from.id, { action: 'add_cat', step: 'name' });
  try { await ctx.editMessageText('➕ *إضافة فئة جديدة*\n\nأدخل اسم الفئة:', { parse_mode: 'Markdown' }); }
  catch { await ctx.reply('➕ *إضافة فئة جديدة*\n\nأدخل اسم الفئة:', { parse_mode: 'Markdown' }); }
}

async function toggleCategory(ctx, catId) {
  const cat = db.prepare('SELECT is_active FROM categories WHERE id = ?').get(catId);
  db.prepare('UPDATE categories SET is_active = ? WHERE id = ?').run(cat.is_active ? 0 : 1, catId);
  await showCategoryItem(ctx, catId);
}

async function deleteCategory(ctx, catId) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
  const svcCount = db.prepare('SELECT COUNT(*) as c FROM services WHERE category_id = ?').get(catId).c;
  if (svcCount > 0) {
    try { await ctx.editMessageText(`❌ لا يمكن حذف الفئة "${cat.name}" لأنها تحتوي على ${svcCount} خدمة. احذف الخدمات أولاً.`); }
    catch { await ctx.reply(`❌ لا يمكن حذف الفئة "${cat.name}" لأنها تحتوي على ${svcCount} خدمة.`); }
    return;
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
  try { await ctx.editMessageText(`🗑️ تم حذف الفئة "${cat.name}" بنجاح.`); }
  catch { await ctx.reply(`🗑️ تم حذف الفئة "${cat.name}" بنجاح.`); }
}

async function handleCategoryInput(ctx) {
  const session = catSessions.get(ctx.from.id);
  if (!session) return false;
  const text = ctx.message.text?.trim();
  if (!text) return false;

  if (session.action === 'add_cat') {
    if (session.step === 'name') {
      session.name = text; session.step = 'icon';
      catSessions.set(ctx.from.id, session);
      await ctx.reply('🎨 أدخل أيقونة الفئة (إيموجي واحد) أو "-" للافتراضي 📦:');
      return true;
    }
    if (session.step === 'icon') {
      catSessions.delete(ctx.from.id);
      const icon = text === '-' ? '📦' : text;
      const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM categories').get().m || 0;
      db.prepare('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)').run(session.name, icon, maxOrder + 1);
      await ctx.reply(`✅ تم إضافة الفئة "${session.name}" ${icon} بنجاح!`);
      await showAdminCategories(ctx);
      return true;
    }
  }

  if (session.action === 'edit_cat_name') {
    catSessions.delete(ctx.from.id);
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(text, session.catId);
    await ctx.reply('✅ تم تعديل اسم الفئة بنجاح.');
    await showCategoryItem(ctx, session.catId);
    return true;
  }

  if (session.action === 'edit_cat_icon') {
    catSessions.delete(ctx.from.id);
    db.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(text, session.catId);
    await ctx.reply('✅ تم تعديل أيقونة الفئة بنجاح.');
    await showCategoryItem(ctx, session.catId);
    return true;
  }

  return false;
}

function handleCategoryCallback(ctx, data) {
  if (data === 'admin_categories' || data === 'admin_cat_list') {
    showAdminCategories(ctx);
    return true;
  }
  if (data === 'admin_cat_add') {
    startAddCategory(ctx);
    return true;
  }
  if (data.startsWith('admin_cat_view_')) {
    showCategoryItem(ctx, parseInt(data.split('_')[3]));
    return true;
  }
  if (data.startsWith('admin_cat_toggle_')) {
    toggleCategory(ctx, parseInt(data.split('_')[3]));
    return true;
  }
  if (data.startsWith('admin_cat_delete_')) {
    deleteCategory(ctx, parseInt(data.split('_')[3]));
    return true;
  }
  if (data.startsWith('admin_cat_edit_name_')) {
    const catId = parseInt(data.split('_')[4]);
    catSessions.set(ctx.from.id, { action: 'edit_cat_name', catId });
    ctx.reply('✏️ أدخل الاسم الجديد للفئة:');
    return true;
  }
  if (data.startsWith('admin_cat_edit_icon_')) {
    const catId = parseInt(data.split('_')[4]);
    catSessions.set(ctx.from.id, { action: 'edit_cat_icon', catId });
    ctx.reply('🎨 أدخل الأيقونة الجديدة (إيموجي):');
    return true;
  }
  return false;
}

module.exports = { showAdminCategories, showCategoryItem, startAddCategory, toggleCategory, deleteCategory, handleCategoryInput, handleCategoryCallback };
