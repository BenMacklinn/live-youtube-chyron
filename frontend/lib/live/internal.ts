export function getInternalProcessSecret() {
  const secret = process.env.INTERNAL_PROCESS_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("INTERNAL_PROCESS_SECRET is required in production");
  }

  return "dev-internal-process-secret";
}
