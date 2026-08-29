import { clearSessionCookie } from '@/app/personal-auth';
import { validateSameOriginMutation } from '@/lib/request-security';

export async function POST(request: Request) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  return Response.json({ ok: true }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': clearSessionCookie(),
    },
  });
}
