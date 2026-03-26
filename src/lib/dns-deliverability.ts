import dns from "node:dns/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const COMMON_DKIM_SELECTORS = ["google", "default", "selector1", "selector2", "k1", "s1", "mail"];

export interface DkimSelectorResult {
  selector: string;
  valid: boolean;
  recordType: "TXT" | "CNAME" | "NONE";
  records: string[];
  error?: string;
}

export interface DomainDnsCheckResult {
  domainName: string;
  checkedAt: string;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  mxValid: boolean;
  spfRecord: string | null;
  dmarcRecord: string | null;
  mxRecords: Array<{ exchange: string; priority: number }>;
  selectorsChecked: string[];
  dkimResults: DkimSelectorResult[];
  warnings: string[];
  errors: string[];
  dmarcPolicy: string | null;
  rua: string[];
}

function flattenTxtRecords(records: string[][]) {
  return records.map((parts) => parts.join("").trim()).filter(Boolean);
}

function pickFirstRecord(records: string[], prefix: string) {
  const normalizedPrefix = prefix.toLowerCase();
  return records.find((record) => record.toLowerCase().startsWith(normalizedPrefix)) ?? null;
}

function parseTagValue(record: string, tag: string) {
  const match = record.match(new RegExp(`(?:^|;)\\s*${tag}=([^;]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

async function resolveTxtRecords(hostname: string) {
  try {
    return flattenTxtRecords(await dns.resolveTxt(hostname));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENODATA" || (error as NodeJS.ErrnoException).code === "ENOTFOUND") {
      return [];
    }
    throw error;
  }
}

async function resolveMxRecords(hostname: string) {
  try {
    const records = await dns.resolveMx(hostname);
    return records
      .map((record) => ({ exchange: record.exchange, priority: record.priority }))
      .sort((left, right) => left.priority - right.priority);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENODATA" || (error as NodeJS.ErrnoException).code === "ENOTFOUND") {
      return [];
    }
    throw error;
  }
}

async function resolveCnameRecords(hostname: string) {
  try {
    return await dns.resolveCname(hostname);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENODATA" || (error as NodeJS.ErrnoException).code === "ENOTFOUND") {
      return [];
    }
    throw error;
  }
}

async function resolveDkimSelector(selector: string, domainName: string): Promise<DkimSelectorResult> {
  const hostname = `${selector}._domainkey.${domainName}`;

  try {
    const txtRecords = await resolveTxtRecords(hostname);
    const dkimTxt = txtRecords.filter((record) => record.toLowerCase().includes("v=dkim1"));
    if (dkimTxt.length > 0) {
      return {
        selector,
        valid: true,
        recordType: "TXT",
        records: dkimTxt,
      };
    }

    const cnameRecords = await resolveCnameRecords(hostname);
    if (cnameRecords.length > 0) {
      return {
        selector,
        valid: true,
        recordType: "CNAME",
        records: cnameRecords,
      };
    }

    return {
      selector,
      valid: false,
      recordType: "NONE",
      records: [],
    };
  } catch (error) {
    return {
      selector,
      valid: false,
      recordType: "NONE",
      records: [],
      error: error instanceof Error ? error.message : "Unknown DKIM lookup error",
    };
  }
}

function normalizeSelectors(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export async function analyzeDomainDns(options: {
  domainName: string;
  dkimSelectors?: string[];
}): Promise<DomainDnsCheckResult> {
  const { domainName } = options;
  const warnings: string[] = [];
  const errors: string[] = [];
  const checkedAt = new Date().toISOString();

  let spfRecord: string | null = null;
  let dmarcRecord: string | null = null;
  let mxRecords: Array<{ exchange: string; priority: number }> = [];

  try {
    const txtRecords = await resolveTxtRecords(domainName);
    spfRecord = pickFirstRecord(txtRecords, "v=spf1");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unable to resolve SPF records");
  }

  try {
    const dmarcRecords = await resolveTxtRecords(`_dmarc.${domainName}`);
    dmarcRecord = pickFirstRecord(dmarcRecords, "v=dmarc1");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unable to resolve DMARC records");
  }

  try {
    mxRecords = await resolveMxRecords(domainName);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unable to resolve MX records");
  }

  const configuredSelectors = Array.from(new Set((options.dkimSelectors ?? []).map((selector) => selector.trim().toLowerCase()).filter(Boolean)));
  const selectorsToCheck = configuredSelectors.length > 0
    ? configuredSelectors
    : COMMON_DKIM_SELECTORS;

  const dkimResults = await Promise.all(selectorsToCheck.map((selector) => resolveDkimSelector(selector, domainName)));
  const resolvedSelectors = dkimResults.filter((result) => result.valid).map((result) => result.selector);

  if (!spfRecord) {
    warnings.push("No SPF record found on the root domain.");
  }
  if (!dmarcRecord) {
    warnings.push("No DMARC record found at _dmarc.");
  }
  if (mxRecords.length === 0) {
    warnings.push("No MX records found.");
  }
  if (configuredSelectors.length === 0) {
    warnings.push("No DKIM selectors configured in the app. The scan probed common selectors.");
  }
  if (resolvedSelectors.length === 0) {
    warnings.push("No DKIM selector resolved successfully.");
  }

  const dmarcPolicy = dmarcRecord ? parseTagValue(dmarcRecord, "p") : null;
  const ruaValue = dmarcRecord ? parseTagValue(dmarcRecord, "rua") : null;
  const rua = ruaValue
    ? ruaValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  return {
    domainName,
    checkedAt,
    spfValid: Boolean(spfRecord),
    dkimValid: resolvedSelectors.length > 0,
    dmarcValid: Boolean(dmarcRecord),
    mxValid: mxRecords.length > 0,
    spfRecord,
    dmarcRecord,
    mxRecords,
    selectorsChecked: selectorsToCheck,
    dkimResults,
    warnings,
    errors,
    dmarcPolicy,
    rua,
  };
}

export async function runDomainDnsCheck(options: {
  domainId: string;
  userId: string;
}) {
  const domain = await prisma.domain.findFirst({
    where: { id: options.domainId, userId: options.userId },
  });

  if (!domain) {
    throw new Error("Domain not found");
  }

  const result = await analyzeDomainDns({
    domainName: domain.domainName,
    dkimSelectors: normalizeSelectors(domain.dkimSelectors),
  });

  const updated = await prisma.domain.update({
    where: { id: domain.id },
    data: {
      spfValid: result.spfValid,
      dkimValid: result.dkimValid,
      dmarcValid: result.dmarcValid,
      spfRecord: result.spfRecord,
      dmarcRecord: result.dmarcRecord,
      mxRecords: result.mxRecords as Prisma.InputJsonValue,
      dnsCheckReport: result as unknown as Prisma.InputJsonValue,
      dnsLastCheckedAt: new Date(result.checkedAt),
      dnsLastError: result.errors.length > 0 ? result.errors.join(" | ") : null,
    },
  });

  return {
    domain: updated,
    result,
  };
}
