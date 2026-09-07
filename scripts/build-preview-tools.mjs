import { build } from 'vite';

await build({ configFile:false, publicDir:false, logLevel:'error', build:{
  outDir:'public/preview-tools', emptyOutDir:false, minify:true,
  lib:{ entry:'runtime/vite-source-plugin.ts', formats:['es'], fileName:()=> 'source-plugin.mjs' },
  rolldownOptions:{ external:[/^node:/] },
} });
