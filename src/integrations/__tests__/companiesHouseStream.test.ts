import { describe, expect, it } from 'vitest';
import { describeChange, type CompaniesHouseChange } from '../companiesHouseStream';

const change = (fieldsChanged: string[], type: CompaniesHouseChange['type'] = 'changed'): CompaniesHouseChange => ({
  companyNumber: '01234567',
  type,
  fieldsChanged,
  publishedAt: '2026-09-12T10:00:00',
  seenAt: '2026-09-12T10:00:01Z',
});

describe('describeChange', () => {
  it('turns a dot-notation field path into what an accountant acts on', () => {
    expect(describeChange(change(['accounts.next_due']))).toBe('accounts deadline changed');
    expect(describeChange(change(['confirmation_statement.next_due']))).toBe('confirmation statement deadline changed');
  });

  it('lists several changes readably, without repeating a label', () => {
    expect(describeChange(change(['accounts.next_due', 'company_name']))).toBe('accounts deadline and company name changed');
    // The family catch-all drops out once a specific label in that family matched,
    // so this doesn't read "accounts deadline and accounts dates changed".
    expect(describeChange(change(['accounts.next_due', 'accounts.next_accounts.due_on']))).toBe('accounts deadline changed');
    expect(describeChange(change(['accounts.next_due', 'accounts.next_made_up_to']))).toBe('accounts deadline and accounts period end changed');
  });

  it('leads with the most specific matching label', () => {
    expect(describeChange(change(['accounts.last_accounts.type']))).toBe('accounts dates changed');
  });

  it('says a deletion plainly — it is the loudest thing the stream reports', () => {
    expect(describeChange(change([], 'deleted'))).toBe('removed from the register');
    expect(describeChange(change(['company_status'], 'deleted'))).toBe('removed from the register');
  });

  it('falls back rather than naming a field it has no wording for', () => {
    expect(describeChange(change([]))).toBe('record updated');
    expect(describeChange(change(['something_new']))).toBe('record updated');
  });
});
