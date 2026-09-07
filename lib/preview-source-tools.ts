export const PREVIEW_TOOL_DIRECTORY = '.design-harness-runtime';
export const PREVIEW_TOOL_ASSET = '/preview-tools/source-plugin.mjs';
export const VITE_PREVIEW_CONFIG = `import { loadConfigFromFile } from 'vite';
import sourcePlugin from './source-plugin.mjs';
export default async function config(env) {
  const loaded = await loadConfigFromFile(env, undefined, process.cwd());
  const original = loaded?.config ?? {};
  return { ...original, plugins: [sourcePlugin(), ...(original.plugins ?? [])] };
}
`;
