import {loadPdf,renderPage,paintMask,exportPdf} from './pdf-tools.mjs';
import {charCount,sanitizedText} from './text-tools.mjs';

const ui=Object.fromEntries([...document.querySelectorAll('[id]')].map(e=>[e.id,e]));
let doc=null,source='',extension='',busy=false,page=1,base=null,rows=[],masks=[],confirmed=new Set(),active=null,drag=null,serial=0,token=0,controller=null;
const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const say=(s,err=false)=>{ui.status.textContent=s;ui.status.classList.toggle('error',err);};
const chars=s=>charCount(s.replace(/[\r\n]/g,''));
function controls(){
  ui.workspace.hidden=!extension;ui.file.disabled=busy;ui.policy.disabled=busy;
  ui.clear.disabled=busy?!controller:!extension;ui.detect.disabled=busy||!extension||!source.trim();
  ui.counts.disabled=busy;ui.checkedText.disabled=busy;
  ui.pagePanel.hidden=!doc;ui.textPanel.hidden=!!doc;ui.wholeCheck.hidden=!!doc;
  const pending=rows.filter(r=>r.decision===null).length;
  ui.pending.textContent=rows.length?('已核对 '+(rows.length-pending)+' / '+rows.length+' 处'):'尚无候选';
  ui.rowHelp.textContent=doc?'选择候选后，在原页框出需要遮盖的像素，或明确保留这一处。':'可以接受或保留每一处候选，也可在上方原文中选中漏项。';
  ui.countHelp.textContent=doc?'开启后，在黑框中印出字符数。候选取原文字符数；扫描件和手工选区请自行计数。整份导出为图片页，文字将无法选中或搜索。':'开启后，每个可见字符替换为一个 █，包括空格。原有换行保留。';
  if(doc){
    ui.prev.disabled=busy||page<=1;ui.next.disabled=busy||page>=doc.pages.length;
    ui.undo.disabled=busy||!masks.some(m=>m.page===page);
    ui.page.textContent=page+' / '+doc.pages.length;ui.checkedPage.disabled=busy||!base;
    ui.checkedPage.checked=confirmed.has(page);ui.reviewCount.textContent='已核对 '+confirmed.size+' / '+doc.pages.length+' 页';
  }else{ui.preview.value=sanitizedText(source,rows,ui.counts.checked);}
  ui.save.disabled=busy||!extension||pending>0||(doc?confirmed.size!==doc.pages.length:!ui.checkedText.checked);
}
function renderRows(){
  ui.rows.replaceChildren();
  for(const r of rows){
    const item=make('li',''),header=make('small',(doc?'第 '+r.page+' 页 · ':'')+r.origin+' · '+r.type+' · '+(r.decision===null?'待核对':r.decision==='mask'?'已遮盖':'已保留'));
    const context=make('p','');context.append(document.createTextNode(source.slice(Math.max(0,r.start-20),r.start)),make('mark',r.value),document.createTextNode(source.slice(r.end,r.end+20)));
    if(r.basis)header.append(document.createTextNode(' · '+r.basis));
    const actions=make('div','');actions.className='line';
    const mask=make('button',doc?'定位并框选':'遮盖此处'),keep=make('button','保留此处');
    mask.setAttribute('aria-pressed',r.decision==='mask');keep.setAttribute('aria-pressed',r.decision==='keep');
    mask.disabled=keep.disabled=busy;mask.onclick=()=>choose(r,true);keep.onclick=()=>choose(r,false);
    actions.append(mask,keep);item.append(header,context,actions);ui.rows.append(item);
  }
  controls();
}
function pdfHint(){
  if(!doc)return;
  const record=doc.pages[page-1];
  ui.hint.textContent=active?'请框住“'+active.value+'”的完整文字。蓝线提示可能的所在位置；以页面可见文字为准。':
    (record.hasText?'直接在页面上拖框。':'本页没有可提取的文字。扫描页请手动拖框。')+'请核对黑框完整盖住文字笔画、签章或图片。';
}
function redraw(){
  if(!base)return;
  const c=ui.canvas,ctx=c.getContext('2d');c.width=base.width;c.height=base.height;ctx.drawImage(base,0,0);
  for(const r of masks.filter(m=>m.page===page))paintMask(ctx,r,ui.counts.checked);
  if(active?.guide){
    const [x,y]=active.guide;ctx.strokeStyle='#007bba';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(Math.max(0,x*c.width-10),y*c.height+3);ctx.lineTo(Math.min(c.width,x*c.width+60),y*c.height+3);ctx.stroke();
  }
  if(drag){
    ctx.strokeStyle='#cc5533';ctx.lineWidth=3;
    ctx.strokeRect(drag.a.x*c.width,drag.a.y*c.height,(drag.b.x-drag.a.x)*c.width,(drag.b.y-drag.a.y)*c.height);
  }
  pdfHint();
}
async function gotoPage(n,row=null){
  if(!doc||n<1||n>doc.pages.length)return;
  const current=++token;page=n;base=null;drag=null;active=row;
  ui.canvas.width=ui.canvas.height=1;controls();
  const local=doc;
  const canvas=await renderPage(local.pdf,local.pages[n-1]);
  if(token!==current||doc!==local)return;
  base=canvas;
  if(row){
    const it=doc.pages[n-1].items.find(x=>x.end>row.start&&x.start<row.end)?.item;
    if(it){
      const pdfPage=await doc.pdf.getPage(n);if(token!==current)return;
      const view=pdfPage.getViewport({scale:1}),pt=view.convertToViewportPoint(it.transform[4],it.transform[5]);
      row.guide=[pt[0]/view.width,pt[1]/view.height];
    }
  }
  redraw();controls();
}
function runPage(n,r=null){return gotoPage(n,r).catch(e=>{say('页面渲染失败。'+e.message,true);});}
async function choose(r,mask){
  if(busy)return;
  if(doc&&mask){await runPage(r.page,r);ui.sheet.scrollIntoView({block:'center'});return;}
  if(doc){masks=masks.filter(m=>m.id!==r.id);confirmed.delete(r.page);active=null;redraw();}
  r.decision=mask?'mask':'keep';ui.checkedText.checked=false;renderRows();
}
function resetCandidates(){
  rows=rows.filter(r=>r.manual);masks=masks.filter(m=>m.id===null);
  active=null;confirmed.clear();ui.checkedText.checked=false;redraw();renderRows();
}
async function clear(){
  token++;controller?.abort();controller=null;
  const previous=doc;doc=null;base=null;active=null;drag=null;rows=[];masks=[];source='';extension='';confirmed.clear();
  ui.file.value='';ui.source.value='';ui.policy.value='';ui.counts.checked=ui.checkedText.checked=false;
  ui.canvas.width=ui.canvas.height=1;busy=false;renderRows();
  if(previous)await previous.pdf.destroy();
}
ui.clear.onclick=async()=>{if(confirm('清空当前文件、脱敏要求和核对记录？')){await clear();say('已清空。');}};
ui.file.onchange=async()=>{
  const file=ui.file.files[0];if(!file)return;
  if(extension&&!confirm('更换文件并清除现有核对记录？')){ui.file.value='';return;}
  const policy=extension?'':ui.policy.value;
  await clear();ui.policy.value=policy;busy=true;controls();say('正在本机读取文件…');
  try{
    const ext=file.name.split('.').at(-1).toLowerCase();
    if(!['pdf','txt','md','markdown'].includes(ext))throw Error('请选择 PDF、TXT 或 Markdown 文件。');
    if(file.size>(ext==='pdf'?25*1024*1024:240004))throw Error('文件超过支持的大小。');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(ext==='pdf'){
      doc=await loadPdf(bytes);source=doc.body;
      ui.sourceInfo.textContent=file.name+' · '+doc.pages.length+' 页 PDF';
      await gotoPage(1);
    }else{
      source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(source.includes('\0')||source.length>60000)throw Error('请使用 6 万字符以内的 UTF-8 文本。');
      ui.source.value=source;ui.sourceInfo.textContent=file.name+' · '+source.length+' 个 UTF-16 码元';
    }
    extension=ext;say(doc?.overflow?'可提取文字超出 6 万字符，当前可逐页手动框选。':(doc&&!source.trim()?'扫描件未启用 OCR，请逐页框选。':'文件已读取。可以开始本地识别，也可以手动标记。'));
  }catch(e){await clear();say('读取失败。'+(e.name==='PasswordException'?'请先在本机解锁 PDF。':e.message),true);}
  finally{busy=false;renderRows();}
};
ui.policy.oninput=()=>{if(extension){resetCandidates();say('脱敏要求已修改，模型候选已清除，请重新识别。');}};
ui.detect.onclick=async()=>{
  if(busy||!source.trim())return;
  if(rows.some(r=>!r.manual&&r.decision!==null)&&!confirm('重新识别会清除已有模型候选及其遮盖，继续？'))return;
  resetCandidates();const run=new AbortController();controller=run;busy=true;renderRows();
  try{
    const resp=await fetch('/analyze',{method:'POST',headers:{'Content-Type':'application/json','X-Moyin':'review'},body:JSON.stringify({body:source,prompt:'',policy:ui.policy.value}),signal:run.signal});
    if(!resp.ok)throw Error(resp.status===409?'其他材料正在识别，请稍后重试。':'本地服务未接受请求。');
    const reader=resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf='',result,summary;
    for(;;){const {value,done}=await reader.read();if(done)break;buf+=value;
      const lines=buf.split('\n');buf=lines.pop();
      for(const line of lines){if(!line)continue;const e=JSON.parse(line);if(e.error)throw Error(e.error);if(e.progress)say(e.progress);if(e.result){result=e.result;summary=e.policySummary;}}
    }
    if(!result)throw Error('模型未返回完整结果。');
    for(const r of result){
      if(r.part!=='body'||source.slice(r.start,r.end)!==r.value)throw Error('模型位置未通过原文核验。');
      const ranges=doc?doc.pages.filter(p=>p.end>r.start&&p.start<r.end):[{number:0,start:0,end:source.length}];
      for(const pg of ranges){
        const start=Math.max(r.start,pg.start),end=Math.min(r.end,pg.end),value=source.slice(start,end);
        if(value.trim())rows.push({...r,origin:r.origin+' · 建议'+(r.suggest?'遮盖':'保留'),id:++serial,start,end,value,page:pg.number,decision:null});
      }
    }
    say('识别完成。请逐处核对。'+(summary?.unlocated?'有 '+summary.unlocated+' 条要求提名未通过原文定位，请人工检查。':''));
  }catch(e){if(!run.signal.aborted)say('识别失败。'+e.message,true);}
  finally{if(controller===run){controller=null;busy=false;renderRows();}}
};
ui.mark.onclick=()=>{
  const originalOffset=pos=>{
    let offset=0;
    for(let i=0;i<pos;i++)offset+=source[offset]==='\r'&&source[offset+1]==='\n'?2:1;
    return offset;
  };
  const start=originalOffset(ui.source.selectionStart),end=originalOffset(ui.source.selectionEnd);
  if(start===end){say('请先在原文中选中要遮盖的位置。',true);return;}
  const exact=rows.find(r=>r.start===start&&r.end===end);
  if(exact)exact.decision='mask';else rows.push({id:++serial,start,end,value:source.slice(start,end),manual:true,origin:'人工补标',type:'敏感内容',decision:'mask'});
  ui.checkedText.checked=false;renderRows();
};
function userCount(rect){
  const location='第 '+rect.page+' 页、距左边 '+Math.round(rect.x*100)+'%、上边 '+Math.round(rect.y*100)+'% 的选区';
  const value=prompt('请输入'+location+'实际遮盖的字符数（含空格，不含换行）。扫描件需人工计数。');
  return value!==null&&/^[0-9]{1,5}$/.test(value)&&Number(value)>0?Number(value):null;
}
ui.counts.onchange=()=>{
  if(ui.counts.checked&&doc){
    for(const m of masks.filter(m=>m.count==null)){
      const n=userCount(m);if(n===null){ui.counts.checked=false;say('字数显示已关闭，仍可导出实心黑框。');break;}m.count=n;
    }
  }
  confirmed.clear();ui.checkedText.checked=false;
  try{redraw();}catch(e){ui.counts.checked=false;redraw();say(e.message,true);}controls();
};
ui.prev.onclick=()=>runPage(page-1);ui.next.onclick=()=>runPage(page+1);
ui.checkedText.onchange=controls;
ui.checkedPage.onchange=()=>{if(ui.checkedPage.checked)confirmed.add(page);else confirmed.delete(page);controls();};
function point(e){const b=ui.canvas.getBoundingClientRect(),clamp=n=>Math.max(0,Math.min(1,n));return{x:clamp((e.clientX-b.left)/b.width),y:clamp((e.clientY-b.top)/b.height)};}
ui.canvas.onpointerdown=e=>{if(e.button!==0||busy||!base)return;const p=point(e);drag={id:e.pointerId,a:p,b:p};ui.canvas.setPointerCapture(e.pointerId);};
ui.canvas.onpointermove=e=>{if(drag?.id!==e.pointerId)return;drag.b=point(e);redraw();};
ui.canvas.onpointercancel=()=>{drag=null;redraw();};
ui.canvas.onpointerup=e=>{
  if(drag?.id!==e.pointerId)return;
  const {a}=drag,b=point(e);drag=null;
  const rect={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y),page,id:active?.id??null,count:active?chars(active.value):null};
  if(rect.w*base.width<4||rect.h*base.height<4){redraw();return;}
  if(rect.count===null&&ui.counts.checked){rect.count=userCount(rect);if(rect.count===null){redraw();say('未记录字数，此次框选已取消。');return;}}
  if(ui.counts.checked){
    try{paintMask(ui.canvas.getContext('2d'),rect,true);}catch(e){redraw();say(e.message,true);return;}
  }
  if(active){masks=masks.filter(m=>m.id!==active.id);active.decision='mask';active=null;}
  masks.push(rect);confirmed.delete(page);redraw();renderRows();
};
ui.undo.onclick=()=>{
  const idx=masks.findLastIndex(m=>m.page===page);if(idx<0)return;
  const [m]=masks.splice(idx,1),r=rows.find(r=>r.id===m.id);if(r)r.decision=null;
  confirmed.delete(page);redraw();renderRows();
};
ui.save.onclick=async()=>{
  if(ui.save.disabled)return;busy=true;renderRows();
  try{
    const blob=doc?await exportPdf(doc,masks,ui.counts.checked,n=>say('正在重建第 '+n+' 页…')):new Blob([sanitizedText(source,rows,ui.counts.checked)],{type:'text/plain;charset=utf-8'});
    const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='脱敏副本.'+extension;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);say('已生成脱敏副本。');
  }catch(e){say('导出失败。'+e.message,true);}
  finally{busy=false;renderRows();}
};
controls();
