// POST { dataUrl } -> parsed receipt JSON. Auth-gated (must be signed in).
import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { parseReceiptDataUrl } from '../../../lib/receipt.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const dataUrl = body?.dataUrl;
  if (!dataUrl || !/^data:image\//.test(dataUrl)) {
    return NextResponse.json({ error: 'dataUrl (image) required' }, { status: 400 });
  }

  try {
    const receipt = await parseReceiptDataUrl(dataUrl, { key: process.env.OPENAI_API_KEY });
    return NextResponse.json({ receipt });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
