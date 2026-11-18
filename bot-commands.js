
const { randomBytes } = require('node:crypto');
const GROUP_INVITE_URL = 'https://chat.whatsapp.com/GEIVBf7Mx21EBqZn2FOaHF';

const COMMAND_GROUPS = [
  {
    title: 'WHATSAPP',
    commands: [
      ['antiedit', 'Alert when a message edit is detected'],
      ['call', 'Reject incoming calls after confirmation'],
      ['caption', 'Format caption text'],
      ['cinfo', 'Show current chat information'],
      ['clear', 'Clear this bot chat’s pending actions'],
      ['creact', 'Create a group with a mentioned participant'],
      ['delete', 'Delete a quoted message after confirmation'],
      ['dlt', 'Alias for delete'],
      ['doc', 'Show safe document-command guidance'],
      ['online', 'Set online presence'],
      ['poll', 'Create a WhatsApp poll'],
      ['react', 'React to a quoted message'],
      ['read', 'Toggle explicit read receipts'],
      ['scstatus', 'Explain WhatsApp status-view limitations'],
      ['setstatus', 'Set account status after confirmation'],
      ['status', 'Show connection and profile status'],
      ['vv', 'Explain view-once privacy limitations']
    ]
  },
  {
    title: 'USER',
    commands: [
      ['block', 'Block a contact after confirmation'],
      ['unblock', 'Unblock a contact after confirmation'],
      ['fullpp', 'Show a contact’s WhatsApp profile photo'],
      ['pp', 'Show a contact’s WhatsApp profile photo'],
      ['gjid', 'Show the current group JID'],
      ['jid', 'Show the current chat JID'],
      ['left', 'Leave this group after confirmation']
    ]
  },
  {
    title: 'BOT',
    commands: [
      ['menu', 'Show all available commands'],
      ['help', 'Show command usage'],
      ['ping', 'Test the bot response'],
      ['info', 'Show bot information'],
      ['owner', 'Show owner information'],
      ['confirm', 'Confirm a pending sensitive action'],
      ['cancel', 'Cancel a pending action'],
      ['backup', 'Explain secure session-backup limitations'],
      ['gauth', 'Show Google OAuth configuration status'],
      ['gupload', 'Show group-upload configuration status'],
      ['ytlogin', 'Show YouTube login configuration status'],
      ['reminder', 'Set a temporary in-memory reminder'],
      ['task', 'Manage this session’s in-memory task list'],
      ['tog', 'Show or change bot feature toggles'],
      ['update', 'Check update information; .update now gives local update instructions']
    ]
  },
  {
    title: 'UTILITIES',
    commands: [
      ['calc', 'Calculate a basic arithmetic expression'],
      ['time', 'Show the current UTC date and time']
    ]
  }
];

function normalizeJid(jid) {
  return typeof jid === 'string' ? jid.replace(/:\d+(?=@)/, '') : '';
}

function shouldHandleMessage(message, ownJid) {
  if (!message?.message || !message.key?.remoteJid || message.key.remoteJid === 'status@broadcast') {
    return false;
  }

  if (!message.key.fromMe) return true;

  const chatJid = normalizeJid(message.key.remoteJid);
  if (chatJid.endsWith('@g.us')) return true;
  const ownJids = Array.isArray(ownJid) ? ownJid : [ownJid];

  return Boolean(chatJid && ownJids.some(jid => normalizeJid(jid) === chatJid));
}

function extractText(message) {
  let content = message?.message;

  for (let depth = 0; content && depth < 10; depth += 1) {
    const text =
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      content.documentWithCaptionMessage?.message?.documentMessage?.caption ||
      content.buttonsResponseMessage?.selectedButtonId ||
      content.listResponseMessage?.singleSelectReply?.selectedRowId ||
      content.templateButtonReplyMessage?.selectedId ||
      content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;

    if (typeof text === 'string') return text;

    const wrapped =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.viewOnceMessageV2Extension?.message ||
      content.documentWithCaptionMessage?.message ||
      content.editedMessage?.message;

    if (!wrapped) return '';
    content = wrapped;
  }

  return '';
}

function isEditMessage(message) {
  return Boolean(
    message?.message?.protocolMessage?.editedMessage ||
    message?.update?.message?.protocolMessage?.editedMessage
  );
}

function parseCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('.')) return null;

  const match = /^\.([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;

  return {
    command: match[1].toLowerCase(),
    args: (match[2] || '').trim()
  };
}

function tokenizeExpression(expression) {
  if (!expression || expression.length > 120) {
    throw new Error('Enter an arithmetic expression of up to 120 characters.');
  }

  const tokens = [];
  const tokenPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([()+\-*/%^]))/y;
  let position = 0;

  while (position < expression.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(expression);
    if (!match) throw new Error('Use numbers, parentheses, and + - * / % ^ only.');

    tokens.push(match[1] === undefined ? match[2] : Number(match[1]));
    position = tokenPattern.lastIndex;
  }

  if (tokens.length > 60) throw new Error('That expression is too long.');
  return tokens;
}

function evaluateExpression(expression) {
  const tokens = tokenizeExpression(expression);
  let position = 0;

  const parsePrimary = () => {
    const token = tokens[position];

    if (token === '(') {
      position += 1;
      const value = parseSum();
      if (tokens[position] !== ')') throw new Error('Check the parentheses in your expression.');
      position += 1;
      return value;
    }

    if (typeof token !== 'number') throw new Error('Check the expression near the operator.');
    position += 1;
    return token;
  };

  const parsePower = () => {
    const left = parsePrimary();
    if (tokens[position] !== '^') return left;
    position += 1;
    return left ** parseUnary();
  };

  const parseUnary = () => {
    if (tokens[position] === '+') {
      position += 1;
      return parseUnary();
    }
    if (tokens[position] === '-') {
      position += 1;
      return -parseUnary();
    }
    return parsePower();
  };

  const parseProduct = () => {
    let value = parseUnary();

    while (['*', '/', '%'].includes(tokens[position])) {
      const operator = tokens[position];
      position += 1;
      const right = parseUnary();

      if ((operator === '/' || operator === '%') && right === 0) {
        throw new Error('Division by zero is not allowed.');
      }

      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;
    }

    return value;
  };

  const parseSum = () => {
    let value = parseProduct();

    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position];
      position += 1;
      const right = parseProduct();
      value = operator === '+' ? value + right : value - right;
    }

    return value;
  };

  const result = parseSum();
  if (position !== tokens.length) throw new Error('Check the expression near the operator.');
  if (!Number.isFinite(result)) throw new Error('That expression does not have a finite result.');

  return Number(result.toPrecision(12)).toString();
}

function renderMenu(botName) {
  return [
    `╭━━━〔 ✦ *${botName.toUpperCase()}* ✦ 〕━━━╮`,
    '',
    ...COMMAND_GROUPS.flatMap(group => [
      `┃ ✧ *${group.title}*`,
      ...group.commands.map(([name]) => `┃  •  *.${name}*`)
    ]),
    '',
    '╰━━━━━━━━━━━━━━━━━━━━━━╯',
    '',
    `✦ Main Group: ${GROUP_INVITE_URL}`
  ].join('\n');
}

function normalizeJid(jid) {
  return typeof jid === 'string' ? jid.replace(/:\d+(?=@)/, '') : '';
}

function senderJid(message) {
  return normalizeJid(message.key?.participant || message.key?.remoteJid);
}

function quotedMessage(message, ownJids = []) {
  const content = message.message || {};
  const context =
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    content.documentMessage?.contextInfo;
  const key = context?.stanzaId
    ? {
        remoteJid: message.key.remoteJid,
        id: context.stanzaId,
        participant: context.participant,
        fromMe: ownJids.some(jid => normalizeJid(jid) === normalizeJid(context.participant))
      }
    : null;
  return { context, key };
}

function parseTargetJid(args) {
  const value = args.trim().replace(/^@/, '');
  if (!/^\d{7,15}$/.test(value)) {
    throw new Error('Provide a phone number with country code, without + or punctuation.');
  }
  return `${value}@s.whatsapp.net`;
}

function parseDuration(value) {
  const match = /^(\d{1,5})(s|m|h|d)$/i.exec(value);
  if (!match) throw new Error('Use a duration such as 10m, 2h, or 1d.');
  const amount = Number(match[1]);
  const factor = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
  const milliseconds = amount * factor;
  if (milliseconds < 60000 || milliseconds > 30 * 86400000) {
    throw new Error('Reminder duration must be between 1 minute and 30 days.');
  }
  return milliseconds;
}

function createConfirmation(context, description, action) {
  const { state, message } = context;
  state.pendingActions ||= new Map();
  const key = `${message.key.remoteJid}:${senderJid(message)}`;
  const token = randomBytes(3).toString('hex').toUpperCase();

  state.pendingActions.set(key, {
    token,
    expiresAt: Date.now() + 60000,
    action
  });

  return `⚠️ Confirm: ${description}\nReply *.confirm ${token}* within 60 seconds, or *.cancel*.`;
}

async function requireGroupAdmin(context) {
  const { sock, message } = context;
  const chat = message.key.remoteJid;
  if (!chat.endsWith('@g.us')) throw new Error('This command only works in a group chat.');
  if (typeof sock.groupMetadata !== 'function') {
    throw new Error('Group metadata is not available in this Baileys socket.');
  }

  const metadata = await sock.groupMetadata(chat);
  const sender = senderJid(message);
  const admin = metadata.participants?.some(participant =>
    normalizeJid(participant.id) === sender && Boolean(participant.admin)
  );
  if (!admin) throw new Error('Only a group admin can use this command.');
  return metadata;
}

async function executeCommand(command, args, context) {
  const {
    botName,
    ownerName,
    companyName,
    connected,
    uptimeSeconds,
    sock,
    message,
    sessionId,
    state,
    env = process.env
  } = context;
  const chat = message.key.remoteJid;
  const sender = senderJid(message);
  const ownerJids = (context.ownerJids || []).map(normalizeJid);
  const isOwner = Boolean(message.key.fromMe || ownerJids.includes(sender));

  switch (command) {
    case 'menu':
      return renderMenu(botName);
    case 'help':
      return `*${botName} help*\nSend a command beginning with a period. Examples: *.ping*, *.poll Lunch? | Pizza | Tacos*, *.reminder 10m Stretch*, or *.task add Buy milk*.\n\nSensitive changes show a one-time code; reply with *.confirm CODE* to proceed or *.cancel* to stop. Send *.menu* for the full command list.`;
    case 'ping':
      return '🏓 Pong! The bot is responding.';
    case 'info':
      return `*${botName}*\nCreated by *${ownerName}*\n*${companyName}*\nWhatsApp connection powered by Baileys.`;
    case 'owner':
      return `👑 Owner: *${ownerName}*\n🏢 Company: *${companyName}*`;
    case 'status': {
      const hours = Math.floor(uptimeSeconds / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      return `${connected ? '🟢 Connected and listening.' : '🟠 Reconnecting to WhatsApp.'}\nService uptime: ${hours}h ${minutes}m\nWhatsApp profile status: ${sock.user?.status || 'not available'}`;
    }
    case 'calc':
      if (!args) return 'Usage: *.calc 12 * (3 + 1)*\nSupported: +, -, *, /, %, ^, and parentheses.';
      try {
        return `🧮 ${args} = *${evaluateExpression(args)}*`;
      } catch (error) {
        return `Could not calculate that: ${error.message}`;
      }
    case 'time':
      return `🕒 ${new Date().toLocaleString('en-GB', {
        timeZone: 'UTC',
        dateStyle: 'full',
        timeStyle: 'medium'
      })} UTC`;
    case 'confirm': {
      state.pendingActions ||= new Map();
      const key = `${chat}:${sender}`;
      const pending = state.pendingActions.get(key);
      if (!pending || pending.expiresAt < Date.now()) {
        state.pendingActions.delete(key);
        return 'There is no pending confirmation for you, or it expired.';
      }
      if (pending.token !== args.trim().toUpperCase()) return 'That confirmation code is incorrect.';
      state.pendingActions.delete(key);
      const result = await pending.action();
      return result === null ? null : (result || '✅ Confirmed action completed.');
    }
    case 'cancel': {
      state.pendingActions?.delete(`${chat}:${sender}`);
      return 'Pending confirmation cancelled.';
    }
    case 'antiedit':
      if (!isOwner) throw new Error('Only the linked account owner can change edit-alert settings.');
      state.antiEdit = parseToggle(args, state.antiEdit, 'antiedit');
      return `Edit alerts are ${state.antiEdit ? 'on' : 'off'}. WhatsApp edits cannot be prevented; alerts depend on edit events WhatsApp delivers.`;
    case 'call':
      if (!isOwner) throw new Error('Only the linked account owner can change call-handling settings.');
      {
        const enabled = parseToggle(args, state.rejectCalls, 'call');
        if (enabled && typeof sock.rejectCall !== 'function') {
          throw new Error('Incoming-call rejection is not available in this Baileys socket.');
        }
        if (enabled && !state.rejectCalls) {
          return createConfirmation(context, 'automatically reject all incoming WhatsApp calls', async () => {
            state.rejectCalls = true;
          });
        }
        state.rejectCalls = enabled;
      }
      return `Automatic incoming-call rejection is ${state.rejectCalls ? 'on' : 'off'}.`;
    case 'caption':
      if (!args) return 'Usage: *.caption Your caption text*';
      return `*Caption*\n${args.slice(0, 1000)}`;
    case 'cinfo':
      if (chat.endsWith('@g.us')) {
        if (typeof sock.groupMetadata !== 'function') {
          throw new Error('Group metadata is not available in this Baileys socket.');
        }
        const metadata = await sock.groupMetadata(chat);
        return `*${metadata.subject || 'Group'}*\nID: ${chat}\nMembers: ${metadata.participants?.length ?? 'unknown'}\nDescription: ${metadata.desc || 'none'}`;
      }
      return `*Direct chat*\nID: ${chat}\nContact: ${message.pushName || 'not available'}`;
    case 'clear':
      state.pendingActions?.delete(`${chat}:${sender}`);
      return 'Cleared your pending confirmation in this chat. WhatsApp chat history cannot be cleared remotely by this bot.';
    case 'creact': {
      if (!isOwner) throw new Error('Only the linked account owner can create groups.');
      const match = /^(.+?)\s+@?(\d{7,15})$/.exec(args);
      if (!match) return 'Usage: *.creact Group name 2547XXXXXXXX*';
      const subject = match[1].trim().slice(0, 100);
      const participant = `${match[2]}@s.whatsapp.net`;
      if (typeof sock.groupCreate !== 'function') {
        throw new Error('Group creation is not available in this Baileys socket.');
      }
      return createConfirmation(context, `create the group “${subject}” and invite ${participant}`, async () => {
        const group = await sock.groupCreate(subject, [participant]);
        return `✅ Group created: ${group.subject || subject}\nID: ${group.id}`;
      });
    }
    case 'delete':
    case 'dlt': {
      const quoted = quotedMessage(message, context.ownerJids || []);
      if (!quoted.key) return 'Reply to the message you want to delete, then send *.delete*.';
      if (chat.endsWith('@g.us')) await requireGroupAdmin(context);
      return createConfirmation(context, 'delete the quoted message for everyone', async () => {
        if (chat.endsWith('@g.us')) await requireGroupAdmin(context);
        await sock.sendMessage(chat, { delete: quoted.key });
        await sock.sendMessage(chat, { delete: message.key }).catch(() => {});
      });
    }
    case 'doc':
      return 'This build does not convert messages to documents. Send a document as an attachment in WhatsApp instead; no media is downloaded or re-uploaded.';
    case 'online': {
      if (!isOwner) throw new Error('Only the linked account owner can change account presence.');
      const enabled = parseToggle(args, state.onlinePresence, 'online');
      if (typeof sock.sendPresenceUpdate !== 'function') {
        throw new Error('Presence updates are not available in this Baileys socket.');
      }
      state.onlinePresence = enabled;
      await sock.sendPresenceUpdate(enabled ? 'available' : 'unavailable');
      return `Account presence set to ${enabled ? 'online' : 'offline'}.`;
    }
    case 'poll': {
      const parts = args.split('|').map(part => part.trim()).filter(Boolean);
      if (parts.length < 3 || parts.length > 13) {
        return 'Usage: *.poll Question | Option 1 | Option 2* (up to 12 options).';
      }
      await sock.sendMessage(chat, {
        poll: { name: parts[0].slice(0, 250), values: parts.slice(1).map(option => option.slice(0, 100)), selectableCount: 1 }
      });
      return '📊 Poll created.';
    }
    case 'react': {
      const quoted = quotedMessage(message, context.ownerJids || []);
      if (!quoted.key) return 'Reply to a message and send *.react ❤️*.';
      const emoji = args.trim();
      if (!emoji || emoji.length > 16) return 'Provide one reaction emoji, for example *.react ❤️*.';
      await sock.sendMessage(chat, { react: { text: emoji, key: quoted.key } });
      return '✅ Reaction sent.';
    }
    case 'read':
      if (!isOwner) throw new Error('Only the linked account owner can change read-receipt settings.');
      {
        const enabled = parseToggle(args, state.readReceipts, 'read');
        if (enabled && typeof sock.readMessages !== 'function') {
          throw new Error('Explicit read-receipt marking is not available in this Baileys socket.');
        }
        state.readReceipts = enabled;
      }
      return `Explicit read-receipt marking is ${state.readReceipts ? 'on' : 'off'}. WhatsApp may still send protocol-level receipts.`;
    case 'scstatus':
      return 'WhatsApp does not expose a reliable status-viewer list through this bot connection. Use WhatsApp’s own Status privacy and viewer screen.';
    case 'setstatus': {
      if (!isOwner) throw new Error('Only the linked account owner can change profile status.');
      if (!args) return 'Usage: *.setstatus Your profile status*';
      if (typeof sock.updateProfileStatus !== 'function') {
        throw new Error('Profile-status updates are not available in this Baileys socket.');
      }
      const statusText = args.slice(0, 139);
      return createConfirmation(context, `set your WhatsApp profile status to “${statusText}”`, async () => {
        await sock.updateProfileStatus(statusText);
      });
    }
    case 'vv':
    case 'vv2': {
      const targetMsg = quoted?.message || message;
      return '👁️ Reply to a view-once photo, video, or voice note with *.vv* to reveal it in the chat, or *.vv2* to receive it privately.';
    }
    case 'jid':
    case 'gjid':
      if (command === 'gjid' && !chat.endsWith('@g.us')) return 'Use *.gjid* in a group chat.';
      return `${chat.endsWith('@g.us') ? 'Group' : 'Chat'} JID: ${chat}\nYour JID: ${sender}`;
    case 'pp':
    case 'fullpp': {
      let target;
      try {
        target = args ? parseTargetJid(args) : (chat.endsWith('@g.us') ? sender : chat);
        const picture = await sock.profilePictureUrl(target, 'image');
        await sock.sendMessage(chat, {
          image: { url: picture },
          caption: `Profile photo for ${target}`
        }, { quoted: message });
        return '🖼️ Profile photo sent.';
      } catch (error) {
        if (error.message.includes('Provide a phone number')) return error.message;
        context.logger?.warn({ error: error.message, target, sessionId }, 'Could not fetch WhatsApp profile photo');
        return 'No profile photo is available for that contact, or WhatsApp did not allow access.';
      }
    }
    case 'block':
    case 'unblock': {
      if (!isOwner) throw new Error('Only the linked account owner can block or unblock contacts.');
      let target;
      try {
        target = parseTargetJid(args);
      } catch (error) {
        return error.message;
      }
      if (typeof sock.updateBlockStatus !== 'function') {
        throw new Error('Contact blocking is not available in this Baileys socket.');
      }
      return createConfirmation(context, `${command} ${target}`, async () => {
        await sock.updateBlockStatus(target, command);
        return `✅ ${command === 'block' ? 'Blocked' : 'Unblocked'} ${target}.`;
      });
    }
    case 'left': {
      if (!chat.endsWith('@g.us')) throw new Error('This command only works in a group chat.');
      if (typeof sock.groupMetadata !== 'function' || typeof sock.groupLeave !== 'function') {
        throw new Error('Leaving groups is not available in this Baileys socket.');
      }
      const metadata = await sock.groupMetadata(chat);
      return createConfirmation(context, `leave “${metadata.subject || chat}”`, async () => {
        await sock.sendMessage(sender, {
          text: `Confirmed. Leaving WhatsApp group “${metadata.subject || chat}”.`
        });
        await sock.groupLeave(chat);
        return null;
      });
    }
    case 'backup':
      return 'Session backups contain WhatsApp authentication keys and are never sent in chat. Use your database provider’s private backup/export tools; keep service-role credentials out of WhatsApp.';
    case 'gauth':
      return `No Google OAuth provider is configured. ${env.GOOGLE_CLIENT_ID ? 'A client ID is set, but this command does not collect passwords or tokens in chat.' : 'Set up a secure OAuth integration before enabling Google account features.'}`;
    case 'gupload':
      return 'Group-file uploads are not enabled: no private storage provider is configured. Do not send cloud-storage credentials in chat.';
    case 'reminder': {
      const match = /^(\d{1,5}[smhd])\s+([\s\S]+)$/i.exec(args);
      if (!match) return 'Usage: *.reminder 10m Take a break* (1 minute to 30 days). Reminders are in memory and are lost when the bot process restarts.';
      const delay = parseDuration(match[1]);
      const text = match[2].trim().slice(0, 500);
      const reminderId = randomBytes(3).toString('hex').toUpperCase();
      state.reminders ||= new Map();
      const timer = setTimeout(async () => {
        state.reminders.delete(reminderId);
        try {
          await sock.sendMessage(chat, { text: `⏰ Reminder: ${text}` });
        } catch (error) {
          context.logger?.error({ error: error.message, sessionId }, 'Could not send reminder');
        }
      }, delay);
      timer.unref?.();
      state.reminders.set(reminderId, timer);
      return `⏰ Reminder ${reminderId} set for ${match[1]} from now. It will not survive a service restart.`;
    }
    case 'task': {
      state.tasks ||= new Map();
      const taskKey = `${chat}:${sender}`;
      const tasks = state.tasks.get(taskKey) || [];
      if (args.toLowerCase() === 'list' || !args) {
        return tasks.length
          ? tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')
          : 'No tasks saved for you in this chat. Add one with *.task add Buy milk*, or *.task clear* to clear your list.';
      }
      if (args.toLowerCase() === 'clear') {
        return createConfirmation(context, 'clear your in-memory tasks in this chat', async () => {
          state.tasks.delete(taskKey);
        });
      }
      if (args.toLowerCase().startsWith('add ')) {
        if (tasks.length >= 50) return 'Task list is full (50 tasks). Use *.task clear* before adding more.';
        const task = args.slice(4).trim();
        if (!task) return 'Usage: *.task add Task text*.';
        tasks.push(task.slice(0, 200));
        state.tasks.set(taskKey, tasks);
        return '✅ Task added.';
      }
      return 'Usage: *.task add Task text*, *.task list*, or *.task clear*. Tasks are stored in memory only.';
    }
    case 'tog': {
      if (!isOwner) throw new Error('Only the linked account owner can change bot feature toggles.');
      const toggleNames = ['antiedit', 'read', 'online'];
      if (!args) {
        return toggleNames.map(name =>
          `${name}: ${Boolean(state[toggleStateKey(name)]) ? 'on' : 'off'}`
        ).join('\n');
      }
      const match = /^(antiedit|read|online)\s+(on|off)$/i.exec(args);
      if (!match) return 'Usage: *.tog antiedit on* (also: read, online). Use *.call on* for call handling.';
      const name = match[1].toLowerCase();
      const enabled = match[2].toLowerCase() === 'on';
      if (['online'].includes(name) && !isOwner) throw new Error('Only the linked account owner can change account presence.');
      state[toggleStateKey(name)] = enabled;
      if (name === 'online') await sock.sendPresenceUpdate(enabled ? 'available' : 'unavailable');
      return `${name} set to ${enabled ? 'on' : 'off'}.`;
    }
    case 'update':
      if (args.toLowerCase() === 'now') {
        return 'This command does not download or replace code. Update the project files on this PC, then restart START.bat; it will start the bot again.';
      }
      if (!env.BOT_UPDATE_URL) return 'Update check is unavailable: set BOT_UPDATE_URL to a trusted JSON version endpoint in the local .env file.';
      try {
        const response = await fetch(env.BOT_UPDATE_URL, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Update endpoint returned HTTP ${response.status}.`);
        const data = await response.json();
        return `Configured latest version: ${String(data.version || 'unknown')}\nUpdate the project files on this PC, then restart START.bat; this command does not download code.`;
      } catch (error) {
        return `Could not check updates: ${error.message}`;
      }
    case 'ytlogin':
      return 'YouTube login is not configured. For safety, never send Google passwords, cookies, or OAuth tokens in WhatsApp.';
    default:
      return `That command is not available in this build. Send *.menu* to see the supported commands.`;
  }
}

function parseToggle(args, current, name) {
  const value = args.trim().toLowerCase();
  if (!value) return !Boolean(current);
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error(`Usage: *.${name} on* or *.${name} off*.`);
}

function toggleStateKey(name) {
  return {
    antiedit: 'antiEdit',
    call: 'rejectCalls',
    read: 'readReceipts',
    online: 'onlinePresence'
  }[name];
}

module.exports = {
  COMMAND_GROUPS,
  extractText,
  isEditMessage,
  parseCommand,
  renderMenu,
  shouldHandleMessage,
  evaluateExpression,
  executeCommand,
  senderJid,
  quotedMessage
};
