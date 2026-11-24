'use strict';
const assert=require('node:assert/strict');
const backend=require('../model.cjs');
let generator;
backend.withModel=(_,work)=>work(generator);
const {analyze}=require('../analyze.cjs');
const run=body=>analyze({body,prompt:''},new AbortController().signal,()=>{});
const limit=()=>Object.assign(Error('length limit'),{code:'MODEL_LENGTH_LIMIT'});

async function main(){
  const first='房萱已提交。',second='费萌已签字。',calls=[];
  generator=async(_,text)=>{
    calls.push(text);
    if(text===first+second)throw limit();
    return {terms:[{label:'人名',value:text.slice(0,2)}]};
  };
  const result=await run(first+second);
  assert.deepEqual(calls,[first+second,first,second]);
  assert.deepEqual(result.map(r=>[r.start,r.value]),[[0,'房萱'],[first.length,'费萌']]);
  generator=async(_,text)=>{
    if(text===first)return {terms:[{label:'人名',value:'房萱'}]};
    throw limit();
  };
  await assert.rejects(run(first+second),{code:'MODEL_LENGTH_LIMIT'});
  let attempts=0;
  generator=async()=>{attempts++;throw Error('cancelled');};
  await assert.rejects(run(first+second),/cancelled/);
  assert.equal(attempts,1);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
