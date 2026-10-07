'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';

export type MissingReport={id:string;query:string;query_key:string;kind:string;capture:string;label:string;captured_at:string;image:string;note:string;created:string;resolved_at:string};
export type SearchContext={id:string;query:string;capture:string;label:string;created:string};
const date=(s:string)=>new Date(s).toLocaleString('ja-JP');
export function MissingReportDialog({context,results,open,onClose,onSubmit}:{context:SearchContext;results:any[];open:boolean;onClose:()=>void;onSubmit:(payload:any)=>Promise<void>}){
 const [kind,setKind]=useState(results.length?'physical_missing':'no_match'),[candidate,setCandidate]=useState(results.length===1?'0':''),[note,setNote]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),hit=kind==='physical_missing'&&candidate!==''?results[Number(candidate)]:null;
 async function submit(){if(lock.current)return;lock.current=true;setSending(true);setError('');try{await onSubmit({id:context.id,query:context.query,kind,capture:hit?.capture||context.capture,image:hit?.image||'',note});onClose();}catch(e){setError(e instanceof Error?e.message:'報告を送信できませんでした。再試行してください。');}finally{lock.current=false;setSending(false);}}
 return <Dialog open={open} onOpenChange={value=>{if(!value&&!sending)onClose();}}><DialogContent className="missing-dialog"><DialogTitle>見つからなかったことを管理者に報告</DialogTitle><DialogDescription>検索内容と確認した記録を管理画面へ送ります。管理者が記録や置き場所を確認する手がかりになります。</DialogDescription>
 <p className="report-query">検索語：「{context.query}」</p>
 <label>どの段階で見つかりませんでしたか？<Select value={kind} onValueChange={setKind} disabled={sending}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="no_match">検索結果に目的のモノが出なかった</SelectItem>{results.length>0&&<SelectItem value="physical_missing">表示された場所で実物が見つからなかった</SelectItem>}</SelectContent></Select></label>
 {kind==='physical_missing'?<label>実際に確認した候補<Select value={candidate} onValueChange={setCandidate} disabled={sending}><SelectTrigger><SelectValue placeholder="確認した候補を1件選択"/></SelectTrigger><SelectContent>{results.map((r,i)=><SelectItem key={i} value={String(i)}>{r.name} · {r.label} · {date(r.created)} · 画像{r.frame+1}</SelectItem>)}</SelectContent></Select></label>:<p>検索対象：{context.capture?`記録「${context.label}」（${date(context.created)}撮影）`:'共有スペース内の全記録'}<br/><span className="subtle">実際の場所にモノがない、という報告にはなりません。</span></p>}
 {hit&&<div><p>{hit.label} · {date(hit.created)}撮影</p><img className="report-evidence" src={'/api/image?id='+encodeURIComponent(hit.image)} alt="実際に確認した候補の根拠画像"/></div>}
 <label>補足（任意）<Input value={note} maxLength={500} disabled={sending} onChange={e=>setNote(e.target.value)} placeholder="例：棚の上と引き出しを確認しました"/></label>
 <p>管理画面内に通知します。個別返信・対応完了の通知はありません。報告後も続けて検索できます。</p>
 {error&&<p role="alert" className="message error">{error}</p>}
 <div className="report-actions"><Button variant="outline" disabled={sending} onClick={onClose}>戻る</Button><Button disabled={sending||kind==='physical_missing'&&!hit} onClick={submit}>{sending?'報告を送信中…':'管理者に報告する'}</Button></div>
 </DialogContent></Dialog>;
}

export function ReportInbox({reports,pending,captures,busy,onOpen,onResolve,onRefresh}:{reports:MissingReport[];pending:number;captures:{id:string}[];busy:boolean;onOpen:(id:string)=>void;onResolve:(ids:string[])=>void;onRefresh:()=>void}){
 const [showResolved,setShowResolved]=useState(false);
 const groups=new Map<string,MissingReport[]>();
 for(const r of reports){if(!!r.resolved_at!==showResolved)continue;const key=JSON.stringify([r.query_key,r.capture,r.kind]);const group=groups.get(key)||[];group.push(r);groups.set(key,group);}
 return <section className="report-inbox"><div className="results-heading"><h2>見つからなかった報告</h2><Button variant="outline" onClick={onRefresh} disabled={busy}>更新</Button></div><p>未対応 {pending}件。同じ検索語・記録・状況の報告をまとめています。件数は人数ではありません。</p><p className="subtle">この画面を開いている間は30秒ごとに更新します。記録を修正・再撮影したら、対応済みにしてください。利用者への個別返信はありません。</p><div className="report-actions"><Button variant={showResolved?'outline':'default'} onClick={()=>setShowResolved(false)}>未対応</Button><Button variant={showResolved?'default':'outline'} onClick={()=>setShowResolved(true)}>対応済み</Button></div>
 {groups.size===0&&<p className="no-result">{showResolved?'表示できる対応済みの報告はありません。':'未対応の報告はありません。'}</p>}
 {[...groups.entries()].map(([key,group])=>{const r=group[0],exists=captures.some(c=>c.id===r.capture);return <article className="report-item" key={key}>
 <h3>「{r.query}」 {group.length}件</h3><p>{r.kind==='physical_missing'?`記録「${r.label}」に表示された場所で実物が見つからなかったとの連絡がありました。`:`${r.capture?`記録「${r.label}」`:'共有スペース内の全記録'}の検索結果に、目的のモノが出なかったとの連絡がありました。`}</p>
 {r.capture&&<p>報告時の記録：{r.label} · {date(r.captured_at)}撮影{!exists?'（現在は削除済み）':''}</p>}<p className="subtle">最新の報告：{date(r.created)}{showResolved?` ／ 対応済み：${date(r.resolved_at)}`:''}</p>
 <details><summary>報告の補足・画像を確認（{group.length}件）</summary>{group.map(item=><div className="report-detail" key={item.id}><p>{date(item.created)}：{item.note||'補足なし'}</p>{item.image&&exists&&<img className="report-evidence" src={'/api/image?id='+encodeURIComponent(item.image)} alt="報告対象の候補画像（削除済みの場合は表示できません）" loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>}</div>)}</details>
 <div className="report-actions"><Button variant="outline" disabled={busy} onClick={()=>onOpen(exists?r.capture:'')}>{exists?'該当記録を確認・修正':'記録一覧・再撮影へ'}</Button>{!showResolved&&<Button disabled={busy} onClick={()=>onResolve(group.map(x=>x.id))}>この{group.length}件を対応済みにする</Button>}</div>
 </article>})}
 {reports.length>=200&&<p className="subtle">未対応を優先して最大200件を表示しています。対応済みにすると、残りの報告を確認できます。</p>}
 </section>;
}
