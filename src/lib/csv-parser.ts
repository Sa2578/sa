import Papa from "papaparse";
import { leadSchema } from "./validators";

interface ParsedLead {
  email: string;
  name?: string;
  company?: string;
}

export function parseLeadsCsv(csvText: string): {
  leads: ParsedLead[];
  errors: string[];
} {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  const leads: ParsedLead[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i] as Record<string, string>;
    const parsed = leadSchema.safeParse({
      email: row.email?.trim(),
      name: row.name?.trim() || undefined,
      company: row.company?.trim() || undefined,
    });

    if (parsed.success) {
      if (seenEmails.has(parsed.data.email)) {
        errors.push(`Row ${i + 1}: Duplicate email "${parsed.data.email}"`);
        continue;
      }

      seenEmails.add(parsed.data.email);
      leads.push(parsed.data);
    } else {
      errors.push(`Row ${i + 1}: ${parsed.error.issues[0]?.message || "Invalid data"}`);
    }
  }

  return { leads, errors };
}
