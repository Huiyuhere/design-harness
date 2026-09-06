import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { applySourcePatch, replaceJsxText, replaceTailwindToken, setCssDeclaration } from '../../lib/source-patcher';

const output = path.resolve('outputs/audit');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'source-patch-browser-'));
const app = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
function App(){const [count,setCount]=useState(0);return <main>
<h1>New</h1><p data-target="copy">Old</p>
<button className="action rounded-none  px-4" onClick={()=>setCount(count+1)}>Continue</button>
<output aria-label="Count">{count}</output>
</main>}
createRoot(document.getElementById('root')).render(<App/>);`;
// Separate bootstrap from the refreshable component: source edits must preserve
// the mounted component, not repeatedly create a root and imitate HMR success.
const component = app.slice(0, app.indexOf('createRoot(document')).replace("import {createRoot} from 'react-dom/client';\n", '').replace('function App()', 'export default function App()');
const css = 'body{font:16px system-ui;margin:40px;background:#fafafa}main{max-width:440px}p{white-space:pre-wrap}.action { min-height: 40px; padding: 12px 24px; background: #20202a; color:white; border:0; }.rounded-none{border-radius:0px}.rounded-full{border-radius:999px}output{display:block;margin-top:16px}';
await writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><title>Source patch regression</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(path.join(root, 'entry.tsx'), "import React from 'react';import {createRoot} from 'react-dom/client';import App from './App';createRoot(document.getElementById('root')!).render(<App/>);");
await writeFile(path.join(root, 'App.tsx'), component);
await writeFile(path.join(root, 'style.css'), css);
const result = { at: new Date().toISOString(), scope: 'Actual source-patcher helpers -> files -> Vite HMR -> Chromium DOM/styles. Synthetic React fixture, NOT hosted private import, API prompting, Canvas selection or production pixel verification.', checks: [] as string[], errors: [] as string[], failure: undefined as string | undefined };
const server = await createServer({ configFile: false, root, plugins: [react()], logLevel: 'error', cacheDir: path.join(root, '.vite'), server: { host: '127.0.0.1', port: 8794, strictPort: true } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await context.route('**/*', request => new URL(request.request().url()).origin === 'http://127.0.0.1:8794' ? request.continue() : request.abort());
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  let navigations = 0;
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.goto('http://127.0.0.1:8794', { waitUntil: 'networkidle' });
  const button = page.getByRole('button', { name: 'Continue', exact: true });
  await button.click();
  await page.waitForFunction(() => document.querySelector('output')?.textContent === '1');
  assert.equal(await button.evaluate(e => getComputedStyle(e).borderRadius), '0px');
  const original = await readFile(path.join(root, 'App.tsx'), 'utf8');
  const copy = '<strong>{globalThis.__patchExecuted=true}</strong> & friends\n  Keep two spaces';
  const text = replaceJsxText(original, 'Old', copy);
  await writeFile(path.join(root, 'App.tsx'), text.output);
  await page.waitForFunction(copy => document.querySelector('[data-target="copy"]')?.textContent === copy, copy);
  assert.equal(await page.locator('strong').count(), 0);
  assert.equal(await page.evaluate(() => (globalThis as unknown as { __patchExecuted?: boolean }).__patchExecuted), undefined);
  const whitespace = await page.locator('[data-target="copy"]').evaluate(element => {
    const text = element.firstChild!;
    const start = element.textContent!.indexOf('\n') + 1;
    const span = document.createRange(); span.setStart(text, start); span.setEnd(text, start + 2);
    return { mode: getComputedStyle(element).whiteSpace, leadingSpaceWidth: span.getBoundingClientRect().width };
  });
  assert.equal(whitespace.mode, 'pre-wrap');
  assert.ok(whitespace.leadingSpaceWidth > 4, 'Intentional leading spaces must occupy rendered width');
  assert.equal(await page.locator('output').textContent(), '1');
  result.checks.push('Real compiled React renders special characters/newlines as literal copy, without executing JSX-looking text; HMR retains component state');
  const classes = replaceTailwindToken(text.output, 'rounded-none', 'rounded-full');
  await writeFile(path.join(root, 'App.tsx'), classes.output);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('button')!).borderRadius === '999px');
  assert.ok((await button.getAttribute('class'))?.includes('rounded-full  px-4'));
  result.checks.push('Anchored static class edit changes actual button rounding and retains original double spacing; fixture CSS, not Tailwind compiler acceptance');
  const styles = await setCssDeclaration(css, '.action', 'min-height', '56px');
  await writeFile(path.join(root, 'style.css'), styles.output);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('button')!).minHeight === '56px');
  result.checks.push('CSS declaration edit reaches computed styles through real HMR');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await button.evaluate(e => getComputedStyle(e).borderRadius), '999px');
  await page.screenshot({ path: path.join(output, 'source-patching-browser.png') });
  await writeFile(path.join(root, 'App.tsx'), applySourcePatch(classes.output, classes.inversePatch));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('button')!).borderRadius === '0px');
  await writeFile(path.join(root, 'App.tsx'), applySourcePatch(text.output, text.inversePatch));
  await writeFile(path.join(root, 'style.css'), applySourcePatch(styles.output, styles.inversePatch));
  await page.waitForFunction(() => document.querySelector('[data-target="copy"]')?.textContent === 'Old' && getComputedStyle(document.querySelector('button')!).minHeight === '40px');
  assert.equal(await readFile(path.join(root, 'App.tsx'), 'utf8'), original);
  assert.equal(await readFile(path.join(root, 'style.css'), 'utf8'), css);
  assert.equal(await page.locator('h1').textContent(), 'New');
  assert.equal(await page.locator('output').textContent(), '1');
  assert.equal(navigations, 1);
  assert.equal(result.errors.length, 0);
  result.checks.push('Inverse patches restore original TSX/CSS bytes and visible text/shape without changing the earlier heading, reloading the page or losing state');
} catch (error) { result.failure = String(error); process.exitCode = 1; }
finally { await browser?.close(); await server.close(); await writeFile(path.join(output, 'source-patching-browser-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
