/**
 * Loads .env if present. Node 20.12+ has process.loadEnvFile() built in, so
 * there is no need for the dotenv dependency.
 */

try {
  process.loadEnvFile?.();
} catch {
  // No .env (normal in production, where the host injects the variables).
}
