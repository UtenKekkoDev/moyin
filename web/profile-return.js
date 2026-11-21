'use strict';
function readVocabulary(raw){
  const allowed=['客户','人员','项目','机构','敏感内容'],seen=new Map();
  const rows=raw.split(/\r?\n/).filter(line=>line.trim()).map((line,i)=>{
    const fields=line.split(/[|｜]/).map(s=>s.trim());
    const [type,value,aliasText='']=fields;
    const aliases=aliasText.split(/[,，、]/).map(s=>s.trim()).filter(Boolean);
    if(fields.length<2||fields.length>3||!allowed.includes(type)||!value||value.length>80||
      (type!=='客户'&&aliases.length)||aliases.length>12||aliases.some(s=>s.length>80))
      throw Error('第 '+(i+1)+' 条词表格式有误，示例：客户 | 山岚包装有限公司 | 山岚');
    for(const term of [value,...aliases]){
      const key=type+'|'+(term===value?'main':'alias');
      if(seen.has(term)&&seen.get(term)!==key)throw Error('词表中同一写法的类别或用途有冲突。');
      seen.set(term,key);
    }
    return {type,value,aliases};
  });
  if(rows.length>160)throw Error('词表最多支持 160 条。');
  return rows;
}
ui.saveProfile.onclick=()=>{
  try{
    readVocabulary(ui.vocabulary.value);
    const file=new Blob([JSON.stringify({format:'moyin-profile-1',policy:ui.policy.value,vocabulary:ui.vocabulary.value},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(file),a=el('a');
    a.href=url;a.download='墨隐-脱敏模板.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    say('已导出脱敏模板。模板含原始词项，请保存在本机。');
  }catch(e){say(e.message,true);}
};
ui.loadProfile.onchange=async()=>{
  const file=ui.loadProfile.files[0];ui.loadProfile.value='';
  if(!file||task||importing)return;
  const token=version;
  try{
    if(file.size>150000)throw Error('模板文件过大。');
    const data=JSON.parse(await file.text());
    if(data.format!=='moyin-profile-1'||typeof data.policy!=='string'||data.policy.length>1000||
      typeof data.vocabulary!=='string'||data.vocabulary.length>30000)throw Error('请选择墨隐导出的脱敏模板。');
    readVocabulary(data.vocabulary);
    if(token!==version||task||importing)return;
    if((ui.policy.value||ui.vocabulary.value||review)&&!confirm('用模板替换本次脱敏要求和词表，并清除已有核对结果？'))return;
    ui.policy.value=data.policy;ui.vocabulary.value=data.vocabulary;invalidate();say('已载入模板，可在本页调整后开始本地识别。');
  }catch(e){say('导入失败。'+e.message,true);}
};

let returnItems=[],returnPage=0,returnEdited=false,returnText='';
const RETURN_PAGE=8;
function invalidateReturnPreview(){
  returnItems=[];returnPage=0;returnEdited=false;returnText='';
  ui.returnChoices.replaceChildren();ui.returnNote.textContent='';
  ui.restored.value='';ui.restored.readOnly=true;
  ui.verifiedReturn.checked=false;ui.verifiedReturn.disabled=ui.copyReturn.disabled=true;
}
function describeVersion(s){
  ui.versionSummary.textContent=s?s.name+' · '+s.id+'\n'+s.draft.slice(0,100):'粘贴带稿号的汇报可自动匹配。若外部 AI 省略稿号，请选择版本并核对对外原稿。';
  ui.versionDetails.hidden=!s;ui.versionDraft.textContent=s?.draft||'';
}
window.clearReturn=()=>{ui.externalDraft.value='';ui.returnVersion.value='';describeVersion(null);invalidateReturnPreview();};
ui.externalDraft.oninput=()=>{
  if(!ui.externalDraft.value.includes('〔墨隐稿号 '))ui.returnVersion.value='';
  invalidateReturnPreview();describeVersion(snapshots.get(ui.returnVersion.value));
};
ui.returnVersion.onchange=()=>{invalidateReturnPreview();describeVersion(snapshots.get(ui.returnVersion.value));};
describeVersion(null);
function refreshReturnPreview(){
  ui.restored.value=restoreText(returnText,returnItems);
  const pending=returnItems.filter(i=>i.choice===null).length;
  ui.returnNote.textContent=returnItems.length?'共 '+returnItems.length+' 处代号，剩余 '+pending+' 处待核对。':'未发现可定位的代号，请直接核对并编辑内部汇报。';
  ui.restored.readOnly=ui.verifiedReturn.disabled=pending>0;
  ui.verifiedReturn.checked=false;ui.copyReturn.disabled=true;returnEdited=false;
}
function renderReturn(){
  ui.returnChoices.replaceChildren();
  const text=returnText;
  for(const item of returnItems.slice(returnPage*RETURN_PAGE,(returnPage+1)*RETURN_PAGE)){
    const box=el('div'),label=el('p'),select=el('select');
    box.className='returnChoice';label.className='context';
    label.append(document.createTextNode(text.slice(Math.max(0,item.start-26),item.start)),el('mark',item.token),document.createTextNode(text.slice(item.end,item.end+26)));
    select.setAttribute('aria-label','确认 '+item.token+' 的本处回填');
    select.append(option('-1','请选择本处处理'),option('0','保留代号'));
    const values=item.options;
    for(const [i,v] of values.entries())select.append(option(String(i+1),v));
    select.value=item.choice===null?'-1':item.choice===''?'0':String(values.indexOf(item.choice)+1);
    select.onchange=()=>{
      if(returnEdited&&!confirm('修改此处回填会重建内部预览。继续？')){renderReturn();return;}
      const n=Number(select.value);item.choice=n<0?null:n===0?'':values[n-1];
      refreshReturnPreview();
    };
    box.append(label,el('small',item.options.length===0?'本版没有此代号，请保留代号，核实后可手动编辑内部稿。':item.options.length>1?'同一代号有多种原文写法，请逐处选择。':'请核对该代号在当前句子中的含义。'),select);
    ui.returnChoices.append(box);
  }
  if(returnItems.length>RETURN_PAGE){
    const back=el('button','上页'),more=el('button','下页'),last=Math.ceil(returnItems.length/RETURN_PAGE)-1;
    back.disabled=!returnPage;more.disabled=returnPage===last;
    back.onclick=()=>{returnPage--;renderReturn();};more.onclick=()=>{returnPage++;renderReturn();};
    ui.returnChoices.append(back,el('span',' '+(returnPage+1)+' / '+(last+1)+' '),more);
  }
}
ui.scanReturn.onclick=()=>{
  if(!snapshots.size)return;
  if(returnEdited&&!confirm('重新核对将重建内部预览。继续？'))return;
  invalidateReturnPreview();
  if(!ui.externalDraft.value.trim()){ui.returnNote.textContent='请先粘贴外部 AI 返回的汇报。';return;}
  try{
    const resolved=resolveReturn(ui.externalDraft.value,snapshots,ui.returnVersion.value);
    describeVersion(resolved.snapshot);returnText=resolved.text;
    returnItems=returnSpans(returnText,resolved.snapshot.mapping);renderReturn();refreshReturnPreview();
  }catch(e){ui.returnNote.textContent=e.message;}
};
ui.restored.oninput=()=>{returnEdited=true;ui.verifiedReturn.checked=false;ui.copyReturn.disabled=true;};
ui.verifiedReturn.onchange=()=>{ui.copyReturn.disabled=!ui.verifiedReturn.checked||!ui.restored.value.trim();};
ui.copyReturn.onclick=async()=>{
  if(ui.copyReturn.disabled)return;
  try{await navigator.clipboard.writeText(ui.restored.value);ui.returnNote.textContent='已复制含原文的内部汇报。';}
  catch{ui.restored.focus();ui.restored.select();ui.returnNote.textContent='已选中内部汇报，请按 Ctrl+C。';}
};
