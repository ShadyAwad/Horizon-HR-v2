import { config } from 'dotenv';
import path from 'node:path';
/** Explicit process configuration wins; local defaults override base-file defaults. */
export function loadDevelopmentEnvironment(env = process.env, directory = process.cwd()) {
  const defaults = {};
  config({ path: path.join(directory, '.env'), processEnv: defaults, quiet: true });
  if (env.NODE_ENV !== 'production') {
    config({ path: path.join(directory, '.env.development.local'), processEnv: defaults, override: true, quiet: true });
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (env[key] === undefined) env[key] = value;
  }
}