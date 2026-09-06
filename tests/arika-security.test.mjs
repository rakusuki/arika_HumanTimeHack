import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_clever_triton.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
const objects=new Map();globalThis.__cookie='';
const wrap=(query,args=[])=>({bind(...v){return wrap(query,v);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
globalThis.__env={ADMIN_TOKEN:'a'.repeat(64),DB:{prepare:wrap,async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}},BUCKET:{async put(k,v){objects.set(k,v);},async get(k){const b=objects.get(k);return b?{body:b,async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}}:null;},async delete(k){objects.delete(k);}}};
let api,image;
before(async()=>{mkdirSync('.sites-runtime/tests',{recursive:true});for(const [name,entry] of [['api','app/api/workspace/route.ts'],['image','app/api/image/route.ts']]){await build({entryPoints:[entry],outfile:`.sites-runtime/tests/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'runtime-stubs',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__env;':"export async function cookies(){return {get(){return globalThis.__cookie?{value:globalThis.__cookie}:undefined}}}"}));}}]});}api=await import('../.sites-runtime/tests/api.mjs');image=await import('../.sites-runtime/tests/image.mjs');});
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
test('AI usage charges and atomic budget ceiling, without real API spending',async()=>{
globalThis.__cookie='a'.repeat(64);let calls=0;const realFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({usage:{prompt_tokens:30000,completion_tokens:1000},choices:[{message:{content:JSON.stringify({objects:[{name:'マイク',description:'黒',location:'机上',frame:0,box:[.1,.2,.4,.5]}]})}}]});};
try{const saved=await call({action:'save',space:'shared-space',label:'会場',notes:'',frames:[{data:'data:image/jpeg;base64,/9j/2Q==',time:1}]});const id=saved.data.id;
const r=await call({action:'analyze',space:'shared-space',capture:id});assert.equal(r.status,200);assert.ok(Math.abs(r.data.cost-.0136)<1e-10);assert.equal(calls,1);
const old=sql.prepare('SELECT SUM(cost) AS n FROM ledger').get().n;sql.prepare('INSERT INTO ledger(id,space,kind,cost,status,created) VALUES(?,?,?,?,?,?)').run('test-budget','shared-space','test',4.46-old,'completed','now');
assert.equal((await call({action:'analyze',space:'shared-space',capture:id})).status,400);assert.equal(calls,1);
assert.ok(sql.prepare('SELECT SUM(cost) AS n FROM ledger').get().n<=4.5);
}finally{globalThis.fetch=realFetch;}
});
