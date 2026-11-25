/**
 * Local mail catcher for the browser suite: accepts SMTP on E2E_SMTP_PORT and exposes what it received over HTTP
 * on E2E_MAIL_PORT, so a test can open the invitation or reset link exactly as the recipient would. Listens on
 * 127.0.0.1 only; nothing is ever relayed anywhere.
 */
import http from 'node:http';
import net from 'node:net';

const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 4425);
const HTTP_PORT = Number(process.env.E2E_MAIL_PORT ?? 4426);
const messages = [];

/** Undo the quoted-printable transfer encoding used for long lines. */
const decode = (body) => body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

net
  .createServer((socket) => {
    let inData = false;
    let buffer = '';
    let to = [];
    let data = [];
    socket.on('error', () => undefined);
    socket.write('220 e2e-sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push({ to, text: decode(data.join('\n')) });
            to = [];
            data = [];
            socket.write('250 queued\r\n');
          } else data.push(line);
        } else if (/^RCPT TO:/i.test(line)) {
          to.push(/<([^>]+)>/.exec(line)?.[1] ?? '');
          socket.write('250 ok\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 end with .\r\n');
        } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  })
  .listen(SMTP_PORT, '127.0.0.1');

http
  .createServer((req, res) => {
    if (req.method === 'DELETE') messages.length = 0;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(messages));
  })
  .listen(HTTP_PORT, '127.0.0.1');
