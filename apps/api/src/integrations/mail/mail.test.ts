import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpMailer, createMailer, createSmtpMailer, disabledMailer, invitationEmail, passwordResetEmail } from './index';

/** A minimal SMTP server on a local port: speaks just enough of the protocol to receive one message. */
async function fakeSmtp(options: { rejectRecipient?: boolean } = {}) {
  const received: { from: string[]; to: string[]; data: string } = { from: [], to: [], data: '' };
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          } else received.data += `${line}\n`;
          continue;
        }
        if (/^(EHLO|HELO)/i.test(line)) socket.write('250 test\r\n');
        else if (/^MAIL FROM/i.test(line)) {
          received.from.push(line);
          socket.write('250 ok\r\n');
        } else if (/^RCPT TO/i.test(line)) {
          received.to.push(line);
          socket.write(options.rejectRecipient ? '550 no such user person@example.com\r\n' : '250 ok\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 go\r\n');
        } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as net.AddressInfo).port, received, close: () => new Promise((r) => server.close(r)) };
}

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

const config = (port: number) => ({ host: '127.0.0.1', port, secure: false, from: 'HR <no-reply@example.com>', requireTls: false, timeoutMs: 3000 });
/** Undo quoted-printable soft line breaks and escapes. */
const decode = (body: string) => body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

describe('SMTP mailer', () => {
  it('delivers an invitation over SMTP with the single-use link', async () => {
    const smtp = await fakeSmtp();
    closers.push(smtp.close);
    await createSmtpMailer(config(smtp.port)).send(invitationEmail({ to: 'person@example.com', companyName: 'Acme', token: 'tok-123', webAppUrl: 'https://hr.example.com/' }));
    expect(smtp.received.to.join()).toContain('person@example.com');
    const body = decode(smtp.received.data);
    expect(body).toContain('https://hr.example.com/accept-invitation?token=tok-123');
    expect(body).toContain('expires in 7 days');
  });

  it('reports a failure without repeating the recipient or the provider message', async () => {
    const smtp = await fakeSmtp({ rejectRecipient: true });
    closers.push(smtp.close);
    const error = await createSmtpMailer(config(smtp.port))
      .send(passwordResetEmail({ to: 'person@example.com', token: 't', webAppUrl: 'https://hr.example.com' }))
      .then(() => null, (e: Error) => e);
    expect(error?.name).toBe('MailError');
    expect(error?.message).not.toMatch(/person|no such user/);
  });

  it('refuses to send in clear text when TLS is required and the server cannot upgrade', async () => {
    const smtp = await fakeSmtp();
    closers.push(smtp.close);
    await expect(createSmtpMailer({ ...config(smtp.port), requireTls: true }).send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(/could not be sent/);
    expect(smtp.received.data).toBe('');
  });
});

describe('mailer selection', () => {
  const base = { NODE_ENV: 'test' as const, MAIL_API_KEY: undefined, SMTP_PORT: 587, SMTP_SECURE: false, SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: undefined };
  it('is disabled unless smtp, resend or brevo is chosen, and a disabled mailer never pretends to send', async () => {
    expect(createMailer({ ...base, MAIL_DRIVER: undefined }).driver).toBe('disabled');
    await expect(disabledMailer.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow(/not configured/);
  });
  it('builds the smtp, resend and brevo drivers from the configuration', () => {
    expect(createMailer({ ...base, MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@example.com' }).driver).toBe('smtp');
    expect(createMailer({ ...base, MAIL_DRIVER: 'resend', MAIL_API_KEY: 're_123', MAIL_FROM: 'a@example.com' }).driver).toBe('resend');
    expect(createMailer({ ...base, MAIL_DRIVER: 'brevo', MAIL_API_KEY: 'xkeysib_123', MAIL_FROM: 'a@example.com' }).driver).toBe('brevo');
  });
});

describe('HTTPS email API mailer', () => {
  it('sends via Resend API and Brevo API without exposing recipient on HTTP error', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const okFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await createHttpMailer({ driver: 'resend', apiKey: 're_secret', from: 'GSC Peoples <hr@example.com>', fetchImpl: okFetch }).send({
      to: 'person@example.com',
      subject: 'Invite',
      text: 'Hello',
    });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_secret');

    await createHttpMailer({ driver: 'brevo', apiKey: 'xkeysib_secret', from: 'GSC Peoples <hr@example.com>', fetchImpl: okFetch }).send({
      to: 'person@example.com',
      subject: 'Invite',
      text: 'Hello',
    });
    expect(calls[1]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[1]!.init.headers as Record<string, string>)['api-key']).toBe('xkeysib_secret');
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({
      sender: { name: 'GSC Peoples', email: 'hr@example.com' },
      to: [{ email: 'person@example.com' }],
    });

    const failFetch = (async () => new Response('bad person@example.com', { status: 401 })) as unknown as typeof fetch;
    const err = await createHttpMailer({ driver: 'brevo', apiKey: 'bad', from: 'hr@example.com', fetchImpl: failFetch })
      .send({ to: 'person@example.com', subject: 's', text: 't' })
      .then(() => null, (e: Error) => e);
    expect(err?.name).toBe('MailError');
    expect(err?.message).toBe('Email could not be sent (HTTP 401)');
  });
});
