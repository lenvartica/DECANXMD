'use strict';

const BOT_NAME = process.env.BOT_NAME || 'DECAN XMD';
const OWNER_NAME = process.env.OWNER_NAME || 'Sir Lenny Muriuki';
const COMPANY = process.env.COMPANY_NAME || 'DECAN KONNECT';
const VERSION = '1.1.0';

const header = () => `┏❒ 👑 ✦ 𝐃𝐄𝐂𝐀𝐍 𝐗𝐌𝐃 ✦ 👑 ❒`;
const footer = () => `┗❒ ❤️ POWERED BY ${COMPANY}`;
const section = (title, lines=[]) =>
  `╭━━〔 ⚜️ ${title} 〕\n${lines.map(x=>`│ ${x}`).join('\n')}\n╰━━━━━━━━━━━━━━━━━━`;
const wrap = (body='') => `${header()}\n${body}\n${footer()}`;

function mainMenu({name='Unknown',host=process.platform,mode='PUBLIC',prefix='.',count=0,ram='0 MB',uptime='0s',time,date}) {
  return wrap(
`   "Building a smarter WhatsApp experience."\n┃
┃ Usᴇʀ: ${name}
┃ Oᴡɴᴇʀ: ${OWNER_NAME}
┃ Mᴏᴅᴇ: ${mode}
┃ Hᴏsᴛ: ${host}
┃ Pʀᴇғɪx: [ ${prefix} ]
┃ Cᴏᴍᴍᴀɴᴅs: ${count}
┃ Vᴇʀsɪᴏɴ: ${VERSION}
┃ Rᴀᴍ: ${ram}
┃ Uᴘᴛɪᴍᴇ: ${uptime}
┃
${section('STATUS',[
`👤 User      : ${name || 'Unknown'}`,
`👑 Owner     : ${OWNER_NAME}`,
`⚡ Prefix    : ${prefix}`,
`📜 Commands  : ${count}`,
`⏱️ Uptime    : ${uptime}`,
`🕰️ Time      : ${time}`,
`📅 Date      : ${date}`
])}`
  );
}

function welcome({pushName='there',userNumber='',channelUrl=''}) {
  return wrap(
`   "Welcome to a smarter WhatsApp experience."\n┃
┃ 👋 Hᴇʟʟᴏ: ${pushName}
┃ 🆔 Usᴇʀ: ${userNumber || 'Private'}
┃
┃ 👑 ${OWNER_NAME.toUpperCase()}
┃ WELCOMES YOU!
┃
┃ ❤️ Welcome to DECAN XMD.
┃ You are now connected to a
┃ smarter WhatsApp experience.
┃
┃ ⚡ Prefix: .
┃ 📌 Version: ${VERSION}
┃ 🤖 Mode: PUBLIC
┃
${channel}
┃
┃ Type .menu to explore commands.
┃
${section('❤️ A MESSAGE FROM THE FOUNDER',[
`${OWNER_NAME} welcomes you`,
`to the DECAN XMD community.`,
``,
`Thank you for choosing our bot.`
])}`
  );
}

function maintenance() {
  return wrap(
`┃
┃ 🚧 SYSTEM UNDER MAINTENANCE
┃
┃ DECAN XMD is undergoing a
┃ complete system rebuild.
┃
┃ All previous commands have
┃ been removed.
┃
┃ 🔖 Version: ${VERSION}
┃ ⚙️ Status: UNDER UPDATE
┃
┃ Kindly wait as we prepare
┃ the new experience.
┃
┃ 📢 Follow our official channel
┃ for future announcements.
`
  );
}

const success=(body)=>wrap(section('✅ SUCCESS',body));
const error=(body)=>wrap(section('❌ ERROR',body));
const denied=(permission)=>wrap(section('🔒 ACCESS DENIED',[`This command is restricted.`,`Required permission: ${permission}`]));
const status=(lines)=>wrap(section('⚜️ SYSTEM STATUS',lines));
module.exports={BOT_NAME,OWNER_NAME,COMPANY,VERSION,header,footer,section,wrap,mainMenu,welcome,maintenance,success,error,denied,status};
