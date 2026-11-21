const assert=require('node:assert/strict');
const {applyPolicy}=require('../policy.cjs');
const {parseExclusive,sectionPolicy}=require('../field-policy.cjs');
const {values}=require('../fields.cjs');
const noInference=()=>{throw Error('Unexpected inference for fully specified fields');};

async function run(){
  const sources={prompt:'经办人沈澜，报价800元。',body:'经办人叶岚，报价900元。'};
  const names=()=>Object.entries(sources).map(([part,text],id)=>({id,part,type:'人员',value:text.slice(3,5),start:3,end:5,suggest:true}));
  for(const [policy,part,type] of [
    ['只在正文里隐藏人名。','body','人员'],
    ['只把写作提示词中的姓名换成代号。','prompt','人员'],
    ['只隐藏正文中的报价。','body','金额']
  ]){
    const rows=names();
    const summary=await applyPolicy(sources,rows,policy,noInference,()=>{});
    assert.ok(summary.scoped);
    assert.deepEqual(rows.filter(r=>r.suggest).map(r=>[r.part,r.type,r.basis]),[[part,type,policy]]);
  }
  for(const policy of ['只在正文里隐藏姓名，提示词也要遮报价。','只遮正文最后一段的人名。','只遮报价，保留第一笔报价。','只遮人名，但保留收件人赵芹。']){
    assert.equal(sectionPolicy(policy),null);
    assert.equal(parseExclusive(policy),null);
  }
  assert.deepEqual(values({body:'请把预算700元整理成表，合计900元整。'}).map(c=>c.value),['700元','900元整']);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
