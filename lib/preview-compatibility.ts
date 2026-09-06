// Executed by Node inside the browser runner, not in the control-plane Worker.
// Next 16 App Router needs isolated request context across native async/await.
// Test behavior rather than hard-coding a WebContainer release as compatible.
export const NEXT_ASYNC_CONTEXT_PROBE = `
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
Promise.all(['one', 'two'].map(id => context.run(id, async () => {
  if (context.getStore() !== id) throw new Error('Synchronous context failed');
  await Promise.resolve();
  if (context.getStore() !== id) throw new Error('Async request context lost');
  await new Promise(resolve => setTimeout(resolve, 1));
  if (context.getStore() !== id) throw new Error('Timed request context lost');
}))).then(() => {
  if (context.getStore() !== undefined) throw new Error('Request context leaked');
  console.log('Request context supported');
}).catch(error => { console.error(error.message); process.exitCode = 78; });
`;

export const NEXT_CONTEXT_ERROR = 'This browser runner cannot preserve the request context Next.js 16 needs. Preview is unavailable; no dependencies were installed and your source is unchanged.';
