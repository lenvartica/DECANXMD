'use strict';

const STATUS_EMOJIS = ['❤️', '🔥', '👍', '😂', '😮', '🙏', '✨', '💯', '😎', '🎉'];
const AUTOMATIONS = [
  { id: 'autoviewstatus', command: 'autoviewstatus', key: 'autoviewstatus', label: 'Auto view statuses', description: 'Automatically mark status updates as viewed.', kind: 'boolean' },
  { id: 'autolikestatus', command: 'autolikestatus', key: 'autoreactstatus', label: 'Auto like statuses', description: 'Automatically react to statuses with the selected emoji set.', kind: 'status-reaction' },
  { id: 'autoreadmessages', command: 'autoreadmessages', key: 'autoread', label: 'Auto read messages', description: 'Automatically mark incoming messages as read.', kind: 'boolean' },
  { id: 'autoreact', command: 'autoreact', key: 'autoreact', label: 'Auto react to messages', description: 'React to incoming messages using the selected emoji set.', kind: 'reaction' },
  { id: 'autotyping', command: 'autotyping', key: 'autotyping', label: 'Auto typing presence', description: 'Show a typing indicator while commands run.', kind: 'boolean' },
  { id: 'autorecording', command: 'autorecording', key: 'autorecording', label: 'Auto recording presence', description: 'Show a recording indicator while commands run.', kind: 'boolean' },
  { id: 'autobio', command: 'autobio', key: 'autobio', label: 'Auto profile bio', description: 'Update the profile About text with the current time.', kind: 'boolean' },
  { id: 'antidelete', command: 'antidelete', key: 'antidelete', label: 'Anti-delete notices', description: 'Send a private notice when another user deletes a message.', kind: 'boolean' },
  { id: 'antiedit', command: 'antiedit', key: 'antiedit', label: 'Anti-edit notices', description: 'Send the owner a notice when a message is edited.', kind: 'boolean' },
  { id: 'antiviewonce', command: 'antiviewonce', key: 'vv2', label: 'View-once notices', description: 'Notify the owner when a view-once message arrives.', kind: 'boolean' },
  { id: 'call', command: 'call', key: 'anticall', label: 'Incoming call guard', description: 'Reject incoming WhatsApp calls.', kind: 'call-guard' },
  { id: 'scstatus', command: 'scstatus', key: 'scstatus', label: 'Status watcher', description: 'Choose whether to ignore, view, or save recent statuses.', kind: 'status-mode' }
];

const emojiPattern = /^(?:\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}\p{Emoji_Modifier}]*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)$/u;

function readAutomation(store, sessionId, automation) {
  const saved = store.get(sessionId, automation.key, null);
  if (automation.kind === 'boolean') return { enabled: Boolean(saved) };
  if (automation.kind === 'call-guard') return { enabled: Boolean(saved?.on) };
  if (automation.kind === 'status-mode') return { value: ['off', 'view', 'save'].includes(saved) ? saved : 'off' };
  if (automation.kind === 'status-reaction' || automation.kind === 'reaction') {
    const savedEmojis = Array.isArray(saved?.emojis) && saved.emojis.length
      ? saved.emojis
      : saved?.emoji ? [saved.emoji] : STATUS_EMOJIS;
    return { enabled: Boolean(saved), emojis: savedEmojis };
  }
  throw new Error('Unsupported automation setting.');
}

function listAutomations(store, sessionId) {
  return AUTOMATIONS.map(item => ({ ...item, ...readAutomation(store, sessionId, item) }));
}

function normalizeEmojis(input) {
  if (typeof input !== 'string') throw new Error('Enter emojis separated by spaces or commas.');
  const values = input.split(/[,\s]+/).filter(Boolean);
  if (values.length > 12 || values.some(value => !emojiPattern.test(value))) {
    throw new Error('Use 1-12 valid emojis, separated by spaces or commas.');
  }
  return [...new Set(values)];
}

function updateAutomation(store, sessionId, id, patch) {
  const automation = AUTOMATIONS.find(item => item.id === id);
  if (!automation) throw new Error('Unknown automation setting.');
  if (automation.kind === 'status-mode') {
    if (!['off', 'view', 'save'].includes(patch.value)) throw new Error('Choose off, view, or save for the status watcher.');
    store.set(sessionId, automation.key, patch.value);
    return readAutomation(store, sessionId, automation);
  }
  if (typeof patch.enabled !== 'boolean') throw new Error('Choose whether this automation is on or off.');
  if (automation.kind === 'boolean') {
    store.set(sessionId, automation.key, patch.enabled);
  } else if (automation.kind === 'call-guard') {
    const current = store.get(sessionId, automation.key, { on: false, block: false, msg: '📵 Calls are not allowed. Please send a message instead.' });
    store.set(sessionId, automation.key, { ...current, on: patch.enabled, ...(patch.enabled ? { block: false } : {}) });
  } else if (automation.kind === 'status-reaction' || automation.kind === 'reaction') {
    if (!patch.enabled) {
      store.set(sessionId, automation.key, null);
    } else {
      const emojis = normalizeEmojis(patch.emojis);
      store.set(sessionId, automation.key, { emoji: emojis.length === 1 ? emojis[0] : null, emojis });
    }
  }
  return readAutomation(store, sessionId, automation);
}

module.exports = { AUTOMATIONS, STATUS_EMOJIS, listAutomations, normalizeEmojis, updateAutomation };
