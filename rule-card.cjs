const {createHash}=require('node:crypto');
const {fieldPlan}=require('./policy.cjs');
const {actualDelayOnly}=require('./fields.cjs');

const labels={price:'对客报价',supplierPrice:'供应商报价',delay:'延期时长',duration:'正常工期',
  cost:'采购成本',other:'其他金额',schedule:'排班安排',budget:'预算金额',lodging:'住宿费'};
function prepareRule(policy){
  const text=policy.trim(),plan=fieldPlan(text),{section,spec}=plan;
  const route=!text?'default':spec?'structured':'fallback';
  const card={route,scope:section?.part||'both',exclusive:!!spec?.exclusive,hide:[],keep:[],conditions:[]};
  if(spec){
    for(const [key,d] of spec.directives){
      const basis=section?text:d.basis;
      card[d.mask?'hide':'keep'].push({label:labels[key]||key,basis});
      if(d.recipient)card.conditions.push('报价受方为'+d.recipient);
      if(d.issuedOnly)card.conditions.push('仅已报出的报价');
      if(d.preDealOnly)card.conditions.push('仅成交前报价');
      if(key==='delay'&&actualDelayOnly(d))card.conditions.push('仅实际发生的延期');
    }
    for(const [name,basis] of spec.keptPeople||[])card.keep.push({label:name,basis});
    for(const term of spec.retainedTerms||[])card.keep.push({label:term,basis:text});
  }
  card.token=createHash('sha256').update(JSON.stringify([text,card])).digest('hex');
  return {plan,card};
}
function confirmed(card,confirmation){
  if(card.route==='default')return true;
  return confirmation?.route===card.route&&confirmation.token===card.token;
}
module.exports={prepareRule,confirmed};
