// Purpose: plan recovery of durable shared-audio intakes after reload.
// Responsibilities: partition intakes into resume-review versus finish-cleanup by
//   commit receipt, and decide the operation identity for the next attempt.
// Rationale: an acknowledged handoff must never be lost or re-analyzed into a
//   duplicate operation; identity may change only after a definitive failure with
//   an edited payload, never while the transaction outcome is unknown.

/**
 * intakes: array of intake records; receiptOperationIds: iterable of operation
 * IDs that have a durable commit receipt in the workspace operations store.
 * Committed-with-receipt intakes only need idempotent cleanup; everything else
 * resumes review/retry with its frozen identity (or without one yet).
 */
export function planRecovery(intakes, receiptOperationIds) {
  const receipts = new Set(receiptOperationIds);
  const resume = [];
  const finish = [];
  for (const intake of intakes ?? []) {
    if (intake.operationId && receipts.has(intake.operationId)) finish.push(intake);
    else resume.push(intake);
  }
  return { resume, finish };
}

/**
 * The operation ID for the next commit attempt of an intake.
 * Fresh intakes mint a new ID; a frozen intake keeps its identity while the
 * outcome is unknown or unedited, and only takes a new ID after a definitive
 * failure whose payload was intentionally edited.
 */
export function nextOperationIdentity(intake, { failed = false, edited = false, idFactory = () => globalThis.crypto.randomUUID() } = {}) {
  if (!intake?.operationId) return idFactory();
  if (failed && edited) return idFactory();
  return intake.operationId;
}
