// A throwaway SMTP server for tests: accepts any message and hands it to whoever is waiting.
import net from 'node:net';

const decodeQuotedPrintable = (s) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

export function startSmtpSink(port) {
  const messages = [];
  const waiting = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let data = null;
    let to = '';
    const say = (line) => socket.write(line + '\r\n');
    say('220 test sink');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (data !== null) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          const message = { to, raw: data + buffer.slice(0, end), text: decodeQuotedPrintable(data + buffer.slice(0, end)) };
          buffer = buffer.slice(end + 5);
          data = null;
          const next = waiting.shift();
          if (next) next(message); else messages.push(message);
          say('250 queued');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') say('250 test sink');
        else if (verb === 'RCPT') { to = (/<([^>]*)>/.exec(line) || [])[1] || ''; say('250 ok'); }
        else if (verb === 'DATA') { data = ''; say('354 go ahead'); }
        else if (verb === 'QUIT') { say('221 bye'); socket.end(); }
        else say('250 ok');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    /** The next message to arrive (or one that already has). Rejects if none comes. */
    next: (timeoutMs = 5000) => new Promise((res, rej) => {
      if (messages.length) return res(messages.shift());
      const timer = setTimeout(() => { waiting.splice(waiting.indexOf(got), 1); rej(new Error('No email arrived')); }, timeoutMs);
      const got = (m) => { clearTimeout(timer); res(m); };
      waiting.push(got);
    }),
    count: () => messages.length,
    close: () => new Promise((r) => server.close(r)),
  })));
}
