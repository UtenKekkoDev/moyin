const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {fieldMatches}=require('../fields.cjs');
const {fieldPlan}=require('../policy.cjs');

async function run(enabled){
  process.env.MOYIN_DUAL_MONEY=enabled?'1':'0';
  const policy='只遮客户报价。', calls=[];
  const sources={body:'附记是41元；附记是42元；附记是43元；附记是44元；附记是45元；客户报价为46元。',prompt:''};
  const answers=[
    ['客户报价','其他金额','采购成本','不确定','客户报价'],
    ['其他金额','客户报价','不确定','其他金额','客户报价']
  ];
  const rows=await fieldMatches(sources,[],fieldPlan(policy).spec,policy,(system,user,schema)=>{
    const labels=answers[calls.length];
    calls.push({system,user,schema});
    assert.deepEqual(schema.required,['1','2','3','4','5']);
    return Object.fromEntries(labels.map((label,i)=>[i+1,label]));
  },()=>{});
  assert.equal(calls.length,enabled?2:1);
  if(enabled){
    const [base,frozen]=calls;
    assert.equal(base.user,frozen.user);
    assert.deepEqual(base.schema,frozen.schema);
    assert.equal(createHash('sha256').update(frozen.system).digest('hex'),'f8d35c73a31816ae908e2ef5af6e1d954fa2fc97a3b99c7ad37d0013e28dd84a');
  }
  assert.deepEqual(rows.filter(r=>r.uncertain).map(r=>r.value),enabled?['41元','42元','43元','44元']:['44元']);
  assert.deepEqual(rows.filter(r=>r.suggest).map(r=>r.value),enabled?['45元','46元']:['41元','45元','46元']);
}
async function verifySectionOrder(){
  process.env.MOYIN_DUAL_MONEY='1';
  const policy='只遮客户报价。';
  await fieldMatches({prompt:'附记是58元。',body:'附记是59元。'},[],fieldPlan(policy).spec,policy,(_,payload)=>{
    const positions=Object.values(JSON.parse(payload).位置);
    assert.deepEqual(positions.map(x=>x.来源),['正文','写作提示词']);
    return {1:'其他金额',2:'其他金额'};
  },()=>{});
}
run(true).then(()=>run(false)).then(verifySectionOrder).catch(e=>{console.error(e);process.exitCode=1;});
