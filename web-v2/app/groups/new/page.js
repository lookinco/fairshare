import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';

async function createGroup(formData) {
  'use server';
  const name = String(formData.get('name') || '').trim();
  if (!name) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: grp, error } = await supabase
    .from('groups')
    .insert({ name, created_by: user.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // creator joins as an owner participant (solo user)
  await supabase.from('group_participants').insert({
    group_id: grp.id, kind: 'user', user_id: user.id, role: 'owner',
  });
  await supabase.from('activity_log').insert({
    group_id: grp.id, actor_user_id: user.id, action: 'group_created', meta: { name },
  });
  redirect(`/groups/${grp.id}`);
}

export default function NewGroup() {
  return (
    <div className="wrap">
      <div className="brand">Fair<span>Share</span></div>
      <div className="card">
        <h1>New group</h1>
        <form action={createGroup}>
          <label>Group name</label>
          <input name="name" placeholder="Whistler trip 🏔️" required autoFocus />
          <div style={{ height: 16 }} />
          <button className="btn">Create group</button>
        </form>
      </div>
    </div>
  );
}
