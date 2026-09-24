export const INTAKE_LIMITS = {
  files: 10,
  fileBytes: 5 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
} as const;
export type AttachmentUpdateMode = "replace_all" | "replace_one" | "append";
type RetainedAttachment = { size_bytes?: number };

export function intakeFilesError(
  files: readonly File[],
  maximum: number = INTAKE_LIMITS.files,
  retained: readonly RetainedAttachment[] = [],
): string | null {
  if (files.length > maximum)
    return maximum === 1
      ? "Choose one replacement file."
      : `Choose at most ${maximum} attachments.`;
  if (files.length + retained.length > INTAKE_LIMITS.files)
    return "The resulting case may contain at most 10 attachments, including existing documents.";
  if (files.some((file) => !/\.(txt|pdf|docx|xlsx)$/i.test(file.name)))
    return "Use TXT, PDF, DOCX or XLSX files.";
  if (files.some((file) => file.size > INTAKE_LIMITS.fileBytes))
    return "Each attachment must be 5 MB or smaller.";
  if (
    files.reduce((sum, file) => sum + file.size, 0) +
      retained.reduce((sum, file) => sum + (file.size_bytes ?? 0), 0) >
    INTAKE_LIMITS.totalBytes
  )
    return "The combined attachments must be 20 MB or smaller.";
  return null;
}

export function intakeSubmissionError(
  files: readonly File[],
  mode: AttachmentUpdateMode | "new",
  retained: readonly RetainedAttachment[] = [],
) {
  const error = intakeFilesError(
    files,
    mode === "replace_one" ? 1 : 10,
    retained,
  );
  if (error) return error;
  if (mode === "replace_one" && files.length !== 1)
    return "Choose one replacement file.";
  if (mode === "append" && files.length < 1)
    return "Choose at least one attachment to add.";
  if (mode === "replace_all" && files.length < 2)
    return "Include both the SI and draft BL in the replacement set.";
  return null;
}

async function identity(file: File) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
  );
  return `${file.name}\0${file.size}\0${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Keep both differently named evidence and same-name revisions with different bytes. */
export async function addIntakeFiles(
  current: readonly File[],
  additions: readonly File[],
  maximum: number = INTAKE_LIMITS.files,
) {
  for (const file of additions) {
    const error = intakeFilesError([file], maximum);
    if (error) return { files: [...current], error, duplicates: 0 };
  }
  const files = [...current];
  const known = new Set(await Promise.all(current.map(identity)));
  let duplicates = 0;
  for (const file of additions) {
    const key = await identity(file);
    if (known.has(key)) duplicates++;
    else {
      known.add(key);
      files.push(file);
    }
  }
  const error = intakeFilesError(files, maximum);
  return { files: error ? [...current] : files, error, duplicates };
}

/** The native picker only holds its latest selection; the retained list is authoritative. */
export function setIntakeFormFiles(form: FormData, files: readonly File[]) {
  form.delete("files");
  for (const file of files) form.append("files", file, file.name);
  return form;
}
