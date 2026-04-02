import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getSmtpCredentialsSecret, getSmtpCredentialsSecrets } from "./env";

const ENCRYPTED_PREFIX = "enc-v1:";
const IV_LENGTH = 12;

type SmtpCredentialFields = {
  smtpUser: string;
  smtpPass: string;
};

export function isSmtpCredentialEncrypted(value: string) {
  return value.startsWith(ENCRYPTED_PREFIX);
}

function getEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptSmtpCredential(value: string) {
  if (value.startsWith(ENCRYPTED_PREFIX)) {
    return value;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(getSmtpCredentialsSecret()), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSmtpCredential(value: string) {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    return value;
  }

  const serialized = value.slice(ENCRYPTED_PREFIX.length);
  const [iv, authTag, encrypted] = serialized.split(":");
  if (!iv || !authTag || !encrypted) {
    throw new Error("Stored SMTP credential has an invalid format");
  }

  for (const secret of getSmtpCredentialsSecrets()) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        getEncryptionKey(secret),
        Buffer.from(iv, "base64url")
      );
      decipher.setAuthTag(Buffer.from(authTag, "base64url"));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    } catch {
      continue;
    }
  }

  throw new Error("Stored SMTP credential could not be decrypted with the configured secrets");
}

export function encryptInboxCredentials<T extends Partial<SmtpCredentialFields>>(data: T): T {
  const encrypted = { ...data };

  if (typeof encrypted.smtpUser === "string") {
    encrypted.smtpUser = encryptSmtpCredential(encrypted.smtpUser) as T["smtpUser"];
  }

  if (typeof encrypted.smtpPass === "string") {
    encrypted.smtpPass = encryptSmtpCredential(encrypted.smtpPass) as T["smtpPass"];
  }

  return encrypted;
}

export function decryptInboxCredentials<T extends SmtpCredentialFields>(data: T): T {
  return {
    ...data,
    smtpUser: decryptSmtpCredential(data.smtpUser),
    smtpPass: decryptSmtpCredential(data.smtpPass),
  };
}

export function getInboxCredentialUpgrade<T extends Partial<SmtpCredentialFields>>(data: T) {
  const upgrade: Partial<SmtpCredentialFields> = {};

  if (typeof data.smtpUser === "string" && !isSmtpCredentialEncrypted(data.smtpUser)) {
    upgrade.smtpUser = encryptSmtpCredential(data.smtpUser);
  }

  if (typeof data.smtpPass === "string" && !isSmtpCredentialEncrypted(data.smtpPass)) {
    upgrade.smtpPass = encryptSmtpCredential(data.smtpPass);
  }

  return upgrade;
}
