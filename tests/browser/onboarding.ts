import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const origin = process.env.HARNESS_TEST_ORIGIN ?? 'http://localhost:8790';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw Error('This synthetic connection test is localhost only.');
const result = { startedAt:new Date().toISOString(), completedAt:null as string|null,
  scope:'Actual local shell with synthetic connection states. No real keys, GitHub import, paid requests or private Site acceptance.',
  checks:[] as string[], words:[] as Array<{width:number;count:number}>, errors:[] as string[], externalRequests:[] as string[], failure:null as string|null };
const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true });
try {
  const context = await browser.newContext({ viewport:{width:1440,height:1000} });
  let connected = false;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { result.externalRequests.push(url.origin); return route.abort(); }
    if (url.pathname === '/api/github/status') return route.fulfill({json:{configured:false,connected:false,setupAvailable:true}});
    if (url.pathname === '/api/settings/openai-key') return route.fulfill({json:{connected,masked:connected?'test-only':undefined,models:connected?['test-model']:[]}});
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:409,json:{error:'This UX test cannot import source or spend credits.'}});
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  await page.goto(origin,{waitUntil:'networkidle',timeout:90000});
  const addKey=page.getByRole('button',{name:'Add key',exact:true});
  await addKey.click();
  const dialog=page.getByRole('dialog',{name:'Connect AI',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('OpenAI API key',{exact:true})).toBeFocused();
  assert.equal(await dialog.getByLabel('OpenAI API key',{exact:true}).evaluate(el=>getComputedStyle(el).fontSize),'16px');
  assert.equal(await dialog.locator('.key-privacy').getAttribute('open'),null);
  for (const direction of ['Tab','Shift+Tab']) for (let i=0;i<10;i++) {
    await page.keyboard.press(direction);
    assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('dialog[open]'))),true);
  }
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(addKey).toBeFocused();
  result.checks.push('AI dialog focuses the field, contains keyboard focus, closes on Escape and restores the opening control');
  for (const width of [1440,768,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});await addKey.click();
    const count=(await dialog.innerText()).trim().split(/\s+/).length;result.words.push({width,count});assert.ok(count<=35);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const panel=await dialog.locator('section').boundingBox();assert.ok(panel&&panel.x>=0&&panel.x+panel.width<=width+1);
    await page.screenshot({path:`outputs/audit/onboarding-ai-${width}.png`});
    await dialog.getByText('Privacy & cost',{exact:true}).click();assert.equal(await dialog.locator('.key-privacy').getAttribute('open'),'');
    await expect(dialog).toContainText('Agent requests use your OpenAI credits.');
    await page.keyboard.press('Escape');
  }
  result.checks.push('Short AI setup fits desktop/tablet/mobile; privacy and credit disclosure opens by click, not hover only');
  await page.setViewportSize({width:1440,height:1000});await addKey.click();
  await dialog.getByLabel('OpenAI API key',{exact:true}).click();await expect(dialog).toBeVisible();
  await dialog.getByLabel('OpenAI API key',{exact:true}).fill('not-a-real-key');
  await page.mouse.click(4,4);await expect(dialog).toHaveCount(0);await expect(addKey).toBeFocused();
  await addKey.click();await expect(dialog.getByLabel('OpenAI API key',{exact:true})).toHaveValue('');await page.keyboard.press('Escape');
  result.checks.push('Inside clicks preserve the dialog; dismissal clears an unsubmitted key and restores focus without changing a connected session');
  const newWorkspace=page.getByRole('button',{name:'New workspace',exact:true});await newWorkspace.click();
  const workspace=page.getByRole('dialog',{name:'New workspace',exact:true});
  await expect(workspace.getByLabel('Workspace name',{exact:true})).toBeFocused();
  await workspace.getByRole('button',{name:'Import GitHub repo',exact:true}).click();
  await expect(workspace.getByText('I trust this repository. Ask before running scripts.',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(workspace).toHaveCount(0);await expect(newWorkspace).toBeFocused();
  result.checks.push('Repository dialog focuses the name, keeps trust visible and supports Escape/focus return');
  connected=true;await page.reload({waitUntil:'networkidle'});
  const manage=page.getByRole('button',{name:'Manage connected AI key',exact:true});await manage.click();
  const connectedDialog=page.getByRole('dialog',{name:'AI connection',exact:true});
  await expect(connectedDialog.getByRole('button',{name:'Close AI setup',exact:true})).toBeFocused();
  await expect(connectedDialog).toContainText('test-only');await expect(connectedDialog.getByRole('button',{name:'Forget key',exact:true})).toBeVisible();
  assert.equal(await connectedDialog.locator('input').count(),0);await page.keyboard.press('Escape');await expect(manage).toBeFocused();
  result.checks.push('Connected view shows a synthetic mask and Forget key, not an editable or full credential');
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.externalRequests,[]);result.completedAt=new Date().toISOString();
} catch(error) { result.failure=String(error);process.exitCode=1; }
finally { await browser.close();await writeFile('outputs/audit/onboarding-dialog-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2)); }
