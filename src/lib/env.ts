const requiredEnvVars = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
] as const;

type RequiredEnvVar = (typeof requiredEnvVars)[number];

function readEnv(name: RequiredEnvVar) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function assertRequiredEnv() {
  for (const envVar of requiredEnvVars) {
    readEnv(envVar);
  }

  if (!process.env.NEXTAUTH_URL && !process.env.RENDER_EXTERNAL_URL) {
    throw new Error(
      "Missing required environment variable: NEXTAUTH_URL (or Render RENDER_EXTERNAL_URL)"
    );
  }
}

export function getDatabaseUrl() {
  return readEnv("DATABASE_URL");
}

export function getRedisUrl() {
  return readEnv("REDIS_URL");
}

export function getAppUrl() {
  const explicitUrl = process.env.NEXTAUTH_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    return renderUrl;
  }

  throw new Error(
    "Missing required environment variable: NEXTAUTH_URL (or Render RENDER_EXTERNAL_URL)"
  );
}

export function getWebhookSecret() {
  return process.env.WEBHOOK_SECRET || null;
}

export function getAppUrlDiagnostics() {
  const url = new URL(getAppUrl());
  const hostname = url.hostname.toLowerCase();
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local");

  return {
    url: url.toString(),
    isHttps: url.protocol === "https:",
    isPublic: !isLocalHost,
    hostname,
  };
}
