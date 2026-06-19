const { getOrCreateUser, isAdmin } = require('../utils/helpers');

function userMiddleware(ctx, next) {
  if (!ctx.from) return;
  ctx.dbUser = getOrCreateUser(ctx.from);
  if (ctx.dbUser.is_banned) {
    return ctx.reply('🚫 تم حظر حسابك. تواصل مع الدعم الفني.');
  }
  return next();
}

function adminMiddleware(ctx, next) {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ ليس لديك صلاحية للوصول.');
  }
  return next();
}

module.exports = { userMiddleware, adminMiddleware };
