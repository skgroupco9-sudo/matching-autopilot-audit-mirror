// 初回管理者登録の認可判定。副作用を持たない純関数として分離し、
// 実際の判定分岐そのものをテストできるようにする（PQA-003）。
//
// MATCHPILOT_ADMIN_EMAIL は「誰が管理者になれるか」の制約であり、秘密ではない。
// したがって認可材料は MATCHPILOT_SETUP_SECRET の所持だけに限る。

export type InitialSetupDecision = 'authorized' | 'admin_email_required' | 'invalid_setup_token';

export type InitialSetupInput = {
  configuredAdminEmail: string | null;
  email: string;
  setupTokenValid: boolean;
  setupCookieValid: boolean;
};

export function decideInitialSetupAuthorization(input: InitialSetupInput): InitialSetupDecision {
  if (input.configuredAdminEmail && input.email !== input.configuredAdminEmail) {
    return 'admin_email_required';
  }
  if (input.setupTokenValid || input.setupCookieValid) {
    return 'authorized';
  }
  return 'invalid_setup_token';
}
