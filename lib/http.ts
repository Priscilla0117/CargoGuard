export class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
/** Bound the stream itself: content-length may be absent or dishonest. */
export async function readBytes(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError("A request body is required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        // Drain small over-limit bodies without retaining them. Cancelling a
        // nearly-complete HTTP body can poison a reused connection in local
        // Worker runtimes. Keep the discard budget bounded for hostile streams.
        chunks.length = 0;
        if (size > limit + 65536) {
          await reader.cancel();
          throw new HttpError("Request too large.", 413);
        }
        continue;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size > limit) throw new HttpError("Request too large.", 413);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function readJson(
  request: Request,
  limit = 20000,
): Promise<unknown> {
  const bytes = await readBytes(request, limit);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError("Request must contain valid UTF-8 JSON.");
  }
}
export async function readForm(request: Request): Promise<FormData> {
  const bytes = await readBytes(request, 11 * 1024 * 1024);
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data;"))
    throw new HttpError("Use a multipart document upload.", 415);
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: { "content-type": type },
      body: bytes.slice().buffer,
    }).formData();
  } catch {
    throw new HttpError(
      "The upload is incomplete or malformed. Select the files and retry.",
    );
  }
}
