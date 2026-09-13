import { describe, expect, it } from 'vitest';
import { ALLOWED_CONTENT_TYPES, cleanName, cleanNote, DEFAULT_EXPIRY_DAYS, expiryFor, generateToken, hashToken, linkProblem, looksLikeToken, matchesDeclaredType, MAX_EXPIRY_DAYS, MAX_FILE_BYTES, MAX_FILES_PER_LINK, publicJobView, safeFileName, validateUpload } from '../portal.mjs';

describe('tokens', () => {
  it('generates 43-character base64url tokens from 32 random bytes, and never the same one twice', () => {
    const a = generateToken();
    const b = generateToken();
    expect(looksLikeToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('stores only a hash — the token cannot be recovered from it, but it finds the row', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it('rejects anything that does not look like a token before it reaches the database', () => {
    for (const bad of ['', 'short', 'x'.repeat(42), 'x'.repeat(44), `${'a'.repeat(42)}!`, "'; drop table--", null, 42]) {
      expect(looksLikeToken(bad)).toBe(false);
    }
  });
});

describe('expiry', () => {
  const now = () => new Date('2026-09-12T00:00:00Z');
  const days = (d) => d * 86_400_000;

  it('defaults to thirty days and caps at ninety', () => {
    expect(expiryFor(undefined, now).getTime() - now().getTime()).toBe(days(DEFAULT_EXPIRY_DAYS));
    expect(expiryFor(365, now).getTime() - now().getTime()).toBe(days(MAX_EXPIRY_DAYS));
    expect(expiryFor(-5, now).getTime() - now().getTime()).toBe(days(DEFAULT_EXPIRY_DAYS));
    expect(expiryFor('nope', now).getTime() - now().getTime()).toBe(days(DEFAULT_EXPIRY_DAYS));
    expect(expiryFor(7, now).getTime() - now().getTime()).toBe(days(7));
  });
});

describe('linkProblem', () => {
  const now = () => new Date('2026-09-12T12:00:00Z');
  const live = { expiresAt: '2026-10-01T00:00:00Z', revokedAt: null, usedAt: null };

  it('is null for a live link', () => {
    expect(linkProblem(live, now)).toBeNull();
  });

  it('names each way a link stops working', () => {
    expect(linkProblem(null, now)).toBe('not_found');
    expect(linkProblem({ ...live, revokedAt: '2026-09-11T00:00:00Z' }, now)).toBe('revoked');
    expect(linkProblem({ ...live, usedAt: '2026-09-11T00:00:00Z' }, now)).toBe('used');
    expect(linkProblem({ ...live, expiresAt: '2026-09-12T11:59:59Z' }, now)).toBe('expired');
  });

  it('treats the exact expiry instant as expired', () => {
    expect(linkProblem({ ...live, expiresAt: '2026-09-12T12:00:00Z' }, now)).toBe('expired');
  });
});

describe('validateUpload', () => {
  const pdf = { fileName: 'bank statement.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4 hello').toString('base64') };

  it('accepts a normal document', () => {
    expect(validateUpload(pdf)).toEqual({ ok: true, fileName: 'bank statement.pdf', contentType: 'application/pdf' });
  });

  it('refuses a file over the cap from its declared size, before any decoding', () => {
    const tooBig = { ...pdf, contentBase64: 'A'.repeat(Math.ceil(((MAX_FILE_BYTES + 1024) * 4) / 3)) };
    expect(validateUpload(tooBig)).toEqual({ ok: false, error: 'too_large' });
  });

  it('refuses executables and anything else not on the list', () => {
    expect(validateUpload({ ...pdf, contentType: 'application/x-msdownload' })).toEqual({ ok: false, error: 'unsupported_type' });
    expect(validateUpload({ ...pdf, contentType: 'text/html' })).toEqual({ ok: false, error: 'unsupported_type' });
    expect(validateUpload({ ...pdf, contentType: undefined })).toEqual({ ok: false, error: 'unsupported_type' });
  });

  it('refuses an empty or malformed body', () => {
    expect(validateUpload({ ...pdf, contentBase64: '' })).toEqual({ ok: false, error: 'empty' });
    expect(validateUpload({ ...pdf, contentBase64: 'not base64 !!' })).toEqual({ ok: false, error: 'malformed' });
  });

  it('caps the number of files a single link can deliver', () => {
    expect(validateUpload(pdf, { existingCount: MAX_FILES_PER_LINK })).toEqual({ ok: false, error: 'too_many_files' });
    expect(validateUpload(pdf, { existingCount: MAX_FILES_PER_LINK - 1 }).ok).toBe(true);
  });

  it('matches the type case-insensitively but stores it lower-cased', () => {
    expect(validateUpload({ ...pdf, contentType: 'Application/PDF' })).toMatchObject({ ok: true, contentType: 'application/pdf' });
  });

  it('covers the formats a client actually sends', () => {
    for (const type of ['image/jpeg', 'image/png', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) {
      expect(ALLOWED_CONTENT_TYPES.has(type)).toBe(true);
    }
  });
});

describe('matchesDeclaredType', () => {
  // validateUpload only ever checks the label a client sent; this checks
  // the bytes actually behind it — the two are independent, so this suite
  // uses matchesDeclaredType directly rather than routing through validateUpload.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const pdf = Buffer.from('%PDF-1.4 hello');
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0])]);
  const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // an .exe's actual signature, whatever it's labelled as

  it('accepts a file whose bytes actually match its declared type', () => {
    expect(matchesDeclaredType(pdf, 'application/pdf')).toBe(true);
    expect(matchesDeclaredType(png, 'image/png')).toBe(true);
    expect(matchesDeclaredType(jpeg, 'image/jpeg')).toBe(true);
    expect(matchesDeclaredType(heic, 'image/heic')).toBe(true);
    expect(matchesDeclaredType(ole, 'application/vnd.ms-excel')).toBe(true);
    expect(matchesDeclaredType(ole, 'application/msword')).toBe(true);
    expect(matchesDeclaredType(zip, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(matchesDeclaredType(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(matchesDeclaredType(Buffer.from('name,amount\nBank,100\n'), 'text/csv')).toBe(true);
  });

  it('is case-insensitive on the declared type, matching validateUpload\'s own normalising', () => {
    expect(matchesDeclaredType(pdf, 'Application/PDF')).toBe(true);
  });

  it('rejects an executable labelled as any of the allowed document types', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'application/vnd.ms-excel', 'application/msword', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']) {
      expect(matchesDeclaredType(executable, type)).toBe(false);
    }
  });

  it('rejects one allowed type\'s bytes labelled as a different allowed type', () => {
    expect(matchesDeclaredType(png, 'application/pdf')).toBe(false);
    expect(matchesDeclaredType(pdf, 'image/png')).toBe(false);
    expect(matchesDeclaredType(zip, 'application/pdf')).toBe(false);
  });

  it('rejects binary content mislabelled as CSV', () => {
    expect(matchesDeclaredType(png, 'text/csv')).toBe(false);
    expect(matchesDeclaredType(Buffer.from([0x00, 0x01, 0x02, 0x41, 0x42]), 'text/csv')).toBe(false);
  });

  it('rejects a type it has no bytes to check yet, rather than accepting on faith', () => {
    expect(matchesDeclaredType(pdf, 'application/vnd.android.package-archive')).toBe(false);
  });
});

describe('safeFileName', () => {
  it('strips path separators and control characters', () => {
    expect(safeFileName('../../etc/passwd', '.pdf')).toBe('..-..-etc-passwd.pdf');
    expect(safeFileName('C:\\Users\\me\\file.xlsx', '.xlsx')).toBe('C:-Users-me-file.xlsx');
    expect(safeFileName(`a${String.fromCharCode(0)}b${String.fromCharCode(31)}c.pdf`, '.pdf')).toBe('abc.pdf');
  });

  it('forces the extension the declared type says, not the one typed', () => {
    expect(safeFileName('invoice.exe', '.pdf')).toBe('invoice.pdf');
    expect(safeFileName('invoice', '.png')).toBe('invoice.png');
  });

  it('bounds the length and never produces an empty name', () => {
    expect(safeFileName('x'.repeat(500), '.pdf').length).toBeLessThanOrEqual(124);
    expect(safeFileName('', '.pdf')).toBe('document.pdf');
    expect(safeFileName(undefined, '.csv')).toBe('document.csv');
  });
});

describe('cleanNote and cleanName', () => {
  it('trims, bounds, and turns blank into null', () => {
    expect(cleanNote('  fine  ')).toBe('fine');
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(42)).toBeNull();
    expect(cleanNote('x'.repeat(1000)).length).toBe(500);
    expect(cleanName(' Jane Smith ')).toBe('Jane Smith');
    expect(cleanName('')).toBeNull();
  });
});

describe('publicJobView', () => {
  const data = {
    practice: { name: 'Farhan & Raihan' },
    clients: [{ id: 'cl_1', name: 'Acme Ltd', notes: 'internal: difficult' }],
    jobs: [
      { id: 'job_1', clientId: 'cl_1', name: '2026 Annual Accounts', periodEnd: '2026-03-31', dueDate: '2026-12-31', status: 'waiting_for_records', assigneeUserId: 'u_adnan' },
      { id: 'job_2', clientId: 'cl_1', name: 'VAT Return 2026 Q2', periodEnd: '2026-06-30', dueDate: '2026-08-07', status: 'waiting_client_approval' },
    ],
    requestItems: [
      { id: 'req_1', jobId: 'job_1', label: 'Bank statements', status: 'missing' },
      { id: 'req_2', jobId: 'job_1', label: 'Sales invoices', status: 'received' },
      { id: 'req_3', jobId: 'job_2', label: 'Other', status: 'missing' },
    ],
    approvals: [{ jobId: 'job_2', kind: 'client', status: 'pending' }],
    identifiers: [{ clientId: 'cl_1', kind: 'utr', value: '1234567890' }],
  };

  it('exposes exactly what the client needs for an upload link and nothing else', () => {
    const view = publicJobView(data, { jobId: 'job_1', clientId: 'cl_1', purpose: 'upload', expiresAt: '2026-10-01T00:00:00Z' });
    expect(view).toEqual({
      practiceName: 'Farhan & Raihan',
      clientName: 'Acme Ltd',
      jobName: '2026 Annual Accounts',
      periodEnd: '2026-03-31',
      dueDate: '2026-12-31',
      purpose: 'upload',
      outstanding: [{ id: 'req_1', label: 'Bank statements' }],
      approvalPending: false,
      message: null,
      hasAttachment: false,
      expiresAt: '2026-10-01T00:00:00Z',
    });
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('1234567890');
    expect(serialised).not.toContain('difficult');
    expect(serialised).not.toContain('u_adnan');
    expect(serialised).not.toContain('VAT Return');
  });

  it('shows approval state for an approve link, and no request items', () => {
    const view = publicJobView(data, { jobId: 'job_2', clientId: 'cl_1', purpose: 'approve', expiresAt: 'x', attachmentId: 'up_9', message: 'Please review.' });
    expect(view).toMatchObject({ approvalPending: true, outstanding: [], hasAttachment: true, message: 'Please review.' });
  });

  it('is null when the job and client do not belong together — a link can never cross clients', () => {
    expect(publicJobView(data, { jobId: 'job_1', clientId: 'cl_other', purpose: 'upload' })).toBeNull();
    expect(publicJobView(data, { jobId: 'job_missing', clientId: 'cl_1', purpose: 'upload' })).toBeNull();
    expect(publicJobView({ ...data, clients: [{ id: 'cl_2', name: 'Other' }, ...data.clients], jobs: [{ ...data.jobs[0], clientId: 'cl_2' }] }, { jobId: 'job_1', clientId: 'cl_1', purpose: 'upload' })).toBeNull();
  });
});
