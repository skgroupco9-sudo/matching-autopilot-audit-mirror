import { getPersonalUser } from '@/app/personal-auth';
import { getD1 } from '@/db';

export const dynamic = 'force-dynamic';

type AccountRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user';
  account_status: 'active' | 'suspended';
  automation_state: 'active' | 'paused' | 'needs_attention';
  telegram_linked: number;
  created_at: number;
  last_login_at: number | null;
  billing_status: string | null;
  connections_count: number;
  active_conversations: number;
};

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'admin_required' }, { status: 403 });

  const result = await getD1().prepare(`
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.role,
      u.account_status,
      u.automation_state,
      CASE WHEN u.telegram_chat_id IS NULL THEN 0 ELSE 1 END AS telegram_linked,
      u.created_at,
      pa.last_login_at,
      bs.status AS billing_status,
      (SELECT COUNT(*) FROM app_connections ac WHERE ac.user_id = u.id) AS connections_count,
      (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id AND c.status = 'active') AS active_conversations
    FROM users u
    INNER JOIN password_accounts pa ON pa.user_id = u.id
    LEFT JOIN billing_subscriptions bs ON bs.user_id = u.id
    ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.created_at DESC
    LIMIT 500
  `).all<AccountRow>();

  return Response.json({
    currentUserId: user.userId,
    accounts: result.results.map((account) => ({
      id: account.id,
      email: account.email,
      displayName: account.display_name?.trim() || 'ユーザー',
      role: account.role,
      status: account.account_status,
      automationState: account.automation_state,
      telegramLinked: Boolean(account.telegram_linked),
      createdAt: new Date(account.created_at).toISOString(),
      lastLoginAt: account.last_login_at ? new Date(account.last_login_at).toISOString() : null,
      billingStatus: account.billing_status,
      connectionsCount: Number(account.connections_count),
      activeConversations: Number(account.active_conversations),
    })),
  }, { headers: { 'cache-control': 'private, no-store' } });
}
