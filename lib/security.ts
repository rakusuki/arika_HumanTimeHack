import {env} from 'cloudflare:workers';
import {headers,cookies} from 'next/headers';

export class SecurityError extends Error {
 constructor(message:string,public status=403,public retryAfter?:number){super(message);}
}
export function encryptionSecret(){
 const value=(env as unknown as Record<string,string>).API_ENCRYPTION_KEY||'';
 if(!/^[a-f0-9]{64,}$/i.test(value))throw new SecurityError('暗号化の設定を確認してください。',503);
 return value;
}
export async function requireAdministrator(){
 const h=await headers(),email=h.get('oai-authenticated-user-email')?.trim().toLowerCase();
 const allowed=((env as unknown as Record<string,string>).ADMIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 if(!email||!h.get('oai-authenticated-user-id')||!allowed.includes(email))
  throw new SecurityError('管理者のChatGPTアカウントでログインしてください。');
}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function signingKey(purpose:string){return crypto.subtle.importKey('raw',new TextEncoder().encode(purpose+':'+encryptionSecret()),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function issueClient(){
 const id=crypto.randomUUID();const signature=await crypto.subtle.sign('HMAC',await signingKey('client'),new TextEncoder().encode(id));
 return id+'.'+Array.from(new Uint8Array(signature)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function rateActor(user:string){
 if(user==='creator')return 'creator';
 const token=(await cookies()).get('arika_client')?.value||'';
 const [id,signature,extra]=token.split('.');
 if(!extra&&/^[a-f0-9-]{36}$/.test(id||'')&&/^[a-f0-9]{64}$/.test(signature||'')){
  const bytes=Uint8Array.from(signature.match(/../g)!,x=>parseInt(x,16));
  if(await crypto.subtle.verify('HMAC',await signingKey('client'),bytes,new TextEncoder().encode(id)))return await digest(user+':'+id);
 }
 // Old invitations stay valid. Without a signed browser ID they share one limit.
 return await digest(user+':legacy');
}

export async function boundedBody(request:Request,maximum:number){
 if(!request.body)return '';
 const reader=request.body.getReader(),decoder=new TextDecoder();let size=0,body='';
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new SecurityError('データが大きすぎます。画像数を減らしてください。',413);}body+=decoder.decode(value,{stream:true});}return body+decoder.decode();}finally{reader.releaseLock();}
}
