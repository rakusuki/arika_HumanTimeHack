import {database,textValue,type Frame} from './server';

export async function listMissingReports(space:string){
 const d=database();
 const reports=(await d.prepare("SELECT id,query,query_key,kind,capture,label,captured_at,image,note,created,resolved_at FROM missing_reports WHERE space=? ORDER BY CASE WHEN resolved_at='' THEN 0 ELSE 1 END,created DESC LIMIT 200").bind(space).all()).results;
 const pending=await d.prepare("SELECT COUNT(*) AS n FROM missing_reports WHERE space=? AND resolved_at=''").bind(space).first<{n:number}>();
 return {reports,reportPendingCount:pending?.n||0};
}

export async function submitMissingReport(space:string,user:string,b:any){
 const id=textValue(b.id,80),query=textValue(b.query,180),kind=b.kind;
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(id)||!query||!['no_match','physical_missing'].includes(kind))throw new Error('検索内容と見つからなかった状況を確認してください。');
 const capture=textValue(b.capture,80),image=textValue(b.image,240),note=textValue(b.note,500),d=database();
 const queryKey=query.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
 const previous=await d.prepare('SELECT query_key,kind,capture,image FROM missing_reports WHERE space=? AND id=?').bind(space,id).first<any>();
 if(previous){
  if(previous.query_key!==queryKey||previous.kind!==kind||previous.capture!==capture||previous.image!==image)throw new Error('この検索の報告は送信済みです。新しく検索してから報告してください。');
  return {ok:true,reported:true};
 }
 const c=capture?await d.prepare('SELECT label,created,frames FROM captures WHERE id=? AND space=?').bind(capture,space).first<any>():null;
 if(capture&&!c)throw new Error('対象の記録が削除・変更されています。もう一度検索してから報告してください。');
 if(kind==='physical_missing'&&(!c||!image))throw new Error('実際に確認した候補の画像を選んでください。');
 if(image&&(!c||!JSON.parse(c.frames).some((f:Frame)=>f.id===image)))throw new Error('対象の画像が変更されています。もう一度検索してから報告してください。');
 const now=new Date().toISOString(),seconds=typeof b.seconds==='number'&&Number.isFinite(b.seconds)?Math.min(86400,Math.max(0,b.seconds)):0;
 await d.batch([
  d.prepare('INSERT OR IGNORE INTO missing_reports(id,space,user,query,query_key,kind,capture,label,captured_at,image,note,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,space,user,query,queryKey,kind,capture,c?.label||'',c?.created||'',image,note,now),
  d.prepare('INSERT OR IGNORE INTO feedback(id,space,user,found,intent,seconds,created) VALUES(?,?,?,?,?,?,?)').bind('missing:'+space+':'+id,space,user,0,textValue(b.intent,160),seconds,now)
 ]);
 return {ok:true,reported:true};
}

export async function resolveMissingReports(space:string,ids:unknown){
 if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(id)))throw new Error('対応する報告を選んでください。');
 const d=database(),now=new Date().toISOString(),statements=[];
 for(let start=0;start<ids.length;start+=80){const chunk=ids.slice(start,start+80);statements.push(d.prepare(`UPDATE missing_reports SET resolved_at=? WHERE space=? AND resolved_at='' AND id IN (${chunk.map(()=>'?').join(',')})`).bind(now,space,...chunk));}
 const results=await d.batch(statements);
 return {ok:true,resolved:results.reduce((n,r)=>n+Number(r.meta.changes),0)};
}
