import { useState } from 'react';
import { Mail, MessageCircle, Phone, Pencil, Plus, Star, Trash2, UserRound } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { Field, Input } from './Form';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import type { Contact } from '../../domain/types';

interface Draft {
  name: string;
  role: string;
  email: string;
  phone: string;
  whatsapp: string;
}

const EMPTY: Draft = { name: '', role: '', email: '', phone: '', whatsapp: '' };

function draftOf(contact: Contact): Draft {
  return {
    name: contact.name,
    role: contact.role,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    whatsapp: contact.whatsapp ?? '',
  };
}

/**
 * Who we actually chase, and how to reach them. Imported clients start with a
 * placeholder contact and no email or phone at all — Companies House gives a
 * director's name but never their contact details — so this is where a practice
 * fills in the details reminders are sent to.
 */
export function ContactsCard({ clientId }: { clientId: string }) {
  const data = useData();
  const updateContact = useAppStore((s) => s.updateContact);
  const addContact = useAppStore((s) => s.addContact);
  const removeContact = useAppStore((s) => s.removeContact);
  const setPrimaryContact = useAppStore((s) => s.setPrimaryContact);
  const toast = useAppStore((s) => s.toast);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const contacts = data.contacts.filter((c) => c.clientId === clientId).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const reachable = contacts.filter((c) => c.email || c.phone || c.whatsapp).length;

  const startEdit = (contact: Contact) => {
    setAdding(false);
    setEditingId(contact.id);
    setDraft(draftOf(contact));
  };

  const startAdd = () => {
    setEditingId(null);
    setAdding(true);
    setDraft(EMPTY);
  };

  const cancel = () => {
    setEditingId(null);
    setAdding(false);
  };

  const save = () => {
    if (!draft.name.trim()) {
      toast({ title: 'A contact needs a name', tone: 'error' });
      return;
    }
    if (adding) {
      addContact(clientId, draft);
      toast({ title: `${draft.name.trim()} added`, tone: 'success' });
    } else if (editingId) {
      updateContact(editingId, draft);
      toast({ title: 'Contact details saved', tone: 'success' });
    }
    cancel();
  };

  const remove = (contact: Contact) => {
    removeContact(contact.id);
    toast({ title: `${contact.name} removed`, tone: 'info' });
  };

  const form = (
    <div className="rounded-lg border border-primary-200 bg-primary-50/40 dark:bg-primary-500/5 p-3 space-y-3" data-testid="contact-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="contact-name">
          <Input id="contact-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus data-testid="contact-name" />
        </Field>
        <Field label="Role" htmlFor="contact-role" hint="e.g. Director, Bookkeeper.">
          <Input id="contact-role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Contact" data-testid="contact-role" />
        </Field>
        <Field label="Email" htmlFor="contact-email">
          <Input id="contact-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} data-testid="contact-email" />
        </Field>
        <Field label="Phone" htmlFor="contact-phone">
          <Input id="contact-phone" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} data-testid="contact-phone" />
        </Field>
        <Field label="WhatsApp" htmlFor="contact-whatsapp" hint="Leave blank to use the phone number.">
          <Input id="contact-whatsapp" type="tel" value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} data-testid="contact-whatsapp" />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} data-testid="contact-save">
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Contacts"
        icon={<UserRound />}
        description={reachable === 0 ? 'No way to reach this client yet — add an email or phone number so reminders can be sent.' : 'Reminders go to the main contact.'}
        action={
          !adding && (
            <Button size="sm" variant="secondary" icon={<Plus />} onClick={startAdd} data-testid="contact-add">
              Add
            </Button>
          )
        }
      />
      <CardBody className="pt-0 space-y-3">
        {adding && form}
        <ul className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <li key={c.id} className="py-2.5" data-testid={`contact-${c.id}`}>
              {editingId === c.id ? (
                form
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-900 flex items-center gap-2">
                      {c.name}
                      {c.isPrimary && <Badge tone="blue">Main contact</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">{c.role}</p>
                    <div className="mt-1 flex flex-col gap-0.5 text-[13px]">
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="text-slate-700 hover:text-primary-700 inline-flex items-center gap-1.5 truncate">
                          <Mail className="h-3.5 w-3.5 text-slate-400" /> {c.email}
                        </a>
                      ) : null}
                      {c.phone ? (
                        <span className="text-slate-700 inline-flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-slate-400" /> {c.phone}
                        </span>
                      ) : null}
                      {c.whatsapp ? (
                        <span className="text-slate-700 inline-flex items-center gap-1.5">
                          <MessageCircle className="h-3.5 w-3.5 text-slate-400" /> {c.whatsapp}
                        </span>
                      ) : null}
                      {!c.email && !c.phone && !c.whatsapp && <span className="text-xs text-amber-700">No email or phone yet</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!c.isPrimary && (
                      <button type="button" onClick={() => setPrimaryContact(clientId, c.id)} className="text-slate-300 hover:text-primary-600 p-1" aria-label={`Make ${c.name} the main contact`}>
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => startEdit(c)} className="text-slate-300 hover:text-slate-600 p-1" aria-label={`Edit ${c.name}`} data-testid={`contact-edit-${c.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {contacts.length > 1 && (
                      <button type="button" onClick={() => remove(c)} className="text-slate-300 hover:text-red-600 p-1" aria-label={`Remove ${c.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
