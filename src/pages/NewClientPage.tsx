import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Field, Input, Select } from '../ui/components/Form';
import { CompanyLookup } from '../ui/components/CompanyLookup';
import { useAppStore } from '../application/store';
import { useData } from '../application/selectors';
import { CLIENT_TYPE_LABELS, SERVICES, CHANNEL_LABELS } from '../domain/catalog';
import type { Channel, ClientType, RegisteredAddress, ServiceCode } from '../domain/types';
import type { CompanyProfile } from '../integrations/companiesHouseTypes';
import { formatAccountingReferenceDate } from '../integrations/companiesHouse';
import { cn } from '../ui/cn';

const DEFAULT_SERVICES: Record<ClientType, ServiceCode[]> = {
  limited_company: ['annual_accounts', 'corporation_tax', 'confirmation_statement'],
  sole_trader: ['self_assessment'],
  landlord: ['self_assessment'],
  partnership: ['annual_accounts', 'self_assessment'],
  individual: ['self_assessment'],
};

export function NewClientPage() {
  const navigate = useNavigate();
  const data = useData();
  const createClient = useAppStore((s) => s.createClient);
  const toast = useAppStore((s) => s.toast);
  const currentUserId = useAppStore((s) => s.currentUserId);
  const [name, setName] = useState('');
  const [type, setType] = useState<ClientType>('limited_company');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [preferred, setPreferred] = useState<Channel>('email');
  const [owner, setOwner] = useState(currentUserId);
  const [services, setServices] = useState<ServiceCode[]>(DEFAULT_SERVICES.limited_company);
  const [yearEnd, setYearEnd] = useState('');
  const [ids, setIds] = useState({ utr: '', company_number: '', vat_number: '', paye_reference: '', nino: '' });
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [companiesHouse, setCompaniesHouse] = useState<{ registeredOffice?: RegisteredAddress; companiesHouseStatus?: string; sicCodes?: string[]; incorporatedOn?: string } | null>(null);

  const applyCompanyProfile = (profile: CompanyProfile) => {
    setName(profile.companyName);
    setIds((prev) => ({ ...prev, company_number: profile.companyNumber }));
    const label = formatAccountingReferenceDate(profile.accountingReferenceDate);
    if (label) setYearEnd(label);
    setCompaniesHouse({
      registeredOffice: profile.registeredOfficeAddress ? { ...profile.registeredOfficeAddress } : undefined,
      companiesHouseStatus: profile.companyStatus ?? undefined,
      sicCodes: profile.sicCodes,
      incorporatedOn: profile.dateOfCreation ?? undefined,
    });
  };

  const changeType = (t: ClientType) => {
    setType(t);
    setServices(DEFAULT_SERVICES[t]);
  };
  const toggleService = (code: ServiceCode) => setServices((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s, code]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Enter the client or company name.';
    if (!contactName.trim()) errs.contactName = 'Enter the main contact.';
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errs.email = 'That email address doesn\'t look right.';
    if (ids.utr && !/^\d{10}$/.test(ids.utr.replace(/\s/g, ''))) errs.utr = 'A UTR is 10 digits.';
    if (ids.company_number && !/^[A-Z0-9]{8}$/i.test(ids.company_number.replace(/\s/g, ''))) errs.company_number = 'A company number is 8 characters.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const client = createClient({
        name: name.trim(),
        type,
        ownerUserId: owner,
        contactName: contactName.trim(),
        email: email || undefined,
        phone: phone || undefined,
        preferredChannel: preferred,
        services,
        identifiers: Object.fromEntries(Object.entries(ids).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.replace(/\s/g, '').toUpperCase()])),
        yearEnd: yearEnd || undefined,
        registeredOffice: companiesHouse?.registeredOffice,
        companiesHouseStatus: companiesHouse?.companiesHouseStatus,
        sicCodes: companiesHouse?.sicCodes,
        incorporatedOn: companiesHouse?.incorporatedOn,
      });
      toast({ title: 'Client created', description: `${client.name} added — onboarding checklist started.`, tone: 'success' });
      navigate(`/clients/${client.id}`);
    } catch (err) {
      toast({ title: "We couldn't save the client", description: `Nothing has been lost. ${(err as Error).message}`, tone: 'error' });
    }
  };

  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title="New client" description="Just the essentials. You can complete identifiers and onboarding steps later." />
      <form onSubmit={submit} noValidate>
        <Card>
          <CardHeader title="Client" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {type === 'limited_company' && (
              <Field label="Look up on Companies House" htmlFor="nc-lookup" className="sm:col-span-2" hint="Optional — search by name to auto-fill the company number, registered address and year end.">
                <CompanyLookup id="nc-lookup" onSelect={applyCompanyProfile} />
              </Field>
            )}
            <Field label="Client / company name" error={errors.name} htmlFor="nc-name" className="sm:col-span-2">
              <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harbour Cycles Ltd" autoFocus />
            </Field>
            <Field label="Client type" htmlFor="nc-type">
              <Select id="nc-type" value={type} onChange={(e) => changeType(e.target.value as ClientType)}>
                {(Object.keys(CLIENT_TYPE_LABELS) as ClientType[]).map((t) => (
                  <option key={t} value={t}>
                    {CLIENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Responsible accountant" htmlFor="nc-owner">
              <Select id="nc-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                {data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Main contact" error={errors.contactName} htmlFor="nc-contact">
              <Input id="nc-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" />
            </Field>
            <Field label="Preferred channel" htmlFor="nc-channel">
              <Select id="nc-channel" value={preferred} onChange={(e) => setPreferred(e.target.value as Channel)}>
                {(['email', 'whatsapp', 'sms', 'phone'] as Channel[]).map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Email" error={errors.email} htmlFor="nc-email">
              <Input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.co.uk" />
            </Field>
            <Field label="Mobile" htmlFor="nc-phone" hint="Used for WhatsApp and SMS reminders.">
              <Input id="nc-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07700 900000" />
            </Field>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader title="Services" description="Recurring obligations will be created from these." />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SERVICES) as ServiceCode[]).map((code) => (
                <button key={code} type="button" onClick={() => toggleService(code)} aria-pressed={services.includes(code)} className={cn('rounded-lg border px-3 h-9 text-sm font-medium transition-colors', services.includes(code) ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')}>
                  {SERVICES[code].name}
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader title="Identifiers" description="Optional now — add what you have. Sensitive values are masked once saved." action={<button type="button" className="text-[13px] font-medium text-primary-700 hover:underline" onClick={() => setMore((m) => !m)}>{more ? 'Fewer fields' : 'More fields'}</button>} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {type === 'limited_company' && (
              <Field label="Company number" error={errors.company_number} htmlFor="nc-cn">
                <Input id="nc-cn" value={ids.company_number} onChange={(e) => setIds({ ...ids, company_number: e.target.value })} placeholder="12345678" />
              </Field>
            )}
            <Field label="UTR" error={errors.utr} htmlFor="nc-utr" hint="10 digits">
              <Input id="nc-utr" value={ids.utr} onChange={(e) => setIds({ ...ids, utr: e.target.value })} placeholder="1234567890" inputMode="numeric" />
            </Field>
            {more && (
              <>
                {services.includes('vat') && (
                  <Field label="VAT number" htmlFor="nc-vat">
                    <Input id="nc-vat" value={ids.vat_number} onChange={(e) => setIds({ ...ids, vat_number: e.target.value })} placeholder="GB123456789" />
                  </Field>
                )}
                {services.includes('payroll') && (
                  <Field label="PAYE reference" htmlFor="nc-paye">
                    <Input id="nc-paye" value={ids.paye_reference} onChange={(e) => setIds({ ...ids, paye_reference: e.target.value })} placeholder="123/AB45678" />
                  </Field>
                )}
                {type !== 'limited_company' && (
                  <Field label="National Insurance number" htmlFor="nc-nino">
                    <Input id="nc-nino" value={ids.nino} onChange={(e) => setIds({ ...ids, nino: e.target.value })} placeholder="QQ123456C" />
                  </Field>
                )}
                <Field label="Accounting year end" htmlFor="nc-ye">
                  <Input id="nc-ye" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} placeholder="e.g. 31 March" />
                </Field>
              </>
            )}
          </CardBody>
        </Card>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/clients')}>
            Cancel
          </Button>
          <Button type="submit">Create client</Button>
        </div>
      </form>
    </div>
  );
}
