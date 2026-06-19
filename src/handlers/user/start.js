const { mainMenu } = require('../../keyboards/user');
const { adminMainMenu } = require('../../keyboards/admin');
const { getSetting, isAdmin } = require('../../utils/helpers');

async function startHandler(ctx) {
  const welcome = getSetting('bot_welcome_message') || 'مرحباً!';
  const name = getSetting('bot_name') || 'المتجر';

  if (isAdmin(ctx.from.id)) {
    await ctx.reply(
      `${welcome}\n\nأهلاً *${ctx.dbUser.full_name}* 👨‍💼\n\nأنت مسجل كمدير. اختر من القائمة:`,
      { parse_mode: 'Markdown', ...adminMainMenu() }
    );
  } else {
    await ctx.reply(
      `${welcome}\n\nأهلاً *${ctx.dbUser.full_name}* في *${name}* 🎉\n\nاختر من القائمة أدناه:`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
  }
}

module.exports = { startHandler };
