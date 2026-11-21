'use strict';

// Only use the value-level path when every directive can be understood.
// Conditions, narrative redactions and unrelated fields retain the general model path.
const policyTerms = [
  ['price', /(?:对外|对客户|给客户|客户)?(?:给出)?的?(?:报价|开价|价钱)(?:区间|金额|数值)?/gy],
  ['delay', /(?:验收|交付|交货|项目|排期)?(?:延期|延误|延后|推迟|推后|顺延|延迟|拖期)(?:了)?(?:的)?(?:多久|多少天|天数|时间|时长|周期)?/gy],
  ['cost', /(?:采购|核算|内部)?成本|材料费/gy],
  ['other', /预算|(?:员工|个人|差旅)?垫付(?:款|金|的金额)?/gy],
  ['duration', /(?:正常|原定|计划|测试)?(?:工期|耗时|用时)/gy]
];
const verbs = /不要隐去|不要隐藏|不要遮盖|不隐去|不隐藏|不遮盖|维持原文|照原样写|原样保留|保持原样|原样写|保留|隐去|隐藏|遮盖|遮住|遮掉|隐掉|遮蔽|遮/g;
function parseFields(policy){
  const directives=new Map();
  let exclusive=false;
  const clauses=policy.split(/[，,。；;！!\n]|(?:、|并且|并|同时)(?=(?:请|只|仅)?(?:保留|隐去|隐藏|遮盖|遮住|遮掉|维持原文))/u);
  for(const part of clauses.map(s=>s.trim()).filter(Boolean)){
    if(/^(?:其余|其他|其它)(?:全部|都)?(?:保留|原样保留|维持原文)$/.test(part)){exclusive=true;continue;}
    const actions=[...part.matchAll(verbs)];
    if(actions.length!==1)return null;
    const action=actions[0][0];
    const mask=/^(?:隐去|隐藏|遮盖|遮住|遮掉|隐掉|遮蔽|遮)$/.test(action);
    let rest=part.slice(0,actions[0].index)+part.slice(actions[0].index+action.length);
    if(/(?:只|仅)/.test(rest)){
      if(!mask)return null;
      exclusive=true;
    }
    rest=rest.replace(/(?:另外|额外|请|把|将|只|仅|都|原样|照常|全部|[ \t])/gu,'');
    const targets=rest.split(/(?:以及|和|与|及|、)/u);
    for(const target of targets){
      const pair=policyTerms.find(([,rx])=>{
        rx.lastIndex=0;const hit=rx.exec(target);return hit&&hit[0]===target;
      });
      if(!pair)return null;
      const role=pair[0];
      if(mask&&role!=='price'&&role!=='delay')return null;
      if(directives.has(role)&&directives.get(role).mask!==mask)return null;
      directives.set(role,{mask,basis:part});
    }
  }
  if(![...directives.values()].some(d=>d.mask))return null;
  return {directives,exclusive};
}

const number='(?:\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万亿点壹贰叁肆伍陆柒捌玖拾佰仟萬億]+|半)';
const gap='[ \\t]*',range=gap+'(?:到|至|[-–—~～])'+gap;
const prefix='(?:人民币|港元|港币|美元|欧元|英镑|日元|RMB|CNY|USD|EUR|HKD|[¥￥$€£])';
const moneyUnit='(?:[十百千万亿萬億]'+gap+')?(?:元人民币|人民币|元整(?!理|改|合|顿|备)|美元|美金|港元|欧元|英镑|日元|元|块钱|USD|CNY|RMB|EUR|HKD)';
const timeUnit='(?:个?'+gap+'(?:半月|工作日|自然日|日历日|星期|礼拜|月|季度|小时|钟头)|天|周|日)';
// At least one endpoint must carry a currency or duration unit.
function valuePattern(unit,lead=''){
  const numberWithPrefix=lead?'(?:'+lead+gap+')?'+number:number;
  const qualified=numberWithPrefix+gap+unit+(lead?'':'(?:半)?');
  const bare=lead?lead+gap+number+'(?:'+gap+'[千萬万亿億kK])?':number;
  const single=lead?'(?:'+qualified+'|'+bare+')':qualified;
  return new RegExp('(?:'+single+'|'+numberWithPrefix+')'+range+single+'|'+single,'giu');
}
const tokens={money:valuePattern(moneyUnit,prefix),time:valuePattern(timeUnit)};
const compactMoney=new RegExp(number+gap+'(?:[千萬万亿億]|[kKwW](?![a-zA-Z]))','gu');
const numericCell=new RegExp('^'+number+'(?:'+range+number+')?$','u');
const bareField=new RegExp('(报价(?:金额)?|采购成本|预算|延期天数|延误天数)'+gap+'(?:[（(][^()（）\\n]{1,8}[)）])?'+gap+'[=:：＝]'+gap+'('+number+'(?:'+range+number+')?)'+gap+'(?=$|[，,。；;|｜\\t\\n])','gu');
const calendar=/\d{1,4}\s*(?:年\s*\d{1,2}\s*)?月\s*\d{1,2}\s*[日号]?|(?:延[期后]至|推迟到|顺延至|下月|本月)\s*\d{1,2}\s*[日号]/gu;
const moneyRole=/对外(?:报(?:价|了)?|给价)|报给|报了|报多少|报价|开价|要价|售价|对客价|客户价|(?:客户|买方|采购方)的(?:总价|最终价)|成本|预算|支出|利润|回款|采购价|进价|余额|(?:代垫|先垫|垫付)[款金]?|垫款|尾款|货款余额|运输费|运费|押金|保证金|预[收付](?:款|金)?|材料费|物料(?:费|款|那边)|报销[款额]?/gu;
const delayWord=/延期|延误|延迟|延后|推迟|推后|顺延|拖期|滞后|推延|晚点|往后挪|晚/u;
const durationWord=/耗时|用时|用去|用掉|工期|历时|持续|培训|试运行|停用|停机|提前|各用|各需|原需|仍需|原定用时|预留|(?:更换|检修|测试|联调|排查|复核|演练|备货)(?:原本|正常|通常|预计|还)?(?:排了?|占用?|需要?|得用|要|用)/u;
const timeRole=new RegExp(delayWord.source+'|'+durationWord.source,'gu');
function roleOf(text,family){
  const all=[...text.matchAll(family==='money'?moneyRole:timeRole)];
  if(!all.length)return null;
  const match=all.at(-1);
  if(text.length-match.index-match[0].length>14)return null;
  const name=match[0];
  if(family==='money')return /成本|采购价|进价|材料费|物料/.test(name)?'cost':/预算|支出|利润|回款|余额|垫|尾款|运输费|运费|押金|保证金|报销|预收|预付/.test(name)?'other':'price';
  return durationWord.test(name)?'duration':'delay';
}
function contextRole(line,offset,length,family,header){
  const left=line.slice(0,offset).split(/[，,；;。！？|｜\t]/u).at(-1);
  const role=roleOf(left,family);
  if(role)return role;
  const right=line.slice(offset+length).split(/[，,；;。！？|｜\t]/u)[0];
  if(/^(?:的|为|是|属于|系|用于|才是)/.test(right)){
    const rightRole=roleOf(right.slice(0,12),family);
    if(rightRole)return rightRole;
  }
  return header?roleOf(header,family):null;
}
function values(sources){
  const found=[];
  for(const [part,text] of Object.entries(sources)){
    let start=0,headers=null,previous='';
    for(const line of text.split('\n')){
      const cells=line.split(/[|｜\t]/u);
      const dates=[...line.matchAll(calendar)];
      const rowValues=[];
      function add(family,index,value,role,header){
        const left=start+index,right=left+value.length;
        const before=line.slice(0,index).split(/[，；;。！？|｜\t]/u).at(-1);
        const after=line.slice(index+value.length).split(/[，；;。！？|｜\t]/u)[0];
        rowValues.push({part,family,role,start:left,end:right,value,
          context:before.slice(-96)+'〔'+value+'〕'+after.slice(0,72),header});
      }
      for(const [family,re] of [...Object.entries(tokens),['money',compactMoney]]){
        for(const hit of line.matchAll(re)){
          const end=hit.index+hit[0].length;
          if(family==='time'&&dates.some(d=>d.index<end&&hit.index<d.index+d[0].length))continue;
          if(family==='money'&&/^[十百千万億亿萬]?\s*(?:元|元人民币)$/.test(hit[0])&&/[（([]\s*$/.test(line.slice(0,hit.index)))continue;
          if(rowValues.some(v=>v.start<start+end&&start+hit.index<v.end))continue;
          const column=line.slice(0,hit.index).split(/[|｜\t]/u).length-1;
          const header=headers&&cells.length===headers.length?headers[column]:null;
          let role=contextRole(line,hit.index,hit[0].length,family,header);
          if(!role&&/(?:问|[？?]|多少|多久)/u.test(previous)&&/^\s*(?:(?:[Aa答]|回答|回复|答复|预计)[：:\s]*)?$/u.test(line.slice(0,hit.index))){
            role=roleOf(previous,family);
          }
          if(re===compactMoney&&(!role||/^(?:天|日|周|件|台|套|人|小时)/.test(line.slice(end).trimStart())))continue;
          add(family,hit.index,hit[0],role,header);
        }
      }
      if(headers&&headers.length===cells.length){
        let index=0;
        for(const [col,cell] of cells.entries()){
          const value=cell.trim(),at=index+cell.indexOf(value),header=headers[col];
          const family=roleOf(header,'money')?'money':roleOf(header,'time')?'time':null;
          if(family&&numericCell.test(value)&&!rowValues.some(v=>v.start<=start+at&&v.end>=start+at+value.length)){
            add(family,at,value,roleOf(header,family),header);
          }
          index+=cell.length+1;
        }
      }
      for(const m of line.matchAll(bareField)){
        const index=m.index+m[0].lastIndexOf(m[2]),left=start+index;
        if(rowValues.some(v=>v.start<left+m[2].length&&left<v.end))continue;
        const family=/天数$/.test(m[1])?'time':'money';
        add(family,index,m[2],roleOf(m[1],family),null);
      }
      found.push(...rowValues);
      if(cells.length<2)headers=null;
      else if(!rowValues.length&&cells.some(c=>roleOf(c,'money')||roleOf(c,'time')))headers=cells;
      previous=line;start+=line.length+1;
    }
  }
  return found;
}
async function fieldMatches(sources,rows,spec,policy,generate,progress){
  const candidates=values(sources);
  for(const c of candidates){
    if(c.family!=='money'||(!spec.directives.has('budget')&&!spec.directives.has('lodging')))continue;
    const label=c.context.split('〔')[0];
    const named=/(预算|住宿费)(?:用|金额)?(?:总计|合计|共计|为|是|共|约|[:：])?\s*$/u.exec(label)
      ||/^(预算|住宿费)(?:用|金额)?$/u.exec(c.header||'');
    if(named)c.role=named[1]==='预算'?'budget':'lodging';
  }
  // Keep explicit declarations and user vocabulary authoritative. Model-only
  // entity guesses can be superseded by a value with clear field semantics.
  const guesses=new Map();
  for(const r of rows.filter(r=>r.origin==='本地模型'||r.origin==='提示词人名补查')){
    const context=sources[r.part].slice(Math.max(0,r.start-18),r.start);
    if(/(?:代号|项目名(?:称)?|简称|全称|名为|叫作|称作)[为是：:“「"\s]*$/u.test(context))continue;
    guesses.set(r.part+':'+r.start+':'+r.end,r);
    const calendarValue=new RegExp('^(?:'+calendar.source+')$','u').test(r.value);
    const following=sources[r.part].slice(r.end,r.end+35);
    const fieldLabel=/^(?:本次|对外|对客|采购|预计|员工|正常|计划|测试)?(?:报价|开价|要价|售价|(?:代垫|先垫|垫付)[款金]?|垫款|尾款|货款余额|运输费|运费|押金|保证金|成本|工期|耗时|用时|交付|交货|验收|出货|上线)$/u.test(r.value);
    const usedAsLabel=(fieldLabel&&(/^\s*(?:$|[|｜（(：:＝=¥￥€$]|\d|[一二三四五六七八九十])/.test(following)||/^(?:将|要|未|已|仍|预计|暂定)?(?:延期|顺延|推迟|延后|推后|如期)/u.test(following)||
      following.startsWith('\n')))||(/^对[客外]$/u.test(r.value)&&/^报价/u.test(following));
    if((calendarValue&&/(?:延[期后]至|顺延至|推迟到|定于|交付日期[：:])\s*$/.test(context))||
       ((usedAsLabel||/^(客户|报价|成本|工期|延期)$/.test(r.value))&&!r.owner)){
      r.suggest=false;r.uncertain=true;
    }
  }
  const unclear=candidates.filter(c=>!c.role);
  for(let i=0;i<unclear.length;i+=12){
    progress('本地模型正在核对金额和时长在本句中的用途…');
    const batch=unclear.slice(i,i+12),data={},properties={};
    batch.forEach((c,j)=>{
      data[j+1]={来源:c.part==='prompt'?'写作提示词':'正文',原句:c.context,表头:c.header};
      properties[j+1]={type:'string',enum:c.family==='time'?['延期','一般时长','不确定']:['客户报价','采购成本','其他金额','不确定']};
    });
    const raw=await generate('逐项判断〔〕里这个数值在本处的业务用途。延期是比原计划延后，正常用时或提前属于一般时长。对客户的销售价格才属于客户报价，垫付款、材料费或财务往来按其自身用途判断。独立阅读每一处；证据不足选“不确定”。',JSON.stringify({位置:data}),{type:'object',properties,required:Object.keys(properties),additionalProperties:false});
    for(const [j,c] of batch.entries())c.role=({'延期':'delay','一般时长':'duration','客户报价':'price','采购成本':'cost','其他金额':'other'})[raw[j+1]]||'unknown';
  }
  const matches=[];
  const targeted=new Set(candidates.filter(c=>spec.directives.get(c.role)?.mask).map(c=>c.value));
  // Remove wider entity guesses for an action plus a measured value (e.g.
  // “测试排三日”). Never demote a named project or a dictionary entry by overlap alone.
  const endingAt=new Map(candidates.map(c=>[c.part+':'+c.end,c]));
  // A model can extract only the digits from a complete currency or duration.
  // Ground containment in source offsets so an identical project ID elsewhere
  // retains its own decision.
  const valueEnds={};
  for(const [part,source] of Object.entries(sources))valueEnds[part]=new Uint32Array(source.length);
  for(const c of candidates)valueEnds[c.part].fill(c.end,c.start,c.end);
  for(const r of guesses.values()){
    if(valueEnds[r.part][r.start]>=r.end){
      r.suggest=false;
      continue;
    }
    const contained=endingAt.get(r.part+':'+r.end);
    if(!contained||contained.start<=r.start)continue;
    const lead=r.value.slice(0,contained.start-r.start);
    if(/^(?:签收|测试|验收|交付|交货|联调|复核|排查|上线)?(?:比原定|比约定)?(?:晚了?|顺延|延期|推迟|排了?|占用?|需要?|耗时|用时)$/u.test(lead)){
      r.suggest=false;r.uncertain=true;
    }
  }
  for(const c of candidates){
    const guess=guesses.get(c.part+':'+c.start+':'+c.end);
    if(guess){
      Object.assign(guess,{suggest:false,type:c.family==='time'?'时间':'金额',role:'',owner:'',ambiguous:false,origin:'原文数值核对'});
    }
    const directive=spec.directives.get(c.role);
    const fallback=spec.directives.get(c.family==='time'?'delay':'price');
    const uncertain=c.role==='unknown'&&fallback?.mask;
    if(!directive&&!uncertain&&!targeted.has(c.value))continue;
    matches.push({part:c.part,start:c.start,end:c.end,value:c.value,type:c.family==='time'?'时间':'金额',
      suggest:directive?.mask??false,basis:(directive||fallback)?.basis||policy,uncertain:!!uncertain});
  }
  return matches;
}
module.exports={parseFields,fieldMatches,values};
