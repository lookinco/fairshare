// Liveness probe for the deploy script + uptime checks.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    app: 'fairshare-v2',
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    ts: new Date().toISOString(),
  });
}
