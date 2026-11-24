'use strict';
class Review {
  constructor(sources,items) {
    this.sources={...sources};
    this.rows=items.map(r=>({...r,decision:null}));
    this.codes=new Map();
    this.counts=new Map();
    this.next=Math.max(0,...items.map(r=>r.id))+1;
    this.refresh();
  }
  refresh() {
    this.rows.sort((a,b)=>a.part===b.part?a.start-b.start||b.end-a.end:(a.part==='prompt'?-1:1));
    for(const r of this.rows){
      if(!r.value||r.start<0||r.end>this.sources[r.part].length||this.sources[r.part].slice(r.start,r.end)!==r.value)throw Error('候选位置与原文不一致，请重新识别。');
    }
    for(const r of this.rows.filter(r=>r.role==='full'))this.code(r);
    for(const r of this.rows)if(!r.inventoryOnly)this.code(r);
  }
  code(r) {
    const type=r.role==='alias'&&r.ambiguous&&!r.owner?'待核客户':r.type;
    const key=JSON.stringify([type,r.role==='alias'&&r.owner?r.owner:r.value]);
    if(!this.codes.has(key)){
      let n=this.counts.get(type)||0, label;
      do{
        let suffix='';
        for(let v=++n;v;v=Math.floor((v-1)/26))suffix=String.fromCharCode(65+(v-1)%26)+suffix;
        label='【'+type+suffix+'】';
      }while(Object.values(this.sources).some(s=>s.includes(label)));
      this.counts.set(type,n);this.codes.set(key,label);
    }
    return this.codes.get(key);
  }
  fullNames(){return [...new Set(this.rows.flatMap(r=>r.role==='full'?[r.value]:(r.dictionaryOwners||[])))];}
  canGroupKeep(r){
    return r.scopeExcluded===true&&!r.suggest&&!r.ambiguous&&!r.uncertain&&!r.customerCheck&&r.origin!=='人工补标';
  }
  keepOutside(){
    for(const r of this.rows)if(r.decision===null&&this.canGroupKeep(r)){
      r.decision='keep';r.groupKept=true;
    }
  }
  undoOutside(){
    for(const r of this.rows)if(r.groupKept){r.decision=null;r.groupKept=false;}
  }
  bind(alias,name,id=null){
    if(name&&!this.fullNames().includes(name))throw Error('请选择材料中已识别的客户全称。');
    const selected=this.rows.filter(r=>r.role==='alias'&&r.value===alias&&(id===null||r.id===id));
    if(!selected.length)throw Error('没有找到简称。');
    if(id===null&&selected.some(r=>r.ambiguous))throw Error('多家客户共用此简称，请在各条记录上选择归属。');
    for(const r of selected){r.owner=name;r.decision=null;r.groupKept=false;}
  }
  add(part,start,end,label) {
    const value=this.sources[part].slice(start,end);
    if(!value.trim())throw Error('请先在原文中选中要补标的文字。');
    const role=label==='客户全称'?'full':label==='客户简称'?'alias':'';
    const type=role?'客户':label;
    const overlaps=r=>r.part===part&&r.end>start&&r.start<end;
    const exact=this.rows.find(r=>r.numericFamily&&r.part===part&&r.start===start&&r.end===end);
    // Keep other recognized spans visible when an employee redefines a boundary.
    for(const r of this.rows.filter(r=>r.numericFamily&&overlaps(r)&&r!==exact)){
      r.suggest=false;r.decision=null;r.groupKept=false;
    }
    this.rows=this.rows.filter(r=>!overlaps(r)||(r.numericFamily&&r!==exact));
    const row={part,start,end,value,role,type,origin:'人工补标',owner:'',ambiguous:false,suggest:true,decision:'mask',id:this.next++};
    if(exact)row.numericFamily=exact.numericFamily;
    this.rows.push(row);
    const available=this.fullNames();
    for(const r of this.rows)if(r.owner&&!available.includes(r.owner)){r.owner='';r.decision=null;r.groupKept=false;}
    this.refresh();return row;
  }
  output() {
    const sections=[],trace=[],kept=[],parts=[];
    let draftLength=0;
    for(const part of ['prompt','body']){
      const source=this.sources[part];if(!source)continue;
      const heading=part==='prompt'?'【写作要求】\n':'【项目材料】\n';
      const base=sections.length?this.sources.prompt.length+'【写作要求】\n'.length+2+heading.length:heading.length;
      let cursor=0,offset=draftLength+heading.length;
      const pieces=[heading],ranges=[],rows=this.rows.filter(r=>r.part===part);
      for(const r of rows){
        if((r.decision??(r.suggest?'mask':'keep'))!=='mask')continue;
        const last=ranges.at(-1);
        if(last&&last.end>r.start){
          if(r.end>last.end){
            last.end=r.end;last.value=source.slice(last.start,last.end);
            last.type='敏感内容';last.role='';
          }
        }else ranges.push({...r});
      }
      // Map explicitly kept spans only when the entire span survives masking.
      // A group decision cannot exempt a matching sensitive value at copy time.
      const retains=rows.filter(r=>r.decision==='keep'&&!r.groupKept);let retainIndex=0;
      function plain(end){
        while(retainIndex<retains.length&&retains[retainIndex].start<end){
          const r=retains[retainIndex++];
          if(r.start>=cursor&&r.end<=end)kept.push({start:offset+r.start-cursor,end:offset+r.end-cursor});
        }
        pieces.push(source.slice(cursor,end));offset+=end-cursor;
      }
      for(const r of ranges){
        const replacement=this.code(r);
        plain(r.start);pieces.push(replacement);
        trace.push({part,start:base+r.start,end:base+r.end,outputStart:offset,value:r.value,type:r.type,replacement});
        offset+=replacement.length;cursor=r.end;
      }
      plain(source.length);sections.push(pieces.join(''));
      parts.push({part,start:draftLength+heading.length,end:offset});
      draftLength=offset+2;
    }
    return {draft:sections.join('\n\n'),trace,kept,parts};
  }
}
