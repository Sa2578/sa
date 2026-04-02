export interface ParsedHeaderAnalysis {
  from: string | null;
  returnPath: string | null;
  deliveredTo: string | null;
  subject: string | null;
  messageId: string | null;
  authenticationResults: {
    spf: string | null;
    dkim: string | null;
    dmarc: string | null;
  };
  receivedSpf: string | null;
  rawAuthenticationResults: string[];
}

function unfoldHeaders(rawHeaders: string) {
  return rawHeaders.replace(/\r?\n[ \t]+/g, " ");
}

function collectHeaders(rawHeaders: string) {
  const lines = unfoldHeaders(rawHeaders)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const headers = new Map<string, string[]>();
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    const existing = headers.get(name) ?? [];
    existing.push(value);
    headers.set(name, existing);
  }

  return headers;
}

function firstHeader(headers: Map<string, string[]>, name: string) {
  return headers.get(name.toLowerCase())?.[0] ?? null;
}

function firstHeaderFromList(headers: Map<string, string[]>, names: string[]) {
  for (const name of names) {
    const value = firstHeader(headers, name);
    if (value) {
      return value;
    }
  }

  return null;
}

function parseAuthResultValue(lines: string[], key: "spf" | "dkim" | "dmarc") {
  for (const line of lines) {
    const match = line.match(new RegExp(`${key}=([a-z_]+)`, "i"));
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

export function analyzeRawHeaders(rawHeaders: string): ParsedHeaderAnalysis {
  const headers = collectHeaders(rawHeaders);
  const authenticationResults = headers.get("authentication-results") ?? [];

  return {
    from: firstHeader(headers, "from"),
    returnPath: firstHeader(headers, "return-path"),
    deliveredTo: firstHeaderFromList(headers, [
      "delivered-to",
      "x-original-to",
      "x-apparently-to",
    ]),
    subject: firstHeader(headers, "subject"),
    messageId: firstHeader(headers, "message-id"),
    authenticationResults: {
      spf: parseAuthResultValue(authenticationResults, "spf"),
      dkim: parseAuthResultValue(authenticationResults, "dkim"),
      dmarc: parseAuthResultValue(authenticationResults, "dmarc"),
    },
    receivedSpf: firstHeader(headers, "received-spf"),
    rawAuthenticationResults: authenticationResults,
  };
}
