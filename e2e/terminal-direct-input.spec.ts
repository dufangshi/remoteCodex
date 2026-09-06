import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { api, ensureWorkspaceDir } from './helpers';
const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;

test('terminal types directly, sends touch controls, switches sessions and keeps its canvas above IME', async ({ page }, testInfo) => {
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  const workspacePath = await ensureWorkspaceDir(path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e'), `terminal-${randomUUID().slice(0,8)}`);
  const workspace = await api<any>(apiBase, '/api/workspaces', {method:'POST', body:JSON.stringify({absPath:workspacePath,label:'Terminal test'})});
  const thread = await api<any>(apiBase, '/api/threads/start', {method:'POST',body:JSON.stringify({workspaceId:workspace.id,provider:'codex',model:'default',title:'Terminal input regression',approvalMode:'yolo'})});
  await api(apiBase, `/api/threads/${thread.id}/shell`, {method:'POST', body:'{}'});
  const inputs: Array<{data:string; shellId:string}> = [];
  let output = '';
  page.on('websocket', socket => {
    socket.on('framesent', frame => {try { const msg=JSON.parse(String(frame.payload)); if(msg.type==='shell.input') inputs.push(msg); }catch{}});
    socket.on('framereceived', frame => {try { const msg=JSON.parse(String(frame.payload)); if(msg.type==='shell.output') output += msg.payload?.data ?? ''; }catch{}});
  });
  try {
    await page.goto(`/threads/${thread.id}`);
    await page.reload();
    await page.getByRole('button',{name:'Switch to shell',exact:true}).click();
    const mobile = testInfo.project.name === 'mobile-chromium';
    const controls = page.getByRole('toolbar',{name:'Terminal controls'});
    await expect(page.locator('.shell-pane-active .xterm')).toBeVisible();
    await expect.poll(async () => {
      const frame = (await page.locator('.shell-terminal-frame').boundingBox())!;
      const screen = (await page.locator('.shell-pane-active .xterm-screen').boundingBox())!;
      return frame.height - screen.height;
    }).toBeLessThan(45);
    if (mobile) {
      await expect(controls.getByRole('button',{name:'Terminal Tab',exact:true})).toBeEnabled();
      await expect(controls.locator('button[aria-label*="Disconnect"], button[aria-label*="Connect"]')).toHaveCount(0);
    } else await expect(controls).toHaveCount(0);
    const terminal = page.locator('.shell-pane-active .xterm-helper-textarea');
    await page.locator(mobile ? '.shell-pane-active .xterm-viewport' : '.shell-pane-active .xterm-screen').click();
    await expect(terminal).toBeFocused();
    await page.keyboard.type("printf 'TERMINAL_DIRECT_OK\\n'");
    await page.keyboard.press('Enter');
    await expect.poll(()=>output).toContain('TERMINAL_DIRECT_OK');
    if (!mobile) {
      await page.keyboard.press('Control+c');
      await expect.poll(()=>inputs.some(x=>x.data==='\x03')).toBe(true);
      const back = page.getByRole('button',{name:'Back to chat',exact:true});
      const frame = (await page.locator('.shell-terminal-frame').boundingBox())!;
      const button = (await back.boundingBox())!;
      expect(button.y).toBeGreaterThan(frame.y + frame.height - 90);
      expect(button.x + button.width).toBeLessThan(frame.x + frame.width);
      await expect(back).toHaveText('');
      await back.click();
      await expect(page.getByRole('textbox',{name:'Prompt',exact:true})).toBeVisible();
      return;
    }
    await controls.getByRole('button',{name:'Control modifier'}).click();
    await page.keyboard.type('c');
    await expect.poll(()=>inputs.some(x=>x.data==='\x03')).toBe(true);
    for(const [label,data] of [['Esc','\x1b'],['Tab','\t'],['↑','\x1b[A'],['↓','\x1b[B'],['←','\x1b[D'],['→','\x1b[C']]) {
      await controls.getByRole('button',{name:`Terminal ${label}`,exact:true}).click();
      await expect.poll(()=>inputs.at(-1)?.data).toBe(data);
      await expect(terminal).toBeFocused();
    }
    const firstId = inputs[0]!.shellId;
    await controls.getByRole('button',{name:'Switch terminal session'}).click();
    const sessions=page.getByRole('dialog',{name:'Terminal sessions'});
    await expect(sessions).toBeVisible();
    await sessions.getByRole('button',{name:'New shell',exact:true}).click();
    await expect(sessions).toHaveCount(0);
    await expect(controls.getByRole('button',{name:'Terminal Tab',exact:true})).toBeEnabled();
    await controls.getByRole('button',{name:'Terminal Tab',exact:true}).click();
    await expect.poll(()=>inputs.at(-1)?.shellId).not.toBe(firstId);
    await controls.getByRole('button',{name:'Switch terminal session'}).click();
    await expect(sessions.getByRole('button',{name:'Shell 1',exact:true})).toBeVisible();
    await sessions.getByRole('button',{name:'Shell 1',exact:true}).click();
    await controls.getByRole('button',{name:'Terminal Tab',exact:true}).click();
    await expect.poll(()=>inputs.at(-1)?.shellId).toBe(firstId);
    await controls.getByRole('button',{name:'Switch terminal session'}).click();
    await sessions.getByRole('button',{name:'Rename Shell 2',exact:true}).click();
    await sessions.getByRole('textbox',{name:'Shell name'}).fill('build logs');
    await sessions.getByRole('button',{name:'Save',exact:true}).click();
    await expect(sessions.getByRole('button',{name:'build logs',exact:true})).toBeVisible();
    const renamed = await api<any>(apiBase,`/api/threads/${thread.id}/shell`);
    expect(renamed.shells.some((s:any)=>s.label==='build logs')).toBe(true);
    await sessions.getByRole('button',{name:'Kill build logs',exact:true}).click();
    await expect(sessions.getByRole('button',{name:'build logs',exact:true})).toHaveCount(0);
    await controls.getByRole('button',{name:'Switch terminal session'}).click();
    await page.locator('.shell-pane-active .xterm-viewport').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.type("printf '%s\\n' {1..180}");
    await page.keyboard.press('Enter');
    await expect.poll(()=>output).toContain('180');
    const viewport=page.locator('.shell-pane-active .xterm-viewport');
    await expect.poll(()=>viewport.evaluate(el=>el.scrollTop)).toBeGreaterThan(500);
    const bounds=(await viewport.boundingBox())!;
    const cdp=await page.context().newCDPSession(page);
    const x=bounds.x+bounds.width/2, y=bounds.y+100;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    // Real timed touch samples establish fling velocity, then native scroll must
    // continue after release (not merely move while the finger is down).
    for(let i=1;i<=5;i++) {
      await page.waitForTimeout(20);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+i*24}]});
    }
    const releasedAt=await viewport.evaluate(el=>el.scrollTop);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>viewport.evaluate(el=>el.scrollTop)).toBeLessThan(releasedAt-10);
    await cdp.detach();
    await viewport.click();
    if(testInfo.project.name==='mobile-chromium') {
      // A deterministic visualViewport IME event exercises geometry without
      // claiming Playwright's desktop host can launch an Android soft keyboard.
      const before = (await page.locator('.shell-terminal-frame').boundingBox())!;
      const barBefore = (await controls.boundingBox())!;
      await page.evaluate(() => {
        const viewport=window.visualViewport!;
        Object.defineProperty(viewport,'height',{configurable:true,value:viewport.height-290});
        viewport.dispatchEvent(new Event('resize'));
      });
      await expect.poll(async()=>Math.round((await controls.boundingBox())!.y)).toBe(Math.round(barBefore.y-290));
      const after=(await page.locator('.shell-terminal-frame').boundingBox())!;
      expect(after.y).toBe(before.y); expect(after.height).toBe(before.height);
      await page.screenshot({path:testInfo.outputPath('terminal-keyboard.png')});
      await page.evaluate(()=>{delete (window.visualViewport as any).height; window.visualViewport!.dispatchEvent(new Event('resize'));});
      await expect.poll(async()=>Math.round((await controls.boundingBox())!.y)).toBe(Math.round(barBefore.y));
    }
    await controls.getByRole('button',{name:'Back to chat'}).click();
    await expect(page.getByRole('textbox',{name:'Prompt',exact:true})).toBeVisible();
  } finally {
    const state=await api<any>(apiBase,`/api/threads/${thread.id}/shell`);
    for(const shell of state.shells ?? []) await api(apiBase,`/api/shells/${shell.id}/terminate`,{method:'POST'});
  }
});
