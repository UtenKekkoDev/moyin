'use strict';
const assert=require('node:assert/strict');
const {fieldMatches}=require('../fields.cjs');
const {applyPolicy,fieldPlan}=require('../policy.cjs');
const policy='只遮延期天数。';
async function calls(sources){
  const requests=[];
  await fieldMatches(sources,[],fieldPlan(policy).spec,policy,async(system,payload,schema)=>{
    const items=Object.entries(JSON.parse(payload).位置);
    assert.equal(items.length,1);
    assert.deepEqual(schema.required,['1']);
    requests.push({system,payload,schema});
    return {1:'一般时长'};
  },()=>{});
  return requests;
}
async function main(){
  const body='首件从锁紧到验松用了三日。';
  const alone=await calls({body,prompt:''});
  const paired=await calls({prompt:'帮我解释这三日。',body});
  assert.equal(alone.length,1);assert.equal(paired.length,2);
  assert.deepEqual(paired[1],alone[0]);
  assert.deepEqual(JSON.parse(paired[0].payload).位置[1].正文线索,['首件从锁紧到验松用了三日']);
  const rows=[],sources={body:'交货截止后又过了三日才送到。',prompt:'请解释这三日。'};
  let callsWithEvidence=0;
  await applyPolicy(sources,rows,'只隐藏提示词中的延期天数。',async(_,payload)=>{
    const item=JSON.parse(payload).位置[1];
    assert.equal(item.来源,'写作提示词');
    assert.deepEqual(item.正文线索,['交货截止后又过了三日才送到']);
    callsWithEvidence++;
    return {1:'延期'};
  },()=>{});
  assert.equal(callsWithEvidence,1);
  assert.deepEqual(rows.filter(r=>r.suggest).map(r=>[r.part,r.value]),[['prompt','三日']]);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
