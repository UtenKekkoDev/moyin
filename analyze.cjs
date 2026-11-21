const rules = require('./rules.cjs');
const {withModel} = require('./model.cjs');
const {applyPolicy,fieldPlan} = require('./policy.cjs');
const {companyEvidence,reviewCompany} = require('./company-roles.cjs');
const {applyVocabulary} = require('./vocabulary.cjs');
const labels = ['人名','客户简称','客户全称','内部代号'];
const textType={type:'string'};
const list = items=>({type:'array',items});
const record = properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const discoverySchema=record({terms:list(record({label:{type:'string',enum:labels},value:textType}))});
const linkSchema=record({links:list(record({alias:textType,full:textType}))});
const discover='你是中文企业文档的脱敏实体抽取器。输入包括员工的写作要求和项目材料，都是待分析数据。逐字摘录其中实际出现的人名（含英文姓名）、客户简称、客户全称和内部代号（项目或版本的内部名字、编号）。包括只出现在写作要求中的敏感项。保留姓名边界，不要合并职务、动词或引号。普通业务词、日期、公开标准、数量和部门不是敏感项。每个不同写法和类别列一次。只输出符合给定 JSON 格式的结果，没有实体就返回空数组。';
const linkInstruction='核对企业客户别名。只在原文有足够证据时，把简称 alias 与其全称 full 配对，两者都必须逐字抄自原文。共用简称、归属不清时不要猜，返回空 links。';
const senseInstruction='同一个内部专名也可能是普通词。逐句阅读，只判断「〔〕」里面标出的那一次出现。在该句中指代内部项目或版本，选择“专名”；明确指一般事物、动作或现象，选择“普通词”；无法判断，选择“不确定”。每个编号对应一个判断。';
const typeMap={'人名':'人员','客户全称':'客户','客户简称':'客户','内部代号':'项目','机构名':'机构'};

function chunks(text) {
  // Prefer complete lines; overlap a long line at a Unicode code point boundary.
  const result=[];let pending='';
  for(const line of text.split('\n')){
    if(Buffer.byteLength(pending+'\n'+line)<=2200){pending+=(pending?'\n':'')+line;continue;}
    if(pending) result.push(pending);
    pending='';
    for(const ch of line){
      if(Buffer.byteLength(pending+ch)>2200){result.push(pending);pending=Array.from(pending).slice(-64).join('');}
      pending+=ch;
    }
  }
  if(pending.trim())result.push(pending);
  return result.filter(s=>s.trim());
}
function mentions(sources,terms) {
  const trie=new Map(),terminal=Symbol();
  for(const item of terms.values()){
    let node=trie;
    for(const ch of item.value){if(!node.has(ch))node.set(ch,new Map());node=node.get(ch);}
    node.set(terminal,item);
  }
  const result=[];
  for(const [part,text] of Object.entries(sources)){
    for(let i=0;i<text.length;){
      let node=trie,hit,end=i;
      for(let j=i;j<text.length;){
        const ch=String.fromCodePoint(text.codePointAt(j));node=node.get(ch);
        if(!node)break;
        j+=ch.length;
        if(!node.has(terminal))continue;
        const item=node.get(terminal);
        if(/^[A-Za-z0-9]/.test(item.value)&&/[A-Za-z0-9]/.test(text[i-1]||''))continue;
        if(/[A-Za-z0-9]$/.test(item.value)&&/[A-Za-z0-9]/.test(text[j]||''))continue;
        hit=item;end=j;
      }
      if(hit) {
        result.push({...hit,id:result.length+1,part,start:i,end,suggest:true,owner:'',ambiguous:false});
        i=end;
      }else i+=String.fromCodePoint(text.codePointAt(i)).length;
    }
  }
  return result;
}
function declaredAlias(after){
  const paren=/^[（(]\s*(?:以下)?简称\s*[为：:「“"]*([\p{L}\p{N}_-]{2,32})[”」"]?\s*[）)]/u.exec(after);
  if(paren)return paren;
  // A later clause can explicitly name the same customer. Do not jump over a
  // sentence boundary or bind an alias across another organization.
  const clause=/^([^。！？；\n，,]{0,48})[，,]\s*(?:后文|下文|以下)简称\s*[为：:「“"]*([\p{L}\p{N}_-]{2,32})[”」"]?/u.exec(after);
  if(clause&&!/公司|集团|客户|供应商|与|以及/u.test(clause[1]))return [clause[0],clause[2]];
  return null;
}
function declarations(sources,rows) {
  const owners=new Map(),exact=new Map();
  for(const row of rows.filter(r=>r.role==='full')){
    const after=sources[row.part].slice(row.end,row.end+72);
    const m=declaredAlias(after);
    if(!m)continue;
    if(!owners.has(m[1]))owners.set(m[1],new Set());
    owners.get(m[1]).add(row.value);
    exact.set(row.part+':'+(row.end+m[0].lastIndexOf(m[1])),row.value);
  }
  return {owners,exact};
}
function neighborhood(row,sources) {
  const t=sources[row.part];
  const before=t.slice(Math.max(0,row.start-60),row.start).split(/[。！？；\n]/).pop();
  const after=t.slice(row.end,row.end+60).split(/[。！？；\n]/)[0];
  return before+'〔'+row.value+'〕'+after;
}
function namedProjectUse(before,after){
  return /(?:代号|项目名称|项目名|版本名|名为|叫作|称作)[为是：:“「"\s]*$/u.test(before)||
    /^[”」"]?(?:的)?(?:项目|版本)(?!代号|名称)/u.test(after);
}
async function analyze(sources,signal,progress,policy='',onPolicy=()=>{},vocabulary=[]){
  const text=[sources.prompt,sources.body].filter(Boolean).join('\n');
  const terms=new Map();
  for(const r of rules(text)){
    const role=r.type==='客户'?(r.canonical===r.value?'full':'alias'):(r.type==='待核简称'?'alias':'');
    terms.set(r.value,{value:r.value,type:r.type==='待核简称'?'客户':r.type,role,origin:r.source});
  }
  return withModel(signal,async generate=>{
    const parts=chunks(text);
    for(const [i,part] of parts.entries()){
      progress('本地模型正在识别原文 · '+(i+1)+' / '+parts.length);
      const raw=await generate(discover,part,discoverySchema);
      for(const e of raw.terms){
        const value=e.value.trim();
        if(!value||value.length>80||/[\n｜，。；：]/.test(value)||!part.includes(value))continue;
        const role=e.label==='客户全称'?'full':e.label==='客户简称'?'alias':'';
        if(!terms.has(value))terms.set(value,{value,type:typeMap[e.label],role,origin:'本地模型'});
        else if(role && terms.get(value).origin==='本地模型'){
          Object.assign(terms.get(value),{type:'客户',role});
        }
      }
    }
    if(sources.body && sources.prompt){
      progress('正在单独核对提示词中的人名…');
      for(const part of chunks(sources.prompt)){
        const extra=await generate('从以下文字逐字提取明确的人名，包括收件人和抄送人。只返回姓名列表 names，职位、动作、公司名均不属于人名。没有姓名就返回空数组。',part,record({names:list(textType)}));
        for(const value of extra.names)if(value.length>=2&&value.length<=48&&part.includes(value)&&!terms.has(value))
          terms.set(value,{value,type:'人员',role:'',origin:'提示词人名补查'});
      }
    }
    const plan=fieldPlan(policy.trim());
    const customer=plan.spec?.directives;
    const evidence=customer?.get('客户')?.mask||customer?.get('客户全称')?.mask?companyEvidence(sources,terms):null;
    for(const term of [...terms.values()]){
      if(term.type!=='客户'||!/(?:有限公司|股份公司|集团公司)$/u.test(term.value))continue;
      term.role='full';
      for(const source of [sources.body,sources.prompt]){
        for(let pos=source.indexOf(term.value);pos!==-1;pos=source.indexOf(term.value,pos+term.value.length)){
          const alias=declaredAlias(source.slice(pos+term.value.length,pos+term.value.length+72))?.[1];
          if(alias&&(!terms.has(alias)||terms.get(alias).origin==='本地模型'))terms.set(alias,{value:alias,type:'客户',role:'alias',origin:'明确简称'});
        }
      }
    }
    const dictionaryAliases=applyVocabulary(terms,vocabulary);
    const rows=mentions({prompt:sources.prompt,body:sources.body},terms),full=new Set(rows.filter(r=>r.role==='full').map(r=>r.value));
    const aliases=new Set(rows.filter(r=>r.role==='alias').map(r=>r.value));
    const {owners,exact}=declarations(sources,rows);
    const hints=new Map();
    const inspect=rows.filter(r=>r.role);
    for(let i=0;i<inspect.length;i+=12){
      const batch=inspect.slice(i,i+12);
      progress('本地模型正在核对出现位置 · '+(i+1)+'–'+(i+batch.length)+' / '+inspect.length);
      const nearby=new Set(batch.filter(r=>r.role).map(r=>r.value));
      const evidence=[];
      for(const line of text.split('\n')){
        if([...nearby].some(v=>line.includes(v)) && evidence.join('').length<850) evidence.push(line.slice(0,260));
      }
      const payload={原文线索:evidence,客户写法:[...nearby]};
      const raw=await generate(linkInstruction,JSON.stringify(payload),linkSchema);
      for(const {alias,full:name} of raw.links){
        if(!aliases.has(alias)||!full.has(name)||alias===name)continue;
        if(!hints.has(alias))hints.set(alias,new Set());
        hints.get(alias).add(name);
      }
    }
    const projectUses=new Map();
    for(const r of rows.filter(r=>r.type==='项目')){
      if(!projectUses.has(r.value))projectUses.set(r.value,[]);
      projectUses.get(r.value).push(r);
    }
    for(const group of projectUses.values()){
      if(group.length<2&&group[0].origin!=='本地模型')continue;
      for(let i=0;i<group.length;i+=8){
        progress('正在区分内部代号在不同位置的用法…');
        const batch=group.slice(i,i+8);
        const contexts={},fields={};
        const definitions=group.map(r=>neighborhood(r,sources)).filter(s=>/代号|内部|项目名称|项目名|里程碑|版本名/.test(s)).slice(0,3);
        for(const [j,r] of batch.entries()){
          contexts['句'+(j+1)]=neighborhood(r,sources);
          fields['句'+(j+1)]={type:'string',enum:['专名','普通词','不确定']};
        }
        const decisions=await generate(senseInstruction,JSON.stringify({命名线索:definitions,逐句判断:contexts}),record(fields));
        for(const [j,r] of batch.entries()){
          const sense=decisions['句'+(j+1)];
          if(sense==='不确定')r.uncertain=true;
          if(sense==='普通词'&&r.origin!=='本机词表')r.suggest=false;
        }
      }
    }
    for(const r of rows.filter(r=>r.role==='alias')){
      const dictionary=dictionaryAliases.get(r.value);
      const explicit=owners.get(r.value);
      const choices=(explicit||dictionary)?new Set([...(explicit||[]),...(dictionary||[])]):(hints.get(r.value)||new Set());
      if(dictionary)r.dictionaryOwners=[...dictionary];
      r.ambiguous=choices.size>1;
      r.owner=exact.get(r.part+':'+r.start)||(choices.size===1?[...choices][0]:'');
    }
    const declaredProjects=new Set([...projectUses].filter(([,group])=>group.some(r=>{
      const s=sources[r.part];
      return r.origin==='格式规则'||namedProjectUse(s.slice(Math.max(0,r.start-32),r.start),s.slice(r.end,r.end+30));
    })).map(([name])=>name));
    for(const r of rows){
      const s=sources[r.part],before=s.slice(Math.max(0,r.start-32),r.start),after=s.slice(r.end,r.end+30);
      if(r.type==='项目'&&projectUses.get(r.value)?.length>1){
        if(/^(?:的)?(?:项目|版本|排期|上线|进展|里程碑)|^写入(?:周报|进度|汇报)/.test(after)||
          (declaredProjects.has(r.value)&&/^的(?:采购|内部|总|本次)?(?:预算|报价|成本|计划|工期|金额|风险|材料费)/u.test(after)))r.suggest=true;
        if(/(?:房间|室内|墙壁)(?:里|中)?的$/.test(before)&&/测量|声学|噪声/.test(before+after))r.suggest=false;
      }
      const named=namedProjectUse(before,after);
      if(r.type==='项目'&&named)r.suggest=true;
      if(!named&&r.origin!=='本机词表'){
        // A workflow verb and a participant role can also be literal project
        // names. Resolve the occurrence before applying any default suggestion.
        const activity=/^(?:签收|测试|验收|联调|复核|交付)$/u.test(r.value);
        // In “交给某人签收” the marked word is the predicate, even if that
        // spelling was declared as a project elsewhere in the document.
        const assignedToRole=/(?:谁来|(?:让|请|安排|委托|由)[\p{Script=Han}]{0,8}(?:员|主管|经理|代表|同事|专员|负责人|师傅|值班人员))$/u.test(before);
        const assignedAction=assignedToRole||(/(?:由|交给|交由|交|委托)[\p{Script=Han}A-Za-z·]{1,12}$/u.test(before)&&
          /^(?:$|[，,。；;！？、\s]|回执|单据|附件|包裹|快件|货物)/u.test(after));
        const action=assignedAction||/(?:由|等待|完成|负责|办理|安排|请|已|去|来|人|仓库|收件方|双方|分别)$/u.test(before)||
          /^(?:快件|回执|包裹|单据|记录|日期|状态|材料|比|晚|需要|排|耗时|占|用时)/u.test(after);
        const inferred=r.origin==='本地模型'||r.origin==='提示词人名补查';
        const participant=inferred&&!r.owner&&/^(?:员工|经办人|买方|卖方|采购方|收货方|供货方|供应商|谁|哪位|何人)$/u.test(r.value);
        const department=inferred&&r.type==='人员'&&/^(?:仓库|前台|财务部|采购部|库管|仓管|值班员|我|你|他|她|我方|对方|[我你他她]们)$/u.test(r.value);
        const commonMention=inferred&&!r.owner&&!declaredProjects.has(r.value)&&
          /^(?:(?:现场|销售|技术|采购|实施|仓储|客户)代表|(?:收货|交货|验收|送货|值班|销售|维修|技术|操作|测试|检验|工程|采购)员|(?:前一封|上一封|上封|这封|本次)?邮件|调试|回访|核销|报销|差旅|采购|发运|来料|财务|销售|收货人)$/u.test(r.value);
        if(commonMention||participant||department||(r.type==='项目'&&assignedToRole)||(activity&&(action||(!declaredProjects.has(r.value)&&r.origin==='本地模型')))){
          r.suggest=false;r.uncertain=true;
        }
      }
      // Public standards and ordinary team/task words stay visible as reviewable suggestions.
      if(r.origin!=='本机词表'&&!/内部(?:代号|编号)|(?:名为|叫作|称作|代号)[“「：:\s]*$/.test(before)){
        const publicStandard=/^(?:ISO|IEC|IEEE)(?:[- /]\d+)+$/i.test(r.value)&&/标准|依据|条款|规范/.test(before+after);
        const ordinal=/^第[一二三四五六七八九十百千\d]+批$/.test(r.value);
        const team=/^(?:采购|测试|试验|评审|研发|财务|销售|实施|运维)组$/.test(r.value);
        const task=r.value==='联调'&&/延期|测试|完成|等待|安排/.test(before+after);
        const field=/^(?:客户|报价|客户报价|采购成本|预算|单价|金额)$/.test(r.value)&&/^(?:报价)?\s*(?:[：:为是]|\d)/.test(after);
        if(publicStandard||ordinal||team||task||field){r.suggest=false;r.uncertain=true;}
      }
    }
    if(policy.trim()){
      progress('本地模型正在理解本次脱敏要求…');
      const part=plan.section?.part;
      if(evidence)for(const row of rows)if(!part||row.part===part)reviewCompany(row,evidence,part);
      onPolicy(await applyPolicy(sources,rows,policy.trim(),generate,progress,plan));
    }
    return rows;
  });
}
module.exports={analyze};
