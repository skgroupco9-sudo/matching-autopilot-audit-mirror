import {
  createSetupAccessCookie,
  isSetupConfigured,
  verifySetupToken,
} from '@/app/personal-auth';
import { validateJsonMutation } from '@/lib/request-security';

type SetupSessionBody = {
  setupToken?: string;
};

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  if (!isSetupConfigured()) return Response.json({ error: 'auth_not_configured' }, { status: 503 });

  let body: SetupSessionBody;
  try {
    body = (await request.json()) as SetupSessionBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const setupToken = typeof body.setupToken === 'string' ? body.setupToken : '';
  if (!verifySetupToken(setupToken)) return Response.json({ error: 'invalid_setup_token' }, { status: 401 });

  return Response.json({ ok: true }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': await createSetupAccessCookie(),
    },
  });
}
