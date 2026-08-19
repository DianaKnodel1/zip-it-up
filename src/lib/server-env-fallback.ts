// Ensures the deployed worker sees the same Supabase configuration that the
// build was created with. VITE_* values are inlined at build time, so they are
// available even when the runtime does not inject unprefixed variables.
const fallbacks: Record<string, string | undefined> = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_PROJECT_ID: import.meta.env.VITE_SUPABASE_PROJECT_ID,
};

export function applyServerEnvFallback() {
  if (typeof process === "undefined" || !process.env) return;
  for (const [key, value] of Object.entries(fallbacks)) {
    if (!value) continue;
    if (!process.env[key]) {
      try {
        process.env[key] = value;
      } catch {
        // read-only env in some runtimes; ignore
      }
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SERVICE_ROLE_KEY) {
    try {
      process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;
    } catch {
      // ignore
    }
  }
}