import {test,before,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const objects=new Map();globalThis.__cookie='';globalThis.__auth={id:'test-owner',email:'owner@example.test'};
const migrations=()=>readdirSync(new URL('../drizzle/',import.meta.url)).filter(p=>p.endsWith('.sql')).sort().map(p=>readFileSync(new URL('../drizzle/'+p,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
const sql=new DatabaseSync(':memory:');sql.exec(migrations());
const wrap=(query,args=[])=>({bind(...v){return wrap(query,v);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
globalThis.__env={ADMIN_TOKEN:'a'.repeat(64),ADMIN_EMAILS:'owner@example.test',API_ENCRYPTION_KEY:'e'.repeat(64),DB:{prepare:wrap,async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}},BUCKET:{async put(k,v){objects.set(k,v);},async get(k){const b=objects.get(k);return b?{body:b,async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}}:null;},async delete(k){objects.delete(k);}}};
let api,image,security;
before(async()=>{mkdirSync('.sites-runtime/tests',{recursive:true});for(const [name,entry] of [['api','app/api/workspace/route.ts'],['image','app/api/image/route.ts'],['security','lib/security.ts']]){await build({entryPoints:[entry],outfile:`.sites-runtime/tests/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'runtime-stubs',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__env;':"export async function headers(){return new Headers({'oai-authenticated-user-id':globalThis.__auth?.id||'', 'oai-authenticated-user-email':globalThis.__auth?.email||''})} export async function cookies(){return {get(name){const value=name==='arika_client'?globalThis.__client:globalThis.__cookie;return value?{value}:undefined}}}"}));}}]});}api=await import('../.sites-runtime/tests/api.mjs');image=await import('../.sites-runtime/tests/image.mjs');security=await import('../.sites-runtime/tests/security.mjs');});
beforeEach(()=>{sql.exec('DELETE FROM rate_limits; DELETE FROM ai_locks');globalThis.__auth={id:'test-owner',email:'owner@example.test'};});
const request=(b)=>new Request('https://arika.test/api/workspace',{method:'POST',headers:{Origin:'https://arika.test','Content-Type':'application/json'},body:JSON.stringify(b)});
async function call(b){const r=await api.POST(request(b));return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};}
test('Invitation authorization, owner-only writes, protected images and revocation',async()=>{
let r=await api.GET(new Request('https://arika.test/api/workspace'));assert.equal(r.status,400);
assert.equal((await call({action:'login',token:'wrong'})).status,400);
let login=await call({action:'login',token:'a'.repeat(64)});assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly; Secure; SameSite=Lax/);globalThis.__cookie='a'.repeat(64);
let data=await (await api.GET(new Request('https://arika.test/api/workspace?space=shared-space'))).json();const invite=data.invite;assert.equal(invite.length,32);
const saved=await call({action:'save',space:'shared-space',label:'窓側',notes:'黒いマイク',frames:[{data:'data:image/jpeg;base64,/9j/2Q==',time:1}]});assert.equal(saved.status,200);const id=saved.data.id;
const keySet=await call({action:'setkey',key:'sk-'+ 'test'.repeat(10)});assert.equal(keySet.status,200);const encrypted=sql.prepare("SELECT value FROM config WHERE key='api_key'").get().value;assert.equal(encrypted.includes('sk-'),false);
assert.equal((await call({action:'login',token:invite})).status,200);globalThis.__cookie=invite;
for(const action of ['save','delete','rotate','edit','setkey'])assert.equal((await call({action,space:'shared-space',capture:id,key:'sk-x'})).status,400,action);
assert.equal((await call({action:'analyze',space:'shared-space',capture:id})).status,400);
const found=await call({action:'search',space:'shared-space',query:'マイクはどこですか'});assert.equal(found.data.results.length,1);assert.equal(found.data.cost,0);
const img=found.data.results[0].image;assert.equal((await image.GET(new Request('https://arika.test/api/image?id='+encodeURIComponent(img)))).status,200);
data=await (await api.GET(new Request('https://arika.test/api/workspace?space=shared-space'))).json();assert.equal(data.invite,'');assert.equal(data.spaces[0].invite,undefined);assert.equal(data.captures[0].canDelete,false);
globalThis.__cookie='';assert.equal((await image.GET(new Request('https://arika.test/api/image?id='+encodeURIComponent(img)))).status,400);
globalThis.__cookie='a'.repeat(64);assert.equal((await call({action:'rotate',space:'shared-space'})).status,200);globalThis.__cookie=invite;assert.equal((await call({action:'search',space:'shared-space',query:'マイク'})).status,400);
globalThis.__cookie='a'.repeat(64);assert.equal((await call({action:'delete',space:'shared-space',capture:id})).status,200);assert.equal(objects.size,0);
});
test('Batched observations keep evidence indices, aliases and billed usage; failures preserve saved observations',async()=>{
 globalThis.__cookie='a'.repeat(64);
 const saved=await call({action:'save',space:'shared-space',label:'会場',notes:'既存メモ',frames:Array.from({length:7},(_,time)=>({data:'data:image/jpeg;base64,/9j/2Q==',time}))});
 const id=saved.data.id,realFetch=globalThis.fetch;let calls=0;
 const answer=(objects,finish_reason='stop')=>Response.json({usage:{prompt_tokens:1000,completion_tokens:100},choices:[{finish_reason,message:{content:JSON.stringify({objects})}}]});
 const observation={name:'鋏',aliases:['はさみ','scissors'],description:'赤い持ち手',location:'机上',frame:0,box:[.1,.2,.4,.5]};
 globalThis.fetch=async(url,init)=>{calls++;const payload=JSON.parse(init.body);const images=payload.messages[1].content.filter(x=>x.type==='image_url');assert.equal(images.length,calls<3?3:1);assert.ok(images.every(x=>x.image_url.detail==='high'));return answer([observation]);};
 try{
  const result=await call({action:'analyze',space:'shared-space',capture:id});assert.equal(result.status,200);assert.equal(calls,3);assert.deepEqual(result.data.objects.map(o=>o.frame),[0,3,6]);assert.ok(Math.abs(result.data.cost-.00168)<1e-9);
  const found=await call({action:'search',space:'shared-space',query:'Scissorsはどこですか'});assert.equal(found.data.results.length,3);assert.deepEqual(found.data.results.map(o=>o.time),[0,3,6]);
  assert.equal((await call({action:'search',space:'shared-space',query:'冷蔵庫'})).data.results.length,0);
  assert.equal((await call({action:'search',space:'shared-space',query:'赤いハサミ'})).data.results.length,3);
  assert.equal((await call({action:'search',space:'shared-space',query:'青いハサミ'})).data.results.length,0);
  const before=sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects;
  globalThis.fetch=async()=>answer([observation],'length');
  assert.equal((await call({action:'analyze',space:'shared-space',capture:id})).status,400);
  assert.equal(sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects,before);
  // A successful first batch and an unknown second batch are charged; the
  // third batch is never sent and its reservation is released.
  calls=0;globalThis.fetch=async()=>{calls++;if(calls===2)throw new Error('simulated timeout');return answer([observation]);};
  const prior=sql.prepare('SELECT SUM(cost) AS n FROM ledger').get().n;
  assert.equal((await call({action:'analyze',space:'shared-space',capture:id})).status,400);assert.equal(calls,2);
  assert.ok(Math.abs(sql.prepare('SELECT SUM(cost) AS n FROM ledger').get().n-prior-.05056)<1e-9);
  assert.equal(sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects,before);
  sql.exec('DELETE FROM rate_limits');globalThis.fetch=async()=>answer([]);
  assert.deepEqual((await call({action:'analyze',space:'shared-space',capture:id,query:'冷蔵庫'})).data.objects,[]);
  assert.equal(sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects,before);
 }finally{globalThis.fetch=realFetch;}
});
test('AI search learns only a user-confirmed result, with tamper and deleted-image protection',async()=>{
 globalThis.__cookie='a'.repeat(64);
 const saved=await call({action:'save',space:'shared-space',label:'確認テスト',notes:'残すメモ',frames:[0,1,2].map(time=>({data:'data:image/jpeg;base64,/9j/2Q==',time}))});
 const id=saved.data.id,frames=JSON.parse(sql.prepare('SELECT frames FROM captures WHERE id=?').get(id).frames),query='音声収録に使う道具';
 const realFetch=globalThis.fetch;let calls=0;
 let hits=[{name:'マイクロホン',description:'黒い本体',location:'棚上',frame:1},{name:'別のマイク',description:'白い本体',location:'机上',frame:2}];
 globalThis.fetch=async()=>{calls++;return Response.json({usage:{prompt_tokens:1000,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify({objects:hits})}}]});};
 try{
  globalThis.__cookie=sql.prepare("SELECT invite FROM spaces WHERE id='shared-space'").get().invite;
  const initial=sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects;
  const ai=await call({action:'analyze',space:'shared-space',capture:id,query});assert.equal(ai.status,200);assert.ok(ai.data.receipt);
  assert.equal(sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects,initial);
  assert.equal((await call({action:'search',space:'shared-space',query})).data.results.length,0);
  await call({action:'feedback',space:'shared-space',found:false,receipt:ai.data.receipt,resultIndex:0});
  assert.equal(sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects,initial);
  await call({action:'feedback',space:'shared-space',found:true});
  assert.equal(sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects,initial);
  assert.equal((await call({action:'feedback',space:'shared-space',found:true,receipt:ai.data.receipt+'x',resultIndex:0})).status,400);
  assert.equal((await call({action:'feedback',space:'shared-space',found:true,receipt:ai.data.receipt,resultIndex:99})).status,400);
  const confirmed=await call({action:'feedback',space:'shared-space',found:true,receipt:ai.data.receipt,resultIndex:0});assert.equal(confirmed.status,200);assert.equal(confirmed.data.learned,true);
  const count=calls,found=await call({action:'search',space:'shared-space',query:query+'はどこですか'});
  assert.equal(calls,count);assert.equal(found.data.results.length,1);assert.equal(found.data.results[0].image,frames[1].id);
  await call({action:'feedback',space:'shared-space',found:true,receipt:ai.data.receipt,resultIndex:0});
  assert.equal(JSON.parse(sql.prepare('SELECT objects FROM captures WHERE id=?').get(id).objects).filter(o=>o.learnedQueries?.length).length,1);
  globalThis.__cookie='a'.repeat(64);
  hits=[];assert.equal((await call({action:'analyze',space:'shared-space',capture:id,query:'不在'})).data.receipt,'');
  assert.equal((await call({action:'analyze',space:'shared-space',capture:id})).status,200);
  assert.equal((await call({action:'search',space:'shared-space',query})).data.results.length,1);
  await call({action:'deleteFrame',space:'shared-space',capture:id,image:frames[1].id});
  globalThis.__cookie=sql.prepare("SELECT invite FROM spaces WHERE id='shared-space'").get().invite;
  assert.equal((await call({action:'feedback',space:'shared-space',found:true,receipt:ai.data.receipt,resultIndex:0})).status,400);
  assert.equal((await call({action:'search',space:'shared-space',query})).data.results.length,0);
 }finally{globalThis.fetch=realFetch;globalThis.__cookie='a'.repeat(64);await call({action:'delete',space:'shared-space',capture:id});}
});
test('AI usage charges and atomic budget ceiling, without real API spending',async()=>{
globalThis.__cookie='a'.repeat(64);let calls=0;const realFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({usage:{prompt_tokens:30000,completion_tokens:1000},choices:[{message:{content:JSON.stringify({objects:[{name:'マイク',description:'黒',location:'机上',frame:0,box:[.1,.2,.4,.5]}]})}}]});};
try{const saved=await call({action:'save',space:'shared-space',label:'会場',notes:'',frames:[{data:'data:image/jpeg;base64,/9j/2Q==',time:1}]});const id=saved.data.id;
const r=await call({action:'analyze',space:'shared-space',capture:id});assert.equal(r.status,200);assert.ok(Math.abs(r.data.cost-.0136)<1e-10);assert.equal(calls,1);
const old=sql.prepare('SELECT SUM(cost) AS n FROM ledger').get().n;sql.prepare('INSERT INTO ledger(id,space,kind,cost,status,created) VALUES(?,?,?,?,?,?)').run('test-budget','shared-space','test',4.46-old,'completed','now');
assert.equal((await call({action:'analyze',space:'shared-space',capture:id})).status,400);assert.equal(calls,1);
assert.ok(sql.prepare('SELECT SUM(cost) AS n FROM ledger').get().n<=4.5);
}finally{globalThis.fetch=realFetch;}
});

test('Saved image deletion preserves evidence, rejects viewers and protects the last image',async()=>{
 globalThis.__cookie='a'.repeat(64);
 const saved=await call({action:'save',space:'shared-space',label:'画像削除テスト',notes:'残すメモ',frames:[0,1,2].map(time=>({data:'data:image/jpeg;base64,/9j/2Q==',time}))});
 assert.equal(saved.status,200);const id=saved.data.id;
 const row=sql.prepare('SELECT * FROM captures WHERE id=?').get(id),frames=JSON.parse(row.frames);
 const observations=[...JSON.parse(row.objects),...frames.map((_,frame)=>({name:'対象'+frame,frame,source:'AI'}))];
 sql.prepare('UPDATE captures SET objects=? WHERE id=?').run(JSON.stringify(observations),id);
 const invite=sql.prepare("SELECT invite FROM spaces WHERE id='shared-space'").get().invite;
 globalThis.__cookie=invite;
 assert.equal((await call({action:'deleteFrame',space:'shared-space',capture:id,image:frames[1].id})).status,400);
 globalThis.__cookie='a'.repeat(64);
 assert.equal((await call({action:'deleteFrame',space:'shared-space',capture:id,image:'invalid'})).status,400);
 assert.equal((await call({action:'deleteFrame',space:'shared-space',capture:id,image:frames[1].id})).status,200);
 let updated=sql.prepare('SELECT * FROM captures WHERE id=?').get(id);
 assert.deepEqual(JSON.parse(updated.frames).map(f=>f.id),[frames[0].id,frames[2].id]);
 assert.deepEqual(JSON.parse(updated.objects).map(o=>[o.name,o.frame]),[['残すメモ',0],['対象0',0],['対象2',1]]);
 assert.equal(objects.has(frames[1].id),false);
 assert.equal((await image.GET(new Request('https://arika.test/api/image?id='+encodeURIComponent(frames[1].id)))).status,400);
 assert.equal((await call({action:'deleteFrame',space:'shared-space',capture:id,image:frames[0].id})).status,200);
 updated=sql.prepare('SELECT * FROM captures WHERE id=?').get(id);
 assert.deepEqual(JSON.parse(updated.objects).map(o=>[o.name,o.frame]),[['残すメモ',0],['対象2',0]]);
 assert.equal((await call({action:'deleteFrame',space:'shared-space',capture:id,image:frames[2].id})).status,400);
 assert.equal(objects.has(frames[2].id),true);
 await call({action:'delete',space:'shared-space',capture:id});
});

test('Company settings preserve existing links, encrypted key, captures and accumulated charges',async()=>{
 globalThis.__cookie='a'.repeat(64);
 const before={space:sql.prepare("SELECT * FROM spaces WHERE id='shared-space'").get(),captures:sql.prepare('SELECT * FROM captures ORDER BY id').all(),ledger:sql.prepare('SELECT * FROM ledger ORDER BY id').all(),key:sql.prepare("SELECT value FROM config WHERE key='api_key'").get().value};
 const data=await (await api.GET(new Request('https://arika.test/api/workspace?space=shared-space'))).json();
 assert.equal(data.budget.limit,4.5);assert.equal(data.budget.cap,4.5);
 for(const limit of [-1,4.51,'2',null,1.001])assert.equal((await call({action:'settings',space:'shared-space',name:'会社A',budgetLimit:limit})).status,400);
 globalThis.__cookie=before.space.invite;
 assert.equal((await call({action:'settings',space:'shared-space',name:'乗っ取り',budgetLimit:0})).status,400);
 globalThis.__cookie='a'.repeat(64);
 assert.equal((await call({action:'settings',space:'shared-space',name:'会社A',budgetLimit:2})).status,200);
 assert.equal((await call({action:'login',token:'a'.repeat(64)})).status,200);
 const after=sql.prepare("SELECT * FROM spaces WHERE id='shared-space'").get();
 assert.deepEqual({...after,name:before.space.name},{...before.space});assert.equal(after.name,'会社A');
 assert.deepEqual(sql.prepare('SELECT * FROM captures ORDER BY id').all(),before.captures);
 assert.deepEqual(sql.prepare('SELECT * FROM ledger ORDER BY id').all(),before.ledger);
 assert.equal(sql.prepare("SELECT value FROM config WHERE key='api_key'").get().value,before.key);
 assert.equal((await call({action:'login',token:before.space.invite})).status,200);
 const next=await (await api.GET(new Request('https://arika.test/api/workspace?space=shared-space'))).json();assert.equal(next.budget.limit,2);assert.equal(next.budget.total,data.budget.total);assert.equal(next.aiReady,true);
});

test('Fresh companies start without a key, retain manual search, isolate credentials/data, and enforce custom budgets',async()=>{
 const original={...globalThis.__env},oldCookie=globalThis.__cookie,realFetch=globalThis.fetch;let calls=0;
 const fresh=()=>{
  const db=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const prepare=(query,args=[])=>({bind(...v){return prepare(query,v);},async first(){return db.prepare(query).get(...args)||null;},async all(){return {results:db.prepare(query).all(...args)};},async run(){const r=db.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
  const images=new Map();return {db,env:{ADMIN_EMAILS:'owner@example.test',API_ENCRYPTION_KEY:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),ADMIN_TOKEN:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),DB:{prepare,async batch(stmts){db.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{async put(k,v){images.set(k,v);},async get(k){const v=images.get(k);return v?{body:v,async arrayBuffer(){return v.buffer;}}:null;},async delete(k){images.delete(k);}}}};
 };
 const a=fresh(),b=fresh();
 const select=(company)=>{for(const key of Object.keys(globalThis.__env))delete globalThis.__env[key];Object.assign(globalThis.__env,company.env);globalThis.__cookie='';};
 globalThis.fetch=async()=>{calls++;return Response.json({usage:{prompt_tokens:1000,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:'{"objects":[]}'}}]});};
 try{
  select(a);
  assert.equal((await call({action:'login',token:''})).status,400);
  assert.equal((await call({action:'login',token:a.env.ADMIN_TOKEN})).status,200);globalThis.__cookie=a.env.ADMIN_TOKEN;
  let d=await (await api.GET(new Request('https://arika.test/api/workspace?space=shared-space'))).json();
  assert.equal(d.aiReady,false);assert.equal(d.captures.length,0);assert.equal(d.budget.total,0);assert.equal(d.budget.limit,4.5);const inviteA=d.invite;
  const saved=await call({action:'save',space:'shared-space',label:'会社A',notes:'赤いはさみ',frames:[{data:'data:image/jpeg;base64,/9j/2Q==',time:1}]});assert.equal(saved.status,200);
  assert.equal((await call({action:'search',space:'shared-space',query:'はさみ'})).data.results.length,1);
  assert.equal((await call({action:'analyze',space:'shared-space',capture:saved.data.id})).status,400);assert.equal(calls,0);
  assert.equal((await call({action:'settings',space:'shared-space',name:'会社A',budgetLimit:0.05})).status,200);
  assert.equal((await call({action:'setkey',key:'sk-'+ 'test'.repeat(10)})).status,200);
  const concurrent=await Promise.all([call({action:'analyze',space:'shared-space',capture:saved.data.id}),call({action:'analyze',space:'shared-space',capture:saved.data.id})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,400]);assert.equal(calls,1);
  const spent=a.db.prepare('SELECT SUM(cost) AS n FROM ledger').get().n;assert.ok(spent>0);
  await call({action:'settings',space:'shared-space',name:'会社A',budgetLimit:0});
  assert.equal((await call({action:'analyze',space:'shared-space',capture:saved.data.id})).status,400);assert.equal(calls,1);
  assert.equal(a.db.prepare('SELECT SUM(cost) AS n FROM ledger').get().n,spent);
  select(b);globalThis.__env.AI_BUDGET_CAP='20';
  assert.equal((await call({action:'login',token:a.env.ADMIN_TOKEN})).status,400);assert.equal((await call({action:'login',token:inviteA})).status,400);
  await call({action:'login',token:b.env.ADMIN_TOKEN});globalThis.__cookie=b.env.ADMIN_TOKEN;
  d=await (await api.GET(new Request('https://arika.test/api/workspace?space=shared-space'))).json();
  assert.equal(d.aiReady,false);assert.equal(d.captures.length,0);assert.equal(d.budget.total,0);assert.equal(d.budget.cap,20);assert.notEqual(d.invite,inviteA);
  assert.equal((await call({action:'settings',space:'shared-space',name:'会社B',budgetLimit:10})).status,200);
  assert.equal((await call({action:'search',space:'shared-space',query:'はさみ'})).data.results.length,0);
  globalThis.__env.AI_BUDGET_CAP='invalid';d=await (await api.GET(new Request('https://arika.test/api/workspace'))).json();assert.equal(d.budget.limit,0);
  select(a);assert.equal((await call({action:'login',token:inviteA})).status,200);globalThis.__cookie=inviteA;
  assert.equal((await call({action:'search',space:'shared-space',query:'はさみ'})).data.results.length,1);
 }finally{for(const key of Object.keys(globalThis.__env))delete globalThis.__env[key];Object.assign(globalThis.__env,original);globalThis.__cookie=oldCookie;globalThis.fetch=realFetch;a.db.close();b.db.close();}
});


test('Missing reports preserve context, deduplicate retries, restrict inbox/resolve and reject stale evidence',async()=>{
 globalThis.__cookie='a'.repeat(64);
 const space='shared-space',saved=await call({action:'save',space,label:'報告対象の棚',notes:'マイク',frames:[0,1].map(time=>({data:'data:image/jpeg;base64,/9j/2Q==',time}))});
 assert.equal(saved.status,200);const capture=saved.data.id;
 const frames=JSON.parse(sql.prepare('SELECT frames FROM captures WHERE id=?').get(capture).frames);
 const invite=sql.prepare('SELECT invite FROM spaces WHERE id=?').get(space).invite;globalThis.__cookie=invite;
 const base={action:'reportMissing',space,id:crypto.randomUUID(),query:'マイク',kind:'physical_missing',capture,image:frames[0].id,note:'棚を確認した',intent:'収録する',seconds:20};
 const feedbackBefore=sql.prepare('SELECT COUNT(*) AS n FROM feedback').get().n;
 assert.equal((await call(base)).status,200);assert.equal((await call(base)).status,200);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM missing_reports WHERE id=?').get(base.id).n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM feedback').get().n,feedbackBefore+1);
 const row=sql.prepare('SELECT * FROM missing_reports WHERE id=?').get(base.id);assert.equal(row.label,'報告対象の棚');assert.equal(row.image,frames[0].id);assert.equal(row.note,'棚を確認した');
 let data=await (await api.GET(new Request('https://arika.test/api/workspace?space='+space))).json();assert.deepEqual(data.reports,[]);assert.equal(data.reportPendingCount,0);
 assert.equal((await call({action:'resolveReports',space,ids:[base.id]})).status,400);
 assert.equal((await call({...base,space:'foreign-space',id:crypto.randomUUID()})).status,400);
 assert.equal((await call({...base,capture:'foreign-record',id:crypto.randomUUID()})).status,400);
 assert.equal((await call({...base,image:'foreign-image',id:crypto.randomUUID()})).status,400);
 assert.equal((await call({...base,query:'別の語'})).status,400);
 const noMatch={...base,id:crypto.randomUUID(),kind:'no_match',capture:'',image:'',query:'書籍'};
 assert.equal((await call(noMatch)).status,200);assert.equal(sql.prepare('SELECT label FROM missing_reports WHERE id=?').get(noMatch.id).label,'');
 const batch=globalThis.__env.DB.batch;globalThis.__env.DB.batch=async()=>{throw new Error('保存先に接続できません');};
 const retry={...noMatch,id:crypto.randomUUID()};assert.equal((await call(retry)).status,400);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM missing_reports WHERE id=?').get(retry.id).n,0);globalThis.__env.DB.batch=batch;
 assert.equal((await call(retry)).status,200);
 globalThis.__cookie='a'.repeat(64);data=await (await api.GET(new Request('https://arika.test/api/workspace?space='+space))).json();assert.ok(data.reports.some(r=>r.id===base.id));assert.equal(data.reports[0].user,undefined);assert.ok(data.reportPendingCount>=3);
 assert.equal((await call({action:'resolveReports',space,ids:[base.id]})).status,200);assert.ok(sql.prepare('SELECT resolved_at FROM missing_reports WHERE id=?').get(base.id).resolved_at);
 // A newly arriving report must remain pending when an earlier group is resolved.
 assert.equal((await call({...base,id:crypto.randomUUID()})).status,200);
 assert.equal((await call({action:'resolveReports',space,ids:[base.id]})).data.resolved,0);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM missing_reports WHERE capture=? AND resolved_at='' ").get(capture).n,1);
 await call({action:'deleteFrame',space,capture,image:frames[0].id});globalThis.__cookie=invite;
 assert.equal((await call({...base,id:crypto.randomUUID()})).status,400);
 // Retrying a delivered report remains successful even if evidence was later deleted.
 assert.equal((await call(base)).status,200);
 globalThis.__cookie='a'.repeat(64);await call({action:'delete',space,capture});
 assert.equal(sql.prepare('SELECT label FROM missing_reports WHERE id=?').get(base.id).label,'報告対象の棚');
});

test('Admin link requires allowed signed-in identity for login, reads, edits and images',async()=>{
 const original=globalThis.__auth,token=globalThis.__env.ADMIN_TOKEN;
 try{
  for(const auth of [null,{id:'intruder',email:'intruder@example.test'},{id:'',email:'owner@example.test'}]){
   globalThis.__auth=auth;globalThis.__cookie=token;
   assert.equal((await call({action:'login',token})).status,403);
   assert.equal((await api.GET(new Request('https://arika.test/api/workspace'))).status,403);
   assert.equal((await call({action:'settings',space:'shared-space',name:'侵入',budgetLimit:0})).status,403);
   assert.equal((await image.GET(new Request('https://arika.test/api/image?id=shared-space/x/y'))).status,403);
  }
  globalThis.__auth=null;const invite=sql.prepare("SELECT invite FROM spaces WHERE id='shared-space'").get().invite;
  assert.equal((await call({action:'login',token:invite})).status,200);globalThis.__cookie=invite;
  assert.equal((await api.GET(new Request('https://arika.test/api/workspace'))).status,200);
  const saved=globalThis.__env.ADMIN_EMAILS;delete globalThis.__env.ADMIN_EMAILS;
  globalThis.__auth=original;assert.equal((await call({action:'login',token})).status,403);globalThis.__env.ADMIN_EMAILS=saved;
 }finally{globalThis.__auth=original;globalThis.__cookie=token;}
});

test('Legacy key migrates without overwriting, survives management token rotation, and fails closed with wrong key',async()=>{
 const oldToken=globalThis.__env.ADMIN_TOKEN,oldSecret=globalThis.__env.API_ENCRYPTION_KEY;
 const stored=sql.prepare("SELECT value FROM config WHERE key='api_key'").get().value;
 try{
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(oldToken)),'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12)),value='sk-'+ 'migration'.repeat(8);
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
  sql.prepare("UPDATE config SET value=? WHERE key='api_key'").run(JSON.stringify({iv:[...iv],data:[...new Uint8Array(data)]}));
  globalThis.__cookie=oldToken;
  let response=await api.GET(new Request('https://arika.test/api/workspace'));assert.equal(response.status,200);assert.equal((await response.json()).aiReady,true);
  const migrated=sql.prepare("SELECT value FROM config WHERE key='api_key'").get().value;assert.equal(JSON.parse(migrated).version,2);assert.equal(migrated.includes(value),false);
  globalThis.__env.ADMIN_TOKEN='b'.repeat(64);globalThis.__cookie=oldToken;
  assert.equal((await api.GET(new Request('https://arika.test/api/workspace'))).status,400);
  globalThis.__cookie=globalThis.__env.ADMIN_TOKEN;
  response=await api.GET(new Request('https://arika.test/api/workspace'));assert.equal(response.status,200);assert.equal((await response.json()).aiReady,true);
  assert.equal(sql.prepare("SELECT value FROM config WHERE key='api_key'").get().value,migrated);
  globalThis.__env.API_ENCRYPTION_KEY='f'.repeat(64);assert.equal((await api.GET(new Request('https://arika.test/api/workspace'))).status,503);
  assert.equal(sql.prepare("SELECT value FROM config WHERE key='api_key'").get().value,migrated);
 }finally{globalThis.__env.ADMIN_TOKEN=oldToken;globalThis.__env.API_ENCRYPTION_KEY=oldSecret;globalThis.__cookie=oldToken;sql.prepare("UPDATE config SET value=? WHERE key='api_key'").run(stored);}
});

test('AI rate limits and concurrency reject before paid calls; expiry restores access',async()=>{
 const realFetch=globalThis.fetch,oldCookie=globalThis.__cookie;let calls=0,finish;
 const saved=await call({action:'save',space:'shared-space',label:'rate-test',frames:[{data:'data:image/jpeg;base64,/9j/2Q==',time:0}]});
 const invite=sql.prepare("SELECT invite FROM spaces WHERE id='shared-space'").get().invite;
 const oldLimit=sql.prepare("SELECT value FROM config WHERE key='budget_limit'").get();
 sql.prepare("INSERT INTO config(key,value) VALUES('budget_limit','4.5') ON CONFLICT(key) DO UPDATE SET value='4.5'").run();
 sql.prepare("DELETE FROM ledger WHERE id='test-budget'").run();globalThis.__cookie=invite;
 const answer=()=>Response.json({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"objects":[]}'}}]});
 try{
  globalThis.fetch=async()=>{calls++;await new Promise(resolve=>finish=resolve);return answer();};
  const pending=call({action:'analyze',space:'shared-space',capture:saved.data.id,query:'マイク'});
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  const blocked=await call({action:'analyze',space:'shared-space',capture:saved.data.id,query:'マイク'});assert.equal(blocked.status,429);assert.equal(calls,1);
  finish();assert.equal((await pending).status,200);
  globalThis.fetch=async()=>{calls++;return answer();};
  assert.equal((await call({action:'analyze',space:'shared-space',capture:saved.data.id,query:'マイク'})).status,200);
  assert.equal((await call({action:'analyze',space:'shared-space',capture:saved.data.id,query:'マイク'})).status,429);assert.equal(calls,2);
  sql.prepare('UPDATE rate_limits SET window_start=0').run();
  assert.equal((await call({action:'analyze',space:'shared-space',capture:saved.data.id,query:'マイク'})).status,200);assert.equal(calls,3);
  sql.exec('DELETE FROM rate_limits');sql.prepare("INSERT INTO ai_locks(space,token,expires) VALUES('shared-space','expired',0)").run();
  assert.equal((await call({action:'analyze',space:'shared-space',capture:saved.data.id,query:'マイク'})).status,200);assert.equal(calls,4);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM ai_locks').get().n,0);
 }finally{globalThis.fetch=realFetch;globalThis.__cookie=oldCookie;if(oldLimit)sql.prepare("UPDATE config SET value=? WHERE key='budget_limit'").run(oldLimit.value);}
});

test('Writes reject missing or foreign origin before authentication',async()=>{
 for(const origin of [null,'https://evil.test']){
  const headers={'Content-Type':'application/json'};if(origin)headers.Origin=origin;
  const r=await api.POST(new Request('https://arika.test/api/workspace',{method:'POST',headers,body:JSON.stringify({action:'login',token:globalThis.__env.ADMIN_TOKEN})}));
  assert.equal(r.status,403);
 }
});

test('Browser identifiers are signed, forged identifiers share fallback limits, and streaming bodies are bounded',async()=>{
 const original=globalThis.__client;
 try{
  globalThis.__client=await security.issueClient();const first=await security.rateActor('viewer:shared-space');
  globalThis.__client=await security.issueClient();assert.notEqual(await security.rateActor('viewer:shared-space'),first);
  globalThis.__client='';const legacy=await security.rateActor('viewer:shared-space');
  globalThis.__client=crypto.randomUUID()+'.'+'a'.repeat(64);assert.equal(await security.rateActor('viewer:shared-space'),legacy);
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('12345'));c.enqueue(new TextEncoder().encode('67890'));c.close();}});
  await assert.rejects(security.boundedBody(new Request('https://arika.test/',{method:'POST',body:stream,duplex:'half'}),8),e=>e.status===413);
  assert.equal(await security.boundedBody(new Request('https://arika.test/',{method:'POST',body:'あいう'}),9),'あいう');
 }finally{globalThis.__client=original;}
});
