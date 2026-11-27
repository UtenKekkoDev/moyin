'use strict';
const ui=Object.fromEntries([...document.querySelectorAll('[id]')].map(e=>[e.id,e]));
let selectedMode='fast',precisionTarget,modeInfoError=false;
function renderMode(){
  const precise=selectedMode==='precision';
  ui.modelBadge.textContent=precise?(precisionTarget?'内网服务 · 27B':'高精度 · 27B'):'本机 · 快速 4B';
  ui.modeNote.textContent=precise?(modeInfoError?'无法读取推理服务配置，请刷新页面或切回快速模式。':
    precisionTarget===undefined?'正在读取服务配置…':(precisionTarget?'正文、写作提示词和脱敏要求将发送到 '+precisionTarget+'。':'正文和写作提示词在本机处理。')+'可填写本地脱敏要求或选择预设。'):'';
}
ui.modelMode.onchange=()=>{
  if(review&&(draftEdited||review.rows.some(r=>r.decision!==null))&&!confirm('切换模式会清除当前核对和编辑，继续？')){
    ui.modelMode.value=selectedMode;return;
  }
  selectedMode=ui.modelMode.value;renderMode();invalidate();
};
fetch('/mode-info').then(async response=>{
  if(!response.ok)throw Error();
  const info=await response.json();precisionTarget=info.precisionHost;
}).catch(()=>{modeInfoError=true;}).finally(()=>{renderMode();controls();});
const PAGE=12;
const snapshots=new Map();
let outgoing=null, findings=null, checkedIssues=0,clearCount=0;
let ruleCard=null;
let review=null,task=null,version=0,page=0,manualPart='body',draftEdited=false,importing=false;
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
function say(text,error=false){ui.status.textContent=text;ui.status.classList.toggle('error',error);}
function pending(){return review?.rows.filter(r=>r.decision===null).length??0;}
function canConfirmRule(){
  return ruleCard?.route==='structured'||(selectedMode==='precision'&&ruleCard?.route==='custom');
}
function controls(){
  const busy=!!task||importing, done=!!review&&!pending();
  const canStart=!busy&&!!(ui.body.value.trim()||ui.prompt.value.trim());
  const needsRule=!!ui.policy.value.trim();
  ui.run.disabled=!canStart||(needsRule&&!canConfirmRule());
  ui.run.hidden=needsRule&&ruleCard?.route==='fallback';
  ui.run.textContent=needsRule?'确认规则并识别':'开始本地识别';
  ui.freeRun.hidden=!needsRule||ruleCard?.route!=='fallback';
  ui.modelMode.disabled=busy;
  if(selectedMode==='precision'){
    ui.run.disabled||=precisionTarget===undefined||!needsRule;
    ui.freeRun.hidden=true;
  }
  ui.freeRun.disabled=!canStart;ui.ruleTools.disabled=busy;
  ui.cancel.hidden=!task; ui.file.disabled=ui.demo.disabled=busy;
  ui.body.readOnly=ui.prompt.readOnly=ui.policy.readOnly=busy;
  ui.vocabulary.readOnly=ui.loadProfile.disabled=ui.saveProfile.disabled=busy;
  ui.returnPanel.hidden=!snapshots.size;
  ui.checked.disabled=!done;ui.copy.disabled=!done||!ui.checked.checked||!ui.draft.value.trim();
  ui.draft.readOnly=!done; ui.manual.hidden=ui.reviewPanel.hidden=!review;
  ui.previewEmpty.hidden=!!review;
  ui.draft.hidden=!review;
  ui.jumpReview.hidden=!review||!pending();
  ui.reviewState.textContent=busy?'处理中':review?(pending()?'建议稿 · 待核对 '+pending()+' 处':(ui.checked.checked?'已核对':'可编辑最终文本')):'等待识别';
}
function invalidate(){
  window.refreshRule?.();
  resetOutbound();
  window.clearReturn?.();
  version++;review=null;draftEdited=false;ui.checked.checked=false;ui.draft.value='';page=0;
  ui.editScope.hidden=ui.policyNote.hidden=true;ui.policyNote.textContent='';ui.otherRows.replaceChildren();ui.numberGroups.replaceChildren();ui.aliasList.replaceChildren();controls();
}
function discardDraft(){return !draftEdited||confirm('此操作将根据核对结果重新生成预览，覆盖已编辑的最终文本。继续？');}
function syncDraft(){resetOutbound();window.clearReturn?.();draftEdited=false;ui.checked.checked=false;ui.draft.value=review.output().draft;controls();}
function option(value,label){const o=el('option',label);o.value=value;return o;}
function owners(row){
  const s=el('select');
  s.append(option('',row.ambiguous?'归属未明 · 使用待核代号':'独立代号'));
  for(const name of review.fullNames())s.append(option(name,name));
  s.value=row.owner;s.setAttribute('aria-label','“'+row.value+'”的客户归属');
  return s;
}
function aliasPanel(){
  const groups=new Map();
  for(const r of review.rows.filter(r=>r.role==='alias')){
    if(!groups.has(r.value))groups.set(r.value,[]);
    groups.get(r.value).push(r);
  }
  ui.aliasBox.hidden=!groups.size;ui.aliasList.replaceChildren();
  for(const [name,members] of groups){
    const row=el('div');row.className='aliasrow';row.dataset.alias=name;
    row.append(el('strong',name));
    if(members.some(r=>r.ambiguous)){
      row.append(el('small','多家客户共用。请在下方逐处选择归属。'));
    }else{
      const s=owners(members[0]);
      if(new Set(members.map(r=>r.owner)).size>1){s.prepend(option('#mixed','各处归属不同'));s.value='#mixed';}
      const apply=el('button','应用到此简称的 '+members.length+' 处');
      apply.onclick=()=>{
        if(s.value==='#mixed'||!discardDraft())return;
        review.bind(name,s.value);syncDraft();render();
        say('已更新简称归属，请确认受影响的位置。');
      };
      row.append(s,apply);
    }
    ui.aliasList.append(row);
  }
}
function render(){
  aliasPanel();renderNumbers();
  const outside=review.rows.filter(r=>review.canGroupKeep(r));
  const remaining=outside.filter(r=>r.decision===null).length;
  ui.keepOutside.hidden=!remaining;
  ui.keepOutside.textContent='确认保留范围外的 '+remaining+' 处';
  ui.undoOutside.hidden=!outside.some(r=>r.groupKept);
  ui.filter.querySelector('[value="outside"]').hidden=!outside.length;
  if(!outside.length&&ui.filter.value==='outside')ui.filter.value='all';
  ui.count.textContent='已核对 '+(review.rows.length-pending())+' / '+review.rows.length+' 处';
  const visible=review.rows.filter(r=>{
    if(r.numericFamily)return false;
    switch(ui.filter.value){
      case 'pending':return r.decision===null;
      case 'policy':return !!r.basis;
      case 'outside':return review.canGroupKeep(r);
      case 'attention':return r.ambiguous||r.uncertain||!r.suggest;
      case 'dictionary':return r.origin==='本机词表';
      default:return true;
    }
  });
  const pages=Math.max(1,Math.ceil(visible.length/PAGE));page=Math.max(0,Math.min(page,pages-1));
  ui.pageNo.textContent=(page+1)+' / '+pages;ui.prev.disabled=page===0;ui.next.disabled=page===pages-1;
  ui.otherRows.replaceChildren(...visible.slice(page*PAGE,(page+1)*PAGE).map(renderRow));
  ui.noOther.hidden=visible.length>0;
  controls();
}
function renderNumbers(){
  const numbers=review.rows.filter(r=>r.numericFamily);
  ui.numericOverview.hidden=!numbers.length;
  ui.numberGroups.replaceChildren();
  if(!numbers.length)return;
  const groups={attention:[],mask:[],keep:[]};
  for(const r of numbers){
    const group=r.decision??(r.uncertain?'attention':r.suggest?'mask':'keep');
    groups[group].push(r);
  }
  for(const [key,label] of [['attention','待核'],['mask','建议遮盖'],['keep','建议保留']]){
    const group=el('section');group.className='numberGroup '+key;
    group.append(el('h4',label+' · '+groups[key].length+' 处'));
    const list=el('ol');list.className='positions';
    list.append(...groups[key].map(renderRow));group.append(list);ui.numberGroups.append(group);
  }
}
function renderRow(r){
    const source=review.sources;
    const row=el('li');row.dataset.id=r.id;
    const t=source[r.part],left=el('div'),context=el('p');context.className='context';
    const meta=(r.part==='prompt'?'提示词':'正文')+' · 第 '+(t.slice(0,r.start).split('\n').length)+' 行 · '+r.origin;
    left.append(el('small',meta));
    if(r.basis||r.scopeNote)left.append(el('small',r.basis?'按你的要求「'+r.basis+'」':r.scopeNote));
    if(r.businessReason){const reason=el('p','业务依据 · '+r.businessReason);reason.className='businessReason';left.append(reason);}
    if(r.customerCheck)left.append(el('strong',r.customerCheck));
    else if(r.numericFamily==='money'&&r.uncertain&&!r.suggest&&r.decision===null)left.append(el('strong',/报价|售价|对客/.test(r.basis||'')?'预览暂留原文，请核实是否属于要遮的报价。':'预览暂留原文，请核实是否属于本次要遮的金额。'));
    else if(r.uncertain&&r.basis&&r.decision===null)left.append(el('small','用途待核对，请根据上下文决定是否替换。'));
    context.append(document.createTextNode(t.slice(Math.max(0,r.start-35),r.start)),el('mark',r.value),document.createTextNode(t.slice(r.end,r.end+35)));
    left.append(context,el('small','建议'+(r.suggest?'替换为 '+review.code(r):'保留原文')+' · '+(r.decision===null?'待核对':r.decision==='mask'?'已选替换':'已选保留')));
    const actions=el('div');actions.className='buttons';
    const locate=el('button','定位原文');
    locate.onclick=()=>{const field=ui[r.part];field.focus();field.setSelectionRange(r.start,r.end);field.scrollIntoView({block:'center'});};
    actions.append(locate);
    if(r.role==='alias'){
      const s=owners(r);s.onchange=()=>{
        if(!discardDraft()){s.value=r.owner;return;}
        review.bind(r.value,s.value,r.id);syncDraft();render();
      };actions.append(s);
    }
    for(const [decision,label] of [['mask','替换'],['keep','保留原文']]){
      const b=el('button',r.customerCheck?(decision==='mask'?'作为客户替换':'确认保留此处'):label);b.dataset.action=decision;b.setAttribute('aria-pressed',r.decision===decision);
      b.onclick=()=>{if((r.decision===decision&&!r.groupKept)||!discardDraft())return;r.groupKept=false;r.decision=decision;syncDraft();render();
        ui.rows.querySelector('[data-id="'+r.id+'"] [data-action="'+decision+'"]')?.focus({preventScroll:true});};
      actions.append(b);
    }
    row.append(left,actions);return row;
}
ui.prev.onclick=()=>{page--;render();};ui.next.onclick=()=>{page++;render();};ui.filter.onchange=()=>{page=0;render();};
ui.editScope.onclick=()=>{ui.policy.focus();ui.policy.scrollIntoView({block:'center'});};
ui.keepOutside.onclick=()=>{
  if(!review||!discardDraft())return;
  review.keepOutside();syncDraft();render();say('已按本次范围保留所选位置，仍可逐处修改。');
};
ui.undoOutside.onclick=()=>{
  if(!review||!discardDraft())return;
  review.undoOutside();syncDraft();render();say('已将合并保留的位置恢复为待核对。');
};
ui.jumpReview.onclick=()=>{
  ui.filter.value='pending';
  page=0;
  render();
};
for(const key of ['prompt','body','policy','vocabulary']){
  if(key==='prompt'||key==='body')ui[key].onfocus=()=>manualPart=key;
  ui[key].onbeforeinput=e=>{
    if(review&&(draftEdited||review.rows.some(r=>r.decision!==null))&&!confirm('修改输入会清除本轮核对记录及最终文本。继续？'))e.preventDefault();
  };
  ui[key].oninput=()=>{invalidate();say((key==='policy'?'脱敏要求':key==='vocabulary'?'词表':'原文')+'已更改，请重新识别。');};
}
ui.add.onclick=()=>{
  if(!review)return;
  const field=ui[manualPart],start=field.selectionStart,end=field.selectionEnd;
  if(start===end){say('请先在正文或提示词中选中需要补标的文字。',true);return;}
  if(!discardDraft())return;
  if(review.rows.some(r=>r.part===manualPart&&r.end>start&&r.start<end)&&!confirm('所选范围与现有候选重叠，按新的边界替换这一处？'))return;
  try{review.add(manualPart,start,end,ui.manualType.value);syncDraft();render();say('已补标选中的这一处。');}catch(e){say(e.message,true);}
};
async function importDoc(file,prompt){
  if(!file||task||importing)return;
  const word=/\.docx$/i.test(file.name);
  if(!word&&!/\.(txt|md|markdown)$/i.test(file.name)){say('请选择 Word、TXT 或 Markdown 文件。PDF 请打开文件涂黑工具。',true);return;}
  if(review&&!confirm('更换材料会清除当前核对记录。继续？'))return;
  const token=++version;importing=true;controls();
  try{
    const data=await (word?WordReader.read(file):readTextMaterial(file));if(token!==version)return;
    const resetPolicy=!!(ui.body.value.trim()&&ui.policy.value);
    if(resetPolicy)ui.policy.value='';
    ui.body.value=data.text;if(prompt!==undefined)ui.prompt.value=prompt;
    invalidate();ui.filename.textContent=file.name;ui.fileinfo.textContent=word?data.paragraphs+' 个非空段落（含单元格） · '+data.tables+' 个表格。识别范围为正文与普通表格，页眉页脚、批注、图片和附件均未读取。':data.info;
    say((word?'已在本机导入 Word。':'已在本机导入文本。')+(resetPolicy?'已清除上一份材料的脱敏要求。':''));
  }catch(e){if(token===version)say('导入失败。'+e.message,true);}
  finally{importing=false;controls();}
}
ui.file.onchange=()=>{const f=ui.file.files[0];ui.file.value='';importDoc(f);};
ui.drop.ondragover=e=>{e.preventDefault();ui.drop.classList.add('over');};
ui.drop.ondragleave=()=>ui.drop.classList.remove('over');
ui.drop.ondrop=e=>{e.preventDefault();ui.drop.classList.remove('over');importDoc(e.dataTransfer.files[0]);};
for(const type of ['dragover','drop'])window.addEventListener(type,e=>e.preventDefault());
ui.demo.onclick=()=>{
  if((ui.body.value||ui.prompt.value)&&!confirm('用模拟材料替换当前输入？'))return;
  importDoc(new File([Uint8Array.from(atob(sampleData),c=>c.charCodeAt(0))],'模拟项目计划.docx'),samplePrompt);
};
ui.cancel.onclick=()=>task?.abort();
ui.clear.onclick=()=>{
  if((snapshots.size||ui.body.value||ui.prompt.value||ui.policy.value||ui.vocabulary.value)&&!confirm('清空当前材料、脱敏要求、词表与本页所有对外稿和代号表？'))return;
  clearCount++;snapshots.clear();ui.returnVersion.length=1;
  ui.vocabulary.value='';
  task?.abort();ui.body.value=ui.prompt.value=ui.policy.value='';ui.filename.textContent='导入材料';ui.fileinfo.textContent='Word、TXT、Markdown · 单次最多 6 万字符';
  invalidate();say('本页已清空。');
};
ui.run.onclick=()=>startAnalysis(false);
ui.freeRun.onclick=()=>startAnalysis(true);
async function startAnalysis(fallback){
  if(ui.policy.value.trim()&&(fallback?ruleCard?.route!=='fallback':!canConfirmRule()))return;
  if(task||!discardDraft())return;
  let vocabulary;try{vocabulary=readVocabulary(ui.vocabulary.value);}catch(e){say(e.message,true);return;}
  if(review?.rows.some(r=>r.decision!==null)&&!confirm('重新识别会清除逐处核对记录。继续？'))return;
  invalidate();const token=version, controller=new AbortController();task=controller;
  const sources={prompt:ui.prompt.value,body:ui.body.value};controls();say('正在准备本地推理…');
  try{
    const resp=await fetch('/analyze',{method:'POST',headers:{'Content-Type':'application/json','X-Moyin':'review'},body:JSON.stringify({...sources,mode:selectedMode,policy:ui.policy.value,vocabulary,confirmation:ruleCard}),signal:controller.signal});
    if(!resp.ok)throw Error(resp.status===409?'上一份识别尚在结束，请稍后重试。':'本地服务未接受请求。');
    const reader=resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf='',items,summary;
    for(;;){
      const {value,done}=await reader.read();if(done)break;
      buf+=value;const lines=buf.split('\n');buf=lines.pop();
      for(const line of lines){
        const e=JSON.parse(line);if(e.error)throw Error(e.error);
        if(e.progress&&token===version)say(e.progress);
        if(e.result){items=e.result;summary=e.policySummary;}
      }
    }
    if(token!==version)return;
    if(!items)throw Error('未收到完整的本地识别结果。');
    review=new Review(sources,items);ui.filter.value='all';syncDraft();render();
    if(summary){
      const scope=summary.scopeDescription?summary.scopeDescription+'。':
        summary.scoped?'按限定范围核对。范围外的默认候选已标为建议保留。':'沿用默认识别，并按本次要求调整建议。';
      const found=summary.matches?'已定位 '+summary.matches+' 处与要求有关的原文。':'没有定位到与要求相符的原文，请检查是否需要手动补标。';
      ui.policyNote.textContent=scope+found+(summary.emptyScope?'限定范围未找到可遮盖文字，已保留默认建议。':'')+(summary.unlocated?'另有 '+summary.unlocated+' 条建议未能核实，请核对原文。':'');
      let previousPart='',end=0;
      if(review.rows.some(r=>{
        if(r.part!==previousPart){previousPart=r.part;end=0;}
        const overlaps=r.start<end;end=Math.max(end,r.end);return overlaps;
      }))ui.policyNote.textContent+=' 部分位置重叠：选“保留原文”后，选了“替换”的其他范围仍会遮盖。';
      ui.editScope.hidden=ui.policyNote.hidden=false;
    }
    say('识别完成。请逐处核对，漏项可回到左侧原文选中补标。');ui.reviewPanel.scrollIntoView({block:'start'});
  }catch(e){if(token===version)say(controller.signal.aborted?'已取消识别。':'识别失败。'+e.message,!controller.signal.aborted);}
  finally{task=null;controls();}
};
function resetOutbound(){
  outgoing=null;findings=null;checkedIssues=0;ui.preflight.hidden=true;
  ui.stampNote.textContent='复制时附上本次稿号，供返回汇报匹配本页代号表。';
}
function prepareOutbound(){
  if(!review||pending()||!ui.checked.checked||!ui.draft.value.trim())return null;
  if(ui.draft.value.includes('〔墨隐稿号')){
    say('最终稿中已有稿号，请删除旧稿号后重新核对。复制时会附上本版稿号。',true);return null;
  }
  if(!findings)findings=copyFindings(review,ui.draft.value);
  const issue=findings[checkedIssues];
  ui.preflight.hidden=!issue;
  if(issue){
    const area={body:'正文',prompt:'提示词',draft:'最终稿'}[issue.part],t=ui.draft.value;
    ui.issueText.textContent=area+'第 '+(checkedIssues+1)+' / '+findings.length+' 处待复查：'+
      t.slice(Math.max(0,issue.start-24),issue.start)+'〈'+issue.value+'〉'+t.slice(issue.end,issue.end+24);
    say('最终稿中还有未确认可发送的原文，请修改或逐处确认。',true);return null;
  }
  if(!outgoing){
    const name=ui.filename.textContent==='导入材料'?'粘贴材料':ui.filename.textContent;
    outgoing=makeSnapshot(review,ui.draft.value,crypto.randomUUID(),name);
  }
  ui.stampNote.textContent='随本稿复制的版本标记 '+outgoing.marker;
  return outgoing;
}
function recordCopy(snapshot){
  if(!snapshots.has(snapshot.id)){
    snapshots.set(snapshot.id,snapshot);
    ui.returnVersion.append(option(snapshot.id,'第 '+snapshots.size+' 版 · '+snapshot.name+' · '+snapshot.id.slice(0,8)));
  }
  controls();say('已复制对外稿并绑定本页代号表。');
}
ui.locateIssue.onclick=()=>{const issue=findings?.[checkedIssues];if(issue){ui.draft.focus();ui.draft.setSelectionRange(issue.start,issue.end);}};
ui.allowIssue.onclick=()=>{if(!findings?.[checkedIssues])return;checkedIssues++;if(prepareOutbound())say('复查完成，可以复制本版对外稿。');};
ui.draft.oninput=()=>{resetOutbound();window.clearReturn?.();draftEdited=true;ui.checked.checked=false;controls();};
ui.checked.onchange=()=>{if(ui.checked.checked)prepareOutbound();else{resetOutbound();window.clearReturn?.();}controls();};
ui.draft.oncopy=e=>{
  e.preventDefault();
  if(ui.draft.selectionStart!==0||ui.draft.selectionEnd!==ui.draft.value.length){say('请用“复查并复制”复制已核对的完整对外稿。');return;}
  const s=prepareOutbound();if(s&&e.clipboardData){e.clipboardData.setData('text/plain',s.payload);recordCopy(s);}
};
ui.copy.onclick=async()=>{
  if(ui.copy.disabled)return;const s=prepareOutbound();if(!s)return;
  const generation=clearCount;
  try{await navigator.clipboard.writeText(s.payload);if(clearCount===generation)recordCopy(s);}
  catch{if(outgoing!==s)return;ui.draft.focus();ui.draft.select();if(!document.execCommand('copy'))say('已选中最终文本，请按 Ctrl+C 复制含稿号的版本。');}
};
controls();
