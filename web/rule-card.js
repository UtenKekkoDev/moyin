'use strict';
{
  let lastText,lastMode,templateText,revision=0,timer;
  function resetOptions(){
    ui.ruleScope.value='both';ui.quoteRecipient.value='';
    ui.issuedOnly.checked=ui.actualOnly.checked=false;
  }
  function applyOptions(){
    const price=ui.pickPrice.checked,delay=ui.pickDelay.checked;
    ui.pickPrice.disabled=price&&!delay;ui.pickDelay.disabled=delay&&!price;
    ui.recipientOption.hidden=ui.issuedOption.hidden=!price;ui.actualOption.hidden=!delay;
    const terms=[],recipient=ui.quoteRecipient.value.trim();
    if(price){
      terms.push(ui.issuedOnly.checked?'已报给'+(recipient||'客户')+'的报价':recipient?'给'+recipient+'的报价':'对客报价');
    }
    if(delay)terms.push((ui.actualOnly.checked?'实际':'')+'延期天数');
    const scope={body:'在正文中',prompt:'在提示词中',both:''}[ui.ruleScope.value];
    templateText='只'+scope+'隐藏'+terms.join('和');ui.policy.value=templateText;
    invalidate();
  }
  function chooseTemplate(delay){
    if(review&&(draftEdited||review.rows.some(r=>r.decision!==null))&&!confirm('更换规则将清除当前核对和最终稿，继续？'))return;
    resetOptions();ui.pickPrice.checked=true;ui.pickDelay.checked=delay;
    ui.ruleOptions.hidden=false;applyOptions();
  }
  ui.pricePreset.onclick=()=>chooseTemplate(false);ui.bothPreset.onclick=()=>chooseTemplate(true);
  for(const field of [ui.pickPrice,ui.pickDelay,ui.ruleScope,ui.issuedOnly,ui.actualOnly,ui.quoteRecipient]){
    field.oninput=()=>{
      if(review&&(draftEdited||review.rows.some(r=>r.decision!==null))&&!confirm('更换规则将清除当前核对和最终稿，继续？')){
        ui.ruleOptions.hidden=true;return;
      }
      applyOptions();
    };
  }
  function display(card){
    const box=ui.ruleCard;
    if(card.route==='custom'){
      box.replaceChildren(el('strong','确认 27B 自定义要求'),el('p',card.instruction),
        el('p',card.exclusive?'只处理命中要求的位置，其余原样保留。':'将按原话调整常规脱敏建议。'),
        el('p','核对范围：'+({body:'仅正文',prompt:'仅提示词',both:'正文和提示词'}[card.scope])+'。请逐处核对例外和重复出现的位置。'));
      return;
    }
    if(card.route==='fallback'){
      box.replaceChildren(el('strong','未匹配到标准规则'),el('p','可选择上方预设并调整勾选项，或继续按原话自由识别。'));
      return;
    }
    box.replaceChildren(el('strong','确认本次规则'));
    const rows=el('dl');
    function line(label,value){rows.append(el('dt',label),el('dd',value));}
    const describe=items=>items.map(x=>x.label+'（原话「'+x.basis+'」）').join('、');
    line('遮盖项',describe(card.hide));
    line('保留项',[describe(card.keep),card.exclusive?'其余内容保留':'其余内容沿用默认脱敏'].filter(Boolean).join('；'));
    line('作用范围',{body:'仅正文',prompt:'仅提示词',both:'正文和提示词'}[card.scope]);
    line('条件',card.conditions.join('、')||'无限定');box.append(rows);
  }
  window.refreshRule=function(){
    const text=ui.policy.value;
    if(text!==templateText)ui.ruleOptions.hidden=true;
    const mode=ui.modelMode.value;
    if(text===lastText&&mode===lastMode)return;
    lastText=text;lastMode=mode;const id=++revision;clearTimeout(timer);ruleCard=null;
    ui.ruleCard.hidden=!text.trim();controls();
    if(!text.trim())return;
    ui.ruleCard.textContent='正在本机核对规则…';
    timer=setTimeout(async()=>{
      try{
        const resp=await fetch('/rule-preview',{method:'POST',headers:{'Content-Type':'application/json','X-Moyin':'review'},body:JSON.stringify({policy:text,mode})});
        if(!resp.ok)throw Error(resp.status===403?'页面地址与本机服务不匹配。请从启动窗口打开工作台。':
          resp.status===400?'请检查脱敏要求是否超过 1000 个字符。':'规则服务返回 HTTP '+resp.status+'。');
        const card=await resp.json();if(id!==revision)return;
        display(card);ruleCard=card;controls();
      }catch(error){
        if(id!==revision)return;
        lastText=undefined;
        const retry=el('button','重新读取规则');retry.onclick=window.refreshRule;
        const detail=error instanceof TypeError?'请确认启动窗口仍在运行，并使用该窗口中的本机地址。':error.message;
        ui.ruleCard.replaceChildren(el('p','无法读取规则。'+detail),retry);
      }
    },120);
  };
  window.refreshRule();
}
