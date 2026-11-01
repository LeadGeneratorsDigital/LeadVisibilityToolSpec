export interface PastedContact {
  name: string;
  job_title: string | null;
  email: string;
}

export interface ContactPastePlan {
  contacts: PastedContact[];
  /** 1-based line numbers of non-empty lines with no email address. */
  missingEmail: number[];
}

/**
 * The edit form after a paste: rows that are still empty are dropped, a pasted email already in the
 * form (or earlier in the paste) is skipped, then the rest fill the free places up to `max`.
 */
export function mergePastedContacts<T extends { name: string; email: string }>(
  form: T[],
  pasted: PastedContact[],
  max: number,
  blank: () => T,
): { form: T[]; added: number; notAdded: number; duplicates: number } {
  const kept = form.filter((p) => p.name.trim() || p.email.trim());
  const seen = new Set(kept.map((p) => p.email.trim().toLowerCase()));
  const fresh = pasted.filter((c) => {
    const key = c.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const added = fresh.slice(0, Math.max(max - kept.length, 0)).map((c) => ({ ...blank(), ...c }));
  return { form: [...kept, ...added], added: added.length, notAdded: fresh.length - added.length, duplicates: pasted.length - fresh.length };
}

const EMAIL = /[^\s<>(),;"']+@[^\s<>(),;"']+\.[^\s<>(),;"']+/;

/**
 * One person per line, pasted from a spreadsheet (tab-separated) or typed ("Name, Job title,
 * email"). The email is found anywhere on the line; what is left is split on tabs or commas into
 * name, then job title. A line with only an email uses the email as the name.
 */
export function planContactPaste(text: string): ContactPastePlan {
  const contacts: PastedContact[] = [];
  const missingEmail: number[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const match = EMAIL.exec(raw);
    if (!match) {
      missingEmail.push(index + 1);
      return;
    }
    const email = match[0].replace(/^mailto:/i, "");
    const rest = (raw.slice(0, match.index) + "\t" + raw.slice(match.index + match[0].length))
      .split(/[\t,;]|<|>|\(|\)/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    contacts.push({ name: rest[0] ?? email, job_title: rest[1] ?? null, email });
  });
  return { contacts, missingEmail };
}
