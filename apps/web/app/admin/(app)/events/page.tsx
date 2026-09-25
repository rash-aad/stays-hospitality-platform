'use client';

import { Resource, moneyCol } from '@/components/resource';
import { PageHeader, Status } from '@/components/ui';
import { date, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type E = { id: string; reference: string; contactName: string; email: string; phone: string | null; eventType: string; eventDate: string | null; guestCount: number | null; budget: number | null; status: string; message: string | null };
const STATUS_TONE: Record<string, string> = { new: 'warn', contacted: 'accent', proposal_sent: 'accent', won: 'ok', lost: 'neutral' };

export default function Events() {
  const { data: props } = useStaff<{ data: { id: string }[] }>('/admin/properties');
  const { data: staff } = useStaff<{ data: { id: string; name: string }[] }>('/admin/staff-directory');
  return (
    <>
      <PageHeader title="Events & banquets" sub="Enquiries for weddings, conferences and celebrations — from your website and the phone." />
      {props && <Resource<E> endpoint="/admin/events" noun="Enquiry" extra={{ propertyId: props.data[0]?.id }} sort={(a, b) => (a.eventDate ?? '9').localeCompare(b.eventDate ?? '9')}
        fields={[
          { key: 'contactName', label: 'Contact name', required: true }, { key: 'email', label: 'Email', required: true }, { key: 'phone', label: 'Phone', nullable: true },
          { key: 'eventType', label: 'Event', type: 'select', required: true, options: ['wedding', 'conference', 'birthday', 'corporate_offsite', 'other'].map((v) => ({ value: v, label: human(v) })) },
          { key: 'eventDate', label: 'Date', type: 'date', nullable: true }, { key: 'guestCount', label: 'Guests', type: 'number', nullable: true }, { key: 'budget', label: 'Budget (₹)', type: 'money', nullable: true },
          { key: 'status', label: 'Stage', type: 'select', defaultValue: 'new', options: ['new', 'contacted', 'proposal_sent', 'won', 'lost'].map((v) => ({ value: v, label: human(v) })) },
          { key: 'assignedUserId', label: 'Owner', type: 'select', nullable: true, options: (staff?.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
          { key: 'message', label: 'Their message', type: 'textarea', nullable: true }, { key: 'notes', label: 'Internal notes', type: 'textarea', nullable: true },
        ]}
        columns={[
          { label: 'Contact', render: (r) => <><p className="font-medium">{r.contactName}</p><p className="text-xs text-muted">{r.email}</p></> },
          { label: 'Event', render: (r) => human(r.eventType) }, { label: 'Date', render: (r) => (r.eventDate ? date(r.eventDate) : 'Flexible') },
          { label: 'Guests', align: 'right', render: (r) => r.guestCount ?? '—' }, { label: 'Budget', align: 'right', render: (r) => (r.budget ? moneyCol(r.budget) : '—') },
          { label: 'Stage', render: (r) => <span className={`chip chip-${STATUS_TONE[r.status] ?? 'neutral'}`}>{human(r.status)}</span> },
        ]} />}
      {void Status}
    </>
  );
}
