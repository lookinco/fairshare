import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/groups');

  return (
    <div className="wrap">
      <div className="brand" style={{ fontSize: 34, marginTop: 40 }}>Fair<span>Share</span></div>
      <div className="card" style={{ marginTop: 24 }}>
        <h1>Split the bill, fairly. 🎉</h1>
        <p className="muted">
          Big group dinners where everyone chips in? Snap the receipt, split by family
          and age — not just headcount — and settle up with a tap.
        </p>
        <ul className="muted" style={{ paddingLeft: 18 }}>
          <li>Weighted splits (adults, kids, toddlers)</li>
          <li>One-tap “I paid” tally</li>
          <li>Receipt photo → itemized in seconds</li>
          <li>Running balances + settle-up 🏆</li>
        </ul>
      </div>
      <Link href="/login" className="btn">Get started</Link>
    </div>
  );
}
