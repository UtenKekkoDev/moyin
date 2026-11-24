'use strict';
const assert=require('node:assert/strict');
const {values,fieldMatches,parseFields}=require('../fields.cjs');
const {applyPolicy}=require('../policy.cjs');

const cases=[
  '迟开风的{两小时}才是偏差。',
  '归还慢的{一天}，并列清洗的一天。',
  '交回慢了{三天}并列重新编号三天。',
  '重新编号三天和晚交{三天}。',
  '清洗用了两小时，开会迟了吗？没有迟开会两小时。',
  '设备并非晚开机一个小时，实际检修用了一个小时。',
  '归还没有慢一天，清点所需一天。',
  '归还慢{一天}，清洗速度慢，耗时一个小时。',
  '每晚开机两小时。',
  '区分试验半天与逾期归还的{半天}。',
  '未超过借用截止点半天。最后逾期签收{半天}。',
  '清洗速度慢的两小时。',
  '曾以为会迟交两日，但最终仍如期交货。',
  '曾以为会迟交{两日}，另一批最终仍按期交付。',
  '本以为会迟交两日，但最终还是按期交付。下一批晚交{两日}。'
];
const policy='只遮延期时长。';
async function main(){
  for(const annotated of cases){
    let source='',expected=[];
    for(const token of annotated.split(/(\{[^}]+\})/u)){
      if(token.startsWith('{')){
        const value=token.slice(1,-1);
        expected.push([source.length,source.length+value.length]);
        source+=value;
      }else source+=token;
    }
    for(const part of ['body','prompt']){
      const sources={[part]:source};
      const rows=await fieldMatches(sources,[],parseFields(policy),policy,async()=>({1:'不确定'}),()=>{});
      assert.deepEqual(rows.filter(r=>r.suggest).map(r=>[r.start,r.end]),expected,source);
    }
  }
  assert.equal(values({body:'每晚开机两小时。'})[0].role,null);
  // A forecast stays sensitive when the employee asks about delay broadly.
  // Restrict it only when the employee selects actual slippage.
  const sources={body:'起初担心会晚交两天，已确认实际延期两天。',prompt:'请区分原以为会迟交两天和最后迟交两天。'};
  for(const [instruction,parts,all] of [
    ['只遮实际延期的时长。',['body','prompt'],false],
    ['只遮提示词中已发生的延期天数。',['prompt'],false],
    ['只遮延期时长。',['body','prompt'],true]
  ]){
    const rows=[];
    await applyPolicy(sources,rows,instruction,()=>{throw Error('unexpected inference');},()=>{});
    const wanted=parts.flatMap(part=>(all?[sources[part].indexOf('两天'),sources[part].lastIndexOf('两天')]:[sources[part].lastIndexOf('两天')]).map(i=>[part,i]));
    assert.deepEqual(rows.filter(r=>r.suggest).map(r=>[r.part,r.start]),wanted,instruction);
  }
  for(const body of [
    '原先估计会晚一天出货，实际仍晚交一天。',
    '把原先预估的一天和实际延期一天分别写清楚。',
    '一天仅为此前的估算，实际迟交一天。',
    '预计比合同晚五日，追回三日，实际延期一天。',
    '担心赶工会耽误半天，实际延期一天。',
    '可能要慢半天，实际上逾期归还一天。',
    '预计会逾期归还一天，最后迟交一天。'
  ]){
    const rows=[];
    await applyPolicy({body,prompt:body},rows,'只遮实际发生的延期时长。',()=>{throw Error('unexpected inference');},()=>{});
    assert.deepEqual(rows.filter(r=>r.suggest).map(r=>[r.part,r.start]),[['body',body.lastIndexOf('一天')],['prompt',body.lastIndexOf('一天')]]);
  }
  const {fieldCandidates}=require('../fields.cjs'),spec=parseFields(policy);
  for(const [body,role] of [
    ['逾期归还半天。','delay'],
    ['清洗用了半天。','duration'],
    ['清洗用了半天。逾期归还半天。',null]
  ]){
    const refs=fieldCandidates({body,prompt:'请说明这半天。'},spec);
    assert.equal(refs.find(r=>r.part==='prompt').role,role);
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
