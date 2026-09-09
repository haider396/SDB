/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Bind IPv4 loopback explicitly. Vite's default resolves "localhost" to
    // ::1 ONLY on this Node version, so a browser that resolves localhost to
    // 127.0.0.1 gets connection-refused while curl (which picks ::1) succeeds.
    host: "127.0.0.1",
    port: 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
    /*
     * Tests must not depend on apps/web/.env.local.
     *
     * That file is gitignored, so a clean checkout has none and Vite leaves
     * every VITE_* undefined. This is precisely what broke CI: api-client threw
     * on an undefined base URL, the query failed, and the intake form rendered
     * "This form is not available" — a configuration problem wearing the
     * costume of a deleted form, in two whole suites.
     *
     * Nothing here is ever contacted; every request in these tests is mocked.
     */
    env: {
      VITE_API_BASE_URL: "http://localhost:3001",
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
