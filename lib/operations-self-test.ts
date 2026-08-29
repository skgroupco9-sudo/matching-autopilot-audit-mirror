export type OperationsSelfTestCheck = {
  id: string;
  ok: boolean;
  required: boolean;
};

export function evaluateOperationsSelfTest(checks: OperationsSelfTestCheck[]) {
  const requiredChecks = checks.filter((check) => check.required);
  return {
    ok: requiredChecks.length > 0 && requiredChecks.every((check) => check.ok),
    operationalReady: checks.length > 0 && checks.every((check) => check.ok),
    failedRequiredIds: requiredChecks.filter((check) => !check.ok).map((check) => check.id),
  };
}
