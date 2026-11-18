'use strict';
/** Extra names for commands the bot already has (loaded last on purpose so every target exists). */
module.exports = ({ alias, registry }) => {
  const A = [
    ['sticker', 's'], ['photo', 'toimg'], ['mp4', 'tovideo', 'togif'], ['mp3', 'extractaudio'], ['yta', 'ytmp3'], ['ytv', 'ytmp4'],
    ['insta', 'instagram'], ['fb', 'facebook'], ['rmbg', 'removebg'], ['qr', 'readqr'], ['img', 'image'], ['song', 'playdoc'],
    ['stats', 'info', 'bot', 'system', 'runtime'], ['repo', 'repository'], ['jid', 'id'], ['left', 'leave'], ['pp', 'setpp', 'getpp'],
    ['gjid', 'groups'], ['ginfo', 'groupinfo', 'inviteinfo'], ['invite', 'grouplink'], ['tagadmins', 'tagadmin'],
    ['close', 'lockgroup'], ['open', 'unlockgroup'], ['reset', 'resetwarn', 'clearwarnings'], ['filter', 'filters'],
    ['allvar', 'settings', 'config'], ['trt', 'translate'], ['setschedule', 'schedule'], ['task', 'todo'], ['avm', 'voice'],
    ['delete', 'unsend'], ['dall', 'imagine'], ['define', 'dictionary'], ['ison', 'checknumber'], ['autoviewstatus', 'statusview'],
    ['autoreactstatus', 'statuslike'], ['antispam', 'antiflood'], ['antigm', 'antitag'], ['antiword', 'antibadword'], ['update', 'checkupdate'],
    ['ask', 'ai'], ['dice', 'roll'], ['calc', 'eval']
  ];
  for (const [target, ...names] of A) {
    const fresh = names.filter(n => !registry.has(n));
    if (registry.has(target) && fresh.length) alias(target, ...fresh);
  }
};
