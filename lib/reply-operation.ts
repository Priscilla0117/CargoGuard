/** Persist only a random operation ID and a one-way payload digest, never email text. */
export interface OperationStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
async function digestKey(prefix: string, payload: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${prefix}:${Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const validId = (id?: string | null) =>
  !!id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);

/** Only the latest attempted UUID is persisted; its context key is hashed.
 * Unlike a payload identity, this remains recoverable after draft text changes. */
export async function rememberReplyAttempt(
  context: unknown,
  id: string,
  store?: OperationStore,
) {
  if (!validId(id)) throw new Error("Invalid reply operation reference.");
  const key = await digestKey("cg-mail-attempt-v1", context);
  memory.set(key, id);
  try {
    store?.setItem(key, id);
  } catch {
    /* In-page recovery remains available. */
  }
}
export async function readReplyAttempt(
  context: unknown,
  store?: OperationStore,
) {
  const key = await digestKey("cg-mail-attempt-v1", context);
  let id = memory.get(key);
  try {
    id = store?.getItem(key) ?? id;
  } catch {
    /* Private storage unavailable. */
  }
  return validId(id) ? id! : null;
}
export async function replyOperationId(
  payload: unknown,
  store?: OperationStore,
  cancelledIds: readonly string[] = [],
) {
  const key = await digestKey("cg-mail-operation-v1", payload);
  let existing = memory.get(key);
  try {
    existing = store?.getItem(key) ?? existing;
  } catch {
    /* Private browsing can disable storage. */
  }
  if (existing && validId(existing) && !cancelledIds.includes(existing))
    return existing;
  const id = crypto.randomUUID();
  memory.set(key, id);
  try {
    store?.setItem(key, id);
  } catch {
    /* The current page still retains the operation. */
  }
  return id;
}

export interface ReplyDeliveryResult {
  account: string;
  where: string;
  operation_id: string;
  status: "submitted" | "draft" | "unknown" | "sending" | "cancelled";
  duplicate?: boolean;
  provider_id?: string | null;
  follow_up_recorded?: boolean | null;
  warning?: string;
  message?: string;
  confirmation_source?: "provider" | "employee" | null;
  accepted_recipients?: string[];
  rejected_recipients?: string[];
}

export interface ReplyOperation extends ReplyDeliveryResult {
  case_id: string;
  case_version?: number;
  mode: "draft" | "send";
  message_id: string;
  created_at: string;
}

export function replyNeedsResponse(intent: string) {
  return [
    "request_correction",
    "request_documents",
    "ask_clarification",
  ].includes(intent);
}

export function selectReplyOperations(
  operations: ReplyOperation[],
  attemptedId: string | null,
) {
  const pending =
    operations.find(
      (op) => op.status === "unknown" || op.status === "sending",
    ) ?? null;
  const recent =
    operations.find((op) => op.operation_id === attemptedId) ??
    operations[0] ??
    null;
  return { pending, recent };
}

/** Tracking retries never submit message content and cannot hide partial delivery. */
export function canRetryResponseTracking(operation: ReplyOperation) {
  return (
    operation.status === "submitted" &&
    operation.follow_up_recorded === false &&
    operation.confirmation_source !== "employee" &&
    !operation.rejected_recipients?.length
  );
}
