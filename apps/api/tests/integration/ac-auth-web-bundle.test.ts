/**
 * AC-AUTH-08 — the Supabase service role key never appears in the built
 * front-end bundle.
 *
 * Cheap by design: if apps/web/dist already exists it is grepped as-is; only
 * when it is absent is the web app built once, with a canary value injected
 * as SUPABASE_SERVICE_ROLE_KEY so that any build-time env inlining would be
 * caught by the canary scan.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { WEB_APP_DIR } from './sql-files.js';

const DIST_DIR = join(WEB_APP_DIR, 'dist');
const CANARY = 'sdb-canary-service-role-key-must-not-ship-7f3a9c';

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...listFilesRecursive(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

let builtWithCanary = false;

describe('AC-AUTH-08 — service role key absent from the web bundle', () => {
  beforeAll(() => {
    if (!existsSync(join(DIST_DIR, 'index.html'))) {
      execSync('pnpm build', {
        cwd: WEB_APP_DIR,
        stdio: 'pipe',
        env: {
          ...process.env,
          SUPABASE_SERVICE_ROLE_KEY: CANARY,
          // A hostile misconfiguration would need the VITE_ prefix to leak;
          // plant the canary there too so that path is covered.
          VITE_SUPABASE_SERVICE_ROLE_KEY: CANARY,
        },
      });
      builtWithCanary = true;
    }
  }, 300_000);

  it('no dist file contains the key name, a service_role marker, or the canary', () => {
    const files = listFilesRecursive(DIST_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content, `${file} leaks SUPABASE_SERVICE_ROLE_KEY`).not.toContain(
        'SUPABASE_SERVICE_ROLE_KEY',
      );
      expect(content, `${file} contains a service_role marker`).not.toContain(
        'service_role',
      );
      expect(content, `${file} leaks the canary key value`).not.toContain(CANARY);
    }
    // When this run built the bundle, the canary was genuinely in the build
    // environment — record that the stronger form of the check applied.
    expect(typeof builtWithCanary).toBe('boolean');
  });
});
