import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { netBalances, settleUp } from '../../../lib/split.mjs';

export const dynamic = 'force-dynamic';

// Resolve a display name + weight for every participant of the group.
async function loadParticipants(supabase, groupId) {
  const { data: parts } = await supabase
    .from('group_participants')
    .select('id, kind, user_id, family_id, role')
    .eq('group_id', groupId);

  const userIds = parts.filter(p => p.kind === 'user').map(p => p.user_id);
  const famIds = parts.filter(p => p.kind === 'family').map(p => p.family_id);

  const [{ data: profiles }, { data: families }, { data: members }] = await Promise.all([
    userIds.length ? supabase.from('profiles').select('id, display_name, weight').in('id', userIds)
                   : Promise.resolve({ data: [] }),
    famIds.length ? supabase.from('families').select('id, name').in('id', famIds)
                  : Promise.resolve({ data: [] }),
    famIds.length ? supabase.from('family_members').select('family_id, weight').in('family_id', famIds)
                  : Promise.resolve({ data: [] }),
  ]);

  const profById = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  const famById = Object.fromEntries((families || []).map(f => [f.id, f]));
  const famWeight = {};
  for (const m of members || []) famWeight[m.family_id] = (famWeight[m.family_id] || 0) + Number(m.weight);

  return parts.map(p => {
    if (p.kind === 'user') {
      const prof = profById[p.user_id] || {};
      return { id: p.id, name: prof.display_name || 'Member', weight: Number(prof.weight ?? 1) || 1, role: p.role };
    }
    const fam = famById[p.family_id] || {};
    return { id: p.id, name: fam.name || 'Family', weight: famWeight[p.family_id] ?? 1, role: p.role };
  });
}

async function addTally(formData) {
  'use server';
  const groupId = String(formData.get('group_id'));
  const payer = String(formData.get('payer'));
  const amount = Number(formData.get('amount'));
  const note = String(formData.get('note') || '').trim();
  if (!payer || !(amount > 0)) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  await supabase.from('expenses').insert({
    group_id: groupId, payer_participant_id: payer, amount, kind: 'tally',
    note: note || null, created_by: user.id,
  });
  await supabase.from('activity_log').insert({
    group_id: groupId, actor_user_id: user.id, action: 'expense_added',
    meta: { amount, note },
  });
  redirect(`/groups/${groupId}`);
}

export default async function GroupDetail({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: group } = await supabase.from('groups').select('id, name, join_code').eq('id', id).single();
  if (!group) redirect('/groups');

  const participants = await loadParticipants(supabase, id);
  const byId = Object.fromEntries(participants.map(p => [p.id, p]));
  const weighted = participants.map(p => ({ id: p.id, weight: p.weight }));

  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, payer_participant_id, amount, note, created_at')
    .eq('group_id', id)
    .order('created_at', { ascending: false });

  // fold every tally expense into net balances across the whole group by weight
  const engineExpenses = (expenses || []).map(e => ({
    payerId: e.payer_participant_id,
    amount: Number(e.amount),
    members: weighted,
  }));
  const net = netBalances(engineExpenses);
  const transfers = settleUp(net);

  const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

  return (
    <div className="wrap">
      <div className="row spread">
        <Link href="/groups" className="chip">← groups</Link>
        <span className="chip">code: {group.join_code}</span>
      </div>
      <h1>{group.name}</h1>

      <h2>Balances</h2>
      {participants.length === 0 && <div className="card muted">No participants yet.</div>}
      {participants.map(p => {
        const bal = net[p.id] || 0;
        return (
          <div key={p.id} className="card row spread" style={{ padding: 14 }}>
            <div className="row">
              <div className="avatar">{(p.name || '?')[0].toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div className="muted" style={{ fontSize: 13 }}>weight {p.weight}</div>
              </div>
            </div>
            <div className={bal >= 0 ? 'pos' : 'neg'}>
              {bal >= 0 ? 'gets back ' : 'owes '}{money(bal)}
            </div>
          </div>
        );
      })}

      {transfers.length > 0 && (
        <>
          <h2>Settle up 🏆</h2>
          <div className="card">
            {transfers.map((t, i) => (
              <div key={i} className="row spread" style={{ padding: '6px 0' }}>
                <span>{byId[t.from]?.name} → {byId[t.to]?.name}</span>
                <span className="pos">{money(t.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Add an expense</h2>
      <div className="card">
        <form action={addTally}>
          <input type="hidden" name="group_id" value={id} />
          <label>Who paid?</label>
          <select name="payer" required>
            {participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label>Amount</label>
          <input name="amount" type="number" step="0.01" min="0" placeholder="0.00" required />
          <label>Note (optional)</label>
          <input name="note" placeholder="Dinner at Miku 🍣" />
          <div style={{ height: 16 }} />
          <button className="btn">I paid</button>
        </form>
        <p className="muted" style={{ fontSize: 13 }}>
          Split across the whole group by weight. Receipt photo → itemized split coming next.
        </p>
      </div>

      <h2>Activity</h2>
      {(expenses || []).map(e => (
        <div key={e.id} className="card row spread" style={{ padding: 12 }}>
          <span>{byId[e.payer_participant_id]?.name || '—'} paid{e.note ? ` · ${e.note}` : ''}</span>
          <span style={{ fontWeight: 700 }}>{money(Number(e.amount))}</span>
        </div>
      ))}
    </div>
  );
}
