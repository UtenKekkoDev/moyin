'use strict';

function makeSnapshot(review, draft, id, name){
  const mapping=new Map(), visible=new Set(draft.match(/【[^【】\r\n]+】/gu)||[]);
  for(const {replacement,value} of review.output().trace){
    if(!visible.has(replacement))continue;
    if(!mapping.has(replacement))mapping.set(replacement,new Set());
    mapping.get(replacement).add(value);
  }
  const marker='〔墨隐稿号 '+id+'〕';
  return {id,name,draft,mapping,marker,payload:draft+'\n\n'+marker};
}

function resolveReturn(text,snapshots,selected){
  const pattern=/〔墨隐稿号 ([a-f0-9-]+)〕/giu;
  const ids=new Set(Array.from(text.matchAll(pattern),m=>m[1].toLowerCase()));
  const clean=text.replace(pattern,'');
  if(clean.includes('〔墨隐稿号')||ids.size>1)throw Error('稿号有改动或混入多版汇报，请核对返回稿。');
  const id=ids.size?[...ids][0]:selected;
  if(!id)throw Error('返回稿没有稿号，请先选择并核对所用的对外稿。');
  const snapshot=snapshots.get(id);
  if(!snapshot)throw Error('此稿号没有对应的本页代号表，请回到复制该版本的工作台。');
  if(ids.size&&selected&&id!==selected)throw Error('返回稿号与所选版本不同，请核对版本。');
  return {snapshot,text:text.endsWith('\n\n'+snapshot.marker)?clean.slice(0,-2):clean};
}

// Keep an exemption attached to its section and location. After edits in the
// section only a complete, unique, unchanged line can carry that exemption.
function sectionBounds(text,parts){
  const headers={prompt:'【写作要求】',body:'【项目材料】'};
  const lines=[...text.matchAll(/^(【写作要求】|【项目材料】)\n/gmu)];
  if(parts.length!==lines.length||parts.some((p,i)=>headers[p.part]!==lines[i][1]))return [];
  return parts.map((p,i)=>({part:p.part,start:lines[i].index+lines[i][0].length,
    end:i+1<lines.length?lines[i+1].index:text.length}));
}
function indexLines(text,start){
  const lines=new Map();
  for(const line of text.split('\n')){
    lines.set(line,lines.has(line)?-1:start);start+=line.length+1;
  }
  return lines;
}
function copyFindings(review,text){
  const base=review.output(), sections=text===base.draft?base.parts:sectionBounds(text,base.parts), allowed=[];
  for(const section of sections){
    const part=base.parts.find(p=>p.part===section.part);
    const original=base.draft.slice(part.start,part.end);
    const next=text.slice(section.start,section.end);
    const unchanged=next===original||next===original+'\n\n';
    const before=unchanged?null:indexLines(original,0);
    const after=unchanged?null:indexLines(next,section.start);
    for(const span of base.kept.filter(k=>k.start>=part.start&&k.end<=part.end)){
      const local=span.start-part.start;
      let offset=section.start+local;
      if(!unchanged){
        const lineStart=original.lastIndexOf('\n',local-1)+1;
        const nl=original.indexOf('\n',local),lineEnd=nl<0?original.length:nl;
        const line=original.slice(lineStart,lineEnd);
        if(span.end-part.start>lineEnd||before.get(line)!==lineStart||!(after.get(line)>=0))continue;
        offset=after.get(line)+local-lineStart;
      }
      allowed.push({start:offset,end:offset+span.end-span.start});
    }
  }
  const codes=new Set(base.trace.map(r=>r.replacement));
  for(const m of text.matchAll(/【[^【】\r\n]+】/gu)){
    if(codes.has(m[0]))allowed.push({start:m.index,end:m.index+m[0].length});
  }
  const coverage=new Uint32Array(text.length+1);
  for(const {start,end} of allowed)coverage[start]=Math.max(coverage[start],end);
  for(let i=1;i<coverage.length;i++)coverage[i]=Math.max(coverage[i],coverage[i-1]);
  const findings=[];
  const values=new Set(review.rows.filter(r=>r.decision==='mask').map(r=>r.value));
  for(const value of values){
    for(let pos=text.indexOf(value);pos!==-1;pos=text.indexOf(value,pos+1)){
      if(coverage[pos]>=pos+value.length)continue;
      const section=sections.find(s=>pos>=s.start&&pos<s.end);
      findings.push({start:pos,end:pos+value.length,value,part:section?.part||'draft'});
    }
  }
  findings.sort((a,b)=>a.start-b.start||b.end-a.end);
  let coveredUntil=-1;
  return findings.filter(issue=>{
    if(issue.end<=coveredUntil)return false;
    coveredUntil=issue.end;return true;
  });
}

function returnSpans(text,mapping){
  const types=new Set(['人员','客户','待核客户','项目','机构','敏感内容','编号','数量','金额','时间','地点','邮箱','电话']);
  for(const code of mapping.keys())types.add(code.slice(1,-1).replace(/[A-Z]+$/,''));
  const names=[...types].sort((a,b)=>b.length-a.length).join('|');
  const token=new RegExp('【[^【】\\r\\n]{1,45}】|[\\[［{（(]\\s*(?:'+names+')[^\\]\\r\\n）)}］]{1,15}[\\]］}）)]|(?:'+names+')\\s*[A-Z]{1,5}(?![A-Za-z0-9])','gu');
  const items=[];
  for(const m of text.matchAll(token)){
    if(m[0]==='【项目材料】'||m[0]==='【写作要求】')continue;
    items.push({start:m.index,end:m.index+m[0].length,token:m[0],options:[...(mapping.get(m[0])||[])],choice:null});
  }
  return items;
}
function restoreText(text,items){
  const pieces=[];let last=0;
  for(const item of items){
    pieces.push(text.slice(last,item.start),item.choice||item.token);last=item.end;
  }
  pieces.push(text.slice(last));return pieces.join('');
}
