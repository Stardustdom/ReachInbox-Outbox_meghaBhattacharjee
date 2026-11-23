const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Extracts unique email addresses from any CSV / TXT content. Works whether the
 * file has a header row, an "email" column among others, or one address per line.
 */
export function extractEmails(text: string): string[] {
  const found = text.match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

export async function readLeadsFile(file: File): Promise<string[]> {
  if (file.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB');
  return extractEmails(await file.text());
}
