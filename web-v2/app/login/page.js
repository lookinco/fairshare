'use client';
import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export default function Login() {
  const supabase = createClient();
  const [mode, setMode] = useState('signin'); // signin | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: name }, emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        setMsg('Check your email to confirm, then sign in.');
        setMode('signin');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.href = '/groups';
      }
    } catch (err) {
      setMsg(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="brand" style={{ marginTop: 32 }}>Fair<span>Share</span></div>
      <div className="card">
        <div className="row spread">
          <h1>{mode === 'signup' ? 'Create account' : 'Welcome back'}</h1>
          <button className="chip" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
            {mode === 'signup' ? 'Have an account?' : 'New here?'}
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <>
              <label>Your name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Clement" required />
            </>
          )}
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" required />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          <div style={{ height: 16 }} />
          <button className="btn" disabled={busy}>{busy ? '…' : (mode === 'signup' ? 'Sign up' : 'Sign in')}</button>
        </form>
        {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}
