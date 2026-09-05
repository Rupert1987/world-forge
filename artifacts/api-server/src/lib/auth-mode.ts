export const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";
export const LOCAL_OWNER_ID =
  process.env.WORLDFORGE_LOCAL_OWNER_ID?.trim() || "local-owner";