'use strict';

const { Writable } = require('stream');
const os = require('os');

const ansi = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  white: '\u001b[37m',
  brightRed: '\u001b[91m',
  brightGreen: '\u001b[92m',
  brightYellow: '\u001b[93m',
  brightBlue: '\u001b[94m',
  brightMagenta: '\u001b[95m',
  brightCyan: '\u001b[96m',
  gray: '\u001b[90m'
};

const paint = (color, value) => `${ansi[color] || ''}${value}${ansi.reset}`;
const plain = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const enabled = () => !process.env.NO_COLOR && process.env.TANDA_PLAIN_LOGS !== '1' && process.stdout.isTTY;
const color = (name, value) => enabled() ? paint(name, value) : String(value);
const displayWidth = value => [...String(value)].reduce((width, char) => width + (char === '⚡' ? 2 : 1), 0);
const padDisplay = (value, width) => `${value}${' '.repeat(Math.max(0, width - displayWidth(value)))}`;

function timeLabel(epoch) {
  const date = new Date(Number(epoch) || Date.now());
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

function levelLabel(level) {
  const n = Number(level);
  if (n >= 60) return color('brightRed', ' FATAL ');
  if (n >= 50) return color('red', ' ERROR ');
  if (n >= 40) return color('brightYellow', ' WARN  ');
  if (n >= 30) return color('brightBlue', ' INFO  ');
  if (n >= 20) return color('gray', ' DEBUG ');
  return color('gray', ' TRACE ');
}

function detailLine(record) {
  const parts = [];
  if (record.name) parts.push(`${color('cyan', 'bot=')}${plain(record.name)}`);
  if (record.port) parts.push(`${color('cyan', 'port=')}${record.port}`);
  if (record.sessionId) parts.push(`${color('magenta', 'device=')}${plain(record.sessionId)}`);
  if (record.phone) parts.push(`${color('magenta', 'phone=')}${plain(record.phone)}`);
  if (record.command) parts.push(`${color('brightCyan', 'cmd=')}${plain(record.command)}`);
  if (record.chatType) parts.push(`${color('blue', 'chat=')}${plain(record.chatType)}`);
  if (record.status != null) parts.push(`${color('yellow', 'status=')}${plain(record.status)}`);
  if (record.durationMs != null) parts.push(`${color('green', 'time=')}${record.durationMs}ms`);
  if (record.savedRows != null) parts.push(`${color('cyan', 'saved=')}${record.savedRows}`);
  if (record.restorableSessions != null) parts.push(`${color('green', 'restorable=')}${record.restorableSessions}`);
  const err = record.err;
  const error = record.error || (typeof err === 'string' ? err : err?.message);
  if (error) parts.push(`${color('brightRed', 'error=')}${plain(error)}`);
  if (record.reason) parts.push(`${color('yellow', 'reason=')}${plain(record.reason)}`);
  return parts.length ? ` ${color('gray', '│')} ${parts.join(color('gray', '  ·  '))}` : '';
}

function createTerminalDestination() {
  let buffer = '';
  return new Writable({
    write(chunk, encoding, callback) {
      try {
        buffer += chunk.toString();
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          let record;
          try { record = JSON.parse(line); }
          catch { process.stdout.write(`${line}${os.EOL}`); continue; }
          const timestamp = color('gray', timeLabel(record.time));
          const level = levelLabel(record.level);
          const message = plain(record.msg || 'Log event');
          const messageColor = Number(record.level) >= 50 ? 'brightRed' : Number(record.level) >= 40 ? 'brightYellow' : record.terminalEvent === 'command_success' ? 'brightGreen' : record.terminalEvent === 'command_start' ? 'brightCyan' : 'white';
          process.stdout.write(`${timestamp} ${level} ${color(messageColor, message)}${detailLine(record)}${os.EOL}`);
          const stack = record.stack || record.trace || record.err?.stack;
          if (stack && Number(record.level) >= 50) process.stdout.write(`${color('gray', '           └─ ')}${plain(stack)}${os.EOL}`);
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    final(callback) {
      if (buffer.trim()) process.stdout.write(`${buffer}${os.EOL}`);
      callback();
    }
  });
}

function printBanner({ name = 'DECAN XMD', version = '1.2.0' } = {}) {
  const width = 62;
  const line = '═'.repeat(width);
  const border = value => color('brightCyan', value);
  const row = (label, text, labelColor, textColor) => {
    const paddedLabel = label.padEnd(9, ' ');
    const prefix = `  ${paddedLabel}  `;
    return `${border('║')}${color(labelColor, prefix)}${color(textColor, text)}${' '.repeat(Math.max(0, width - displayWidth(prefix) - displayWidth(text)))}${border('║')}`;
  };
  const title = padDisplay(`  ⚡ ${name}  ·  v${version}`, width);
  const lines = [
    '',
    `${border(`╔${line}╗`)}`,
    `${border('║')}${color('brightWhite', title)}${border('║')}`,
    `${border(`╠${line}╣`)}`,
    row('● ONLINE', 'WhatsApp automation runtime ready', 'brightGreen', 'white'),
    row('MODE', 'TERMINAL ONLY · HOSTING PANEL', 'brightBlue', 'brightWhite'),
    row('LOGS', 'Live device, command and error events', 'yellow', 'white'),
    `${border(`╚${line}╝`)}`,
    ''
  ];
  process.stdout.write(lines.join(os.EOL) + os.EOL);
}

module.exports = { createTerminalDestination, printBanner };
