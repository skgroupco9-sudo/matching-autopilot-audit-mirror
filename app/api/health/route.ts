export async function GET() {
  return Response.json({
    ok: true,
    service: 'matchpilot-control-plane',
    timestamp: new Date().toISOString(),
  });
}
