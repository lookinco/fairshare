import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

export const dynamic = 'force-dynamic';

// ensure a profile row exists for this user (first login)
async function ensureProfile(supabase, user) {
  await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email,
    display_name: user.user_metadata?.display_name || user.email?.split('@')[0],
  }, { onConflict: 'id', ignoreDuplicates: true });
}

async function joinByCode(formData) {
  'use server';
  const code = String(formData.get('code') || '').trim().toLowerCase();
  if (!code) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: grp } = await supabase.from('groups').select('id').eq('join_code', code).single();
  if (grp && user) {
    await supabase.from('group_participants').upsert(
      { group_id: grp.id, kind: 'user', user_id: user.id, role: 'member' },
      { onConflict: 'group_id,user_id', ignoreDuplicates: true },
    );
    redirect(`/groups/${grp.id}`);
  }
}

export default async function Groups() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await ensureProfile(supabase, user);

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, join_code, created_at')
    .order('created_at', { ascending: false });

  return (
    <div className="wrap">
      <div className="row spread">
        <div className="brand">Fair<span>Share</span></div>
        <Link href="/logout" className="chip">Sign out</Link>
      </div>

      <h1>Your groups</h1>
      {(!groups || groups.length === 0) && (
        <div className="card muted">No groups yet — create one below or join with a code.</div>
      )}
      {groups?.map(g => (
        <Link key={g.id} href={`/groups/${g.id}`} className="card row spread" style={{ display: 'flex' }}>
          <span style={{ fontWeight: 700 }}>{g.name}</span>
          <span className="chip">open →</span>
        </Link>
      ))}

      <div className="card">
        <h2>Join a group</h2>
        <form action={joinByCode} className="row" style={{ gap: 8 }}>
          <input name="code" placeholder="invite code" />
          <button className="btn ghost" style={{ width: 'auto', padding: '13px 18px' }}>Join</button>
        </form>
      </div>

      <Link href="/groups/new" className="btn fab">+ New group</Link>
    </div>
  );
}
