import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const port=Number(process.env.E2E_API_PORT??8787);
const base=`http://127.0.0.1:${port}`;
const database=path.resolve(process.env.E2E_DATABASE_URL??`.local/e2e-${port}.sqlite`);

test('ACP live state repairs a stale snapshot and queued composer input survives reload',async({page,request})=>{
  const absPath=path.resolve('.local',`state-recovery-${randomUUID()}`);await mkdir(absPath,{recursive:true});
  const ws=await (await request.post(`${base}/api/workspaces`,{data:{absPath,label:'State recovery fixture'}})).json();
  const created=await (await request.post(`${base}/api/threads/start`,{data:{workspaceId:ws.id,title:'State recovery fixture',provider:'acp',agentId:'grok',model:'ios-e2e-stream',approvalMode:'yolo'}})).json();
  const id=created.id??created.thread.id;
  const detail=async()=>await (await request.get(`${base}/api/threads/${id}`)).json();
  try {
    await page.goto(`/threads/${id}`);
    await page.getByRole('textbox',{name:'Prompt'}).fill('Inspect this repository in depth');
    await page.getByRole('button',{name:'Send Prompt',exact:true}).click();
    await expect.poll(async()=>(await detail()).thread.status).toBe('running');
    const db=new DatabaseSync(database);
    try {
      // The fixture exists only in the explicitly isolated Playwright database.
      expect(db.prepare('SELECT id FROM threads WHERE id=?').get(id)).toBeTruthy();
      db.prepare("UPDATE threads SET status='interrupted',last_error='stale fixture' WHERE id=?").run(id);
      db.prepare("UPDATE thread_turns SET status='interrupted',completed_at='stale' WHERE thread_id=?").run(id);
    } finally {db.close();}
    await page.goto(`/threads/${id}`);
    await expect.poll(async()=>(await detail()).thread.status).toBe('running');
    await expect(page.getByRole('textbox',{name:'Prompt'})).toBeVisible();
    await expect(page.getByText('Interrupted by user',{exact:true})).toHaveCount(0);
    const prompt=`Keep this saved message ${randomUUID()}`;
    await page.getByRole('textbox',{name:'Prompt'}).fill(prompt);
    await page.getByRole('button',{name:'Send Prompt',exact:true}).click();
    await expect.poll(async()=>(await detail()).pendingSteers.map((p:{prompt:string})=>p.prompt)).toContain(prompt);
    await page.reload();
    await expect(page.getByText(prompt,{exact:true}).first()).toBeVisible();
    await request.post(`${base}/api/threads/${id}/interrupt`,{data:{}});
    await expect.poll(async()=>(await detail()).thread.status).toBe('idle');
    const completed=await detail();
    expect(completed.turns).toHaveLength(2);
    expect(completed.turns[1].status).toBe('completed');
    expect(completed.pendingSteers).toHaveLength(0);
    await page.reload();
    await expect(page.getByText(prompt,{exact:true}).first()).toBeVisible();
    expect((await detail()).turns[1].items.filter((i:{kind:string;text:string})=>i.kind==='userMessage'&&i.text===prompt)).toHaveLength(1);
  } finally {await request.post(`${base}/api/threads/${id}/interrupt`,{data:{}});}
});
