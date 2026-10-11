import { describe, expect, it } from 'vitest';
import { checkBasicAuth, emailText, emailToBatch, htmlToText, normaliseEmail, senderOf, spfPassed } from '../inboundEmail.mjs';
import { MAX_FILE_BYTES, MAX_FILES_PER_BATCH, MAX_TEXT_CHARS } from '../intake.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.7 statement');
const attachment = (name, bytes, extra = {}) => ({ Name: name, Content: Buffer.from(bytes).toString('base64'), ContentType: 'application/octet-stream', ContentLength: bytes.length, ...extra });
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('checkBasicAuth', () => {
  const creds = { username: 'postmark', password: 's3cret' };

  it('accepts exactly the configured credentials', () => {
    expect(checkBasicAuth(basic('postmark', 's3cret'), creds)).toBe(true);
    expect(checkBasicAuth(basic('postmark', 's3cret!'), creds)).toBe(false);
    expect(checkBasicAuth(basic('other', 's3cret'), creds)).toBe(false);
    expect(checkBasicAuth('Bearer abc', creds)).toBe(false);
    expect(checkBasicAuth(undefined, creds)).toBe(false);
  });

  it('refuses everything when no credentials are configured, rather than treating blank as a match', () => {
    expect(checkBasicAuth(basic('', ''), { username: '', password: '' })).toBe(false);
    expect(checkBasicAuth(basic('postmark', ''), { username: 'postmark', password: undefined })).toBe(false);
  });
});

describe('who an email is from', () => {
  it('tidies an address, and refuses what is not one', () => {
    expect(normaliseEmail('  Ray@Example.CO.uk ')).toBe('ray@example.co.uk');
    for (const bad of ['', 'ray', 'ray@', 'ray@example', 'a b@c.com', 'ray@example.com, other@example.com', null]) expect(normaliseEmail(bad)).toBeNull();
  });

  it('reads the sender from the parsed field, or from a display-name header', () => {
    expect(senderOf({ FromFull: { Email: 'Ray@Example.com', Name: 'Ray' }, From: 'someone@else.com' })).toBe('ray@example.com');
    expect(senderOf({ From: 'Ray Khan <ray@example.com>' })).toBe('ray@example.com');
    expect(senderOf({ From: 'ray@example.com' })).toBe('ray@example.com');
    expect(senderOf({ From: 'nonsense' })).toBeNull();
    expect(senderOf(undefined)).toBeNull();
  });
});

describe('spfPassed', () => {
  it('needs a Received-SPF header that says pass', () => {
    const headers = (value) => ({ Headers: [{ Name: 'X-Other', Value: 'x' }, { Name: 'Received-SPF', Value: value }] });
    expect(spfPassed(headers('Pass (sender SPF authorized) identity=mailfrom'))).toBe(true);
    for (const bad of ['Fail (domain does not designate)', 'SoftFail', 'None', 'Neutral', 'permerror']) expect(spfPassed(headers(bad))).toBe(false);
    expect(spfPassed({ Headers: [] })).toBe(false);
    expect(spfPassed({})).toBe(false);
  });
});

describe('htmlToText', () => {
  it('drops markup and scripts, keeps line breaks and entities', () => {
    expect(htmlToText('<html><head><style>p{}</style></head><body><p>Hi Ray,</p><p>Our UTR is 12345&nbsp;67890 &amp; VAT&#39;s done.<br>Thanks</p><script>alert(1)</script></body></html>')).toBe("Hi Ray,\nOur UTR is 12345 67890 & VAT's done.\nThanks");
    expect(htmlToText(undefined)).toBe('');
  });
});

describe('emailText', () => {
  const payload = { FromFull: { Email: 'ray@example.com' }, Subject: '  Bank   statement\nMarch ', Date: 'Sat, 10 Oct 2026 10:00:00 +0100', TextBody: 'Please see attached.' };

  it('says who forwarded it, what it is about, and the message', () => {
    expect(emailText(payload)).toBe('Email forwarded by ray@example.com\nSubject: Bank statement March\nDate: Sat, 10 Oct 2026 10:00:00 +0100\n\nPlease see attached.');
  });

  it('falls back to the HTML body, and names attachments it could not read', () => {
    const text = emailText({ ...payload, TextBody: '', HtmlBody: '<p>Hello</p>' }, ['accounts.xlsx', 'old.zip']);
    expect(text).toContain('\n\nHello');
    expect(text.endsWith('Attachments that could not be read: accounts.xlsx, old.zip')).toBe(true);
  });

  it('clips a long body but keeps the header and the note about attachments', () => {
    const text = emailText({ ...payload, TextBody: 'x'.repeat(MAX_TEXT_CHARS * 2) }, ['a.zip']);
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(text.startsWith('Email forwarded by ray@example.com')).toBe(true);
    expect(text.endsWith('Attachments that could not be read: a.zip')).toBe(true);
  });
});

describe('emailToBatch', () => {
  it('keeps readable attachments, trusting their bytes over their label, and the email text as its own part', () => {
    const batch = emailToBatch({ FromFull: { Email: 'ray@example.com' }, TextBody: 'hi', Attachments: [attachment('IMG_1', JPEG), attachment('statement.pdf', PDF, { ContentType: 'image/jpeg' })] });
    expect(batch.files.map((f) => [f.fileName, f.contentType])).toEqual([['IMG_1', 'image/jpeg'], ['statement.pdf', 'application/pdf']]);
    expect(batch.skipped).toEqual([]);
    expect(batch.text).toContain('Email forwarded by ray@example.com');
  });

  it('names what it cannot read instead of dropping it silently', () => {
    const batch = emailToBatch({
      FromFull: { Email: 'ray@example.com' },
      Attachments: [attachment('accounts.xlsx', Buffer.from('PK\u0003\u0004zip'), { ContentType: 'application/vnd.ms-excel' }), attachment('liar.pdf', JPEG, { ContentType: 'application/pdf' }), attachment('empty.pdf', Buffer.alloc(0), { ContentType: 'application/pdf' }), attachment('note.txt', Buffer.from('hello'), { ContentType: 'text/plain' })],
    });
    expect(batch.files.map((f) => f.fileName)).toEqual(['liar.pdf', 'note.txt']);
    expect(batch.skipped).toEqual(['accounts.xlsx', 'empty.pdf']);
    expect(batch.text).toContain('Attachments that could not be read: accounts.xlsx, empty.pdf');
  });

  it('ignores small inline images such as a signature logo, without mentioning them', () => {
    const batch = emailToBatch({ FromFull: { Email: 'ray@example.com' }, Attachments: [attachment('logo.png', JPEG, { ContentID: 'cid:logo', ContentType: 'image/jpeg' }), attachment('photo.jpg', JPEG, { ContentType: 'image/jpeg' })] });
    expect(batch.files.map((f) => f.fileName)).toEqual(['photo.jpg']);
    expect(batch.skipped).toEqual([]);
  });

  it('skips files past the limits, in order, by name', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_FILE_BYTES)]);
    const many = Array.from({ length: MAX_FILES_PER_BATCH + 2 }, (_, i) => attachment(`p${i}.jpg`, JPEG, { ContentType: 'image/jpeg' }));
    const batch = emailToBatch({ FromFull: { Email: 'ray@example.com' }, Attachments: [attachment('huge.jpg', big, { ContentType: 'image/jpeg' }), ...many] });
    expect(batch.files).toHaveLength(MAX_FILES_PER_BATCH);
    expect(batch.skipped).toEqual(['huge.jpg', 'p10.jpg', 'p11.jpg']);
  });

  it('copes with an email that has no attachments at all', () => {
    expect(emailToBatch({ FromFull: { Email: 'ray@example.com' }, TextBody: 'just words' }).files).toEqual([]);
    expect(emailToBatch({ FromFull: { Email: 'ray@example.com' }, Attachments: 'nonsense' }).files).toEqual([]);
  });
});
