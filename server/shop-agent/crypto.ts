import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.SHOP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("SHOP_ENCRYPTION_KEY environment variable is not set");
  }
  // Accept 32-byte hex key (64 hex chars) or raw 32-byte string
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  if (key.length === 32) {
    return Buffer.from(key, "utf-8");
  }
  throw new Error("SHOP_ENCRYPTION_KEY must be 32 bytes (or 64 hex characters)");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv + tag + encrypted)
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString("base64");
}

export function decrypt(encryptedStr: string): string {
  const key = getKey();
  const combined = Buffer.from(encryptedStr, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}
