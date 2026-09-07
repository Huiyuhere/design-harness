import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { instrumentJsxSource } from '../lib/jsx-source-anchors';

/** Generic preview tool. Contains no imported repository source or credentials. */
export default function sourcePlugin(): Plugin {
  const root = resolve(process.cwd());
  return {
    name:'design-harness-source-anchors', enforce:'pre', apply:'serve',
    async transform(source, id) {
      if (id.includes('?') || !/\.(jsx|tsx)$/.test(id)) return null;
      const file=relative(root,id).split(sep).join('/');
      if (file.startsWith('../') || file.split('/').some(part=>['node_modules','.design-harness-runtime'].includes(part))) return null;
      // A preceding transform must never be mistaken for clean source positions.
      if (await readFile(id,'utf8') !== source) { this.warn(`Source mapping skipped for ${file}: a preceding transform changed the file.`); return null; }
      const hash=createHash('sha256').update(source).digest('hex');
      try {
        const result=instrumentJsxSource(source,file,hash);
        return result.count ? { code:result.code, map:null } : null;
      } catch {
        this.warn(`Source mapping unavailable for ${file}. The page remains inspect-only.`);
        return null;
      }
    },
  };
}
