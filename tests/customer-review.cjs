'use strict';
// Integration test with the locally installed model, review state and copy checks.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {analyze}=require('../analyze.cjs');
const web=file=>fs.readFileSync(path.join(__dirname,'../web',file),'utf8');
const {Review,copyFindings}=vm.runInNewContext(web('review.js')+web('outbound.js')+'\n;({Review,copyFindings})');
const company='南浦棉品有限公司',other='禾杉织造有限公司';
const both='只把客户名称匿名化。';

async function main(){
  const cases=[
    ['收件单位', '收件单位为'+company+'。发票由快递公司开具。','给'+company+'拟一封确认件数的邮件。',both,[company,company]],
    ['供应商','供应商：'+other+'。','请给'+other+'催一下到货单。',both,[]],
    ['发票抬头','发票抬头为'+other+'。','请按原样填写'+other+'。',both,[]],
    ['没有客户','入库记录已更新，今天有两箱退件。','按箱数汇总。',both,[]],
    ['同稿两家公司','客户名称：'+company+'。供应商名称：'+other+'。','给'+company+'整理交付说明，附上'+other+'的物流安排。',both,[company,company]],
    ['供应商同时收件','供应商：'+other+'。收件单位为'+other+'。','给'+other+'写个退样回执。',both,[]],
    ['同一公司兼有客户和供应商身份','客户名称：'+company+'。供应商：'+company+'。','请确认这份材料。',both,[company,company]],
    ['只处理正文','收件单位为'+company+'。','给'+company+'拟一封确认件数的邮件。','只遮正文中的客户名称。',[company]]
  ];
  for(const [name,body,prompt,policy,wanted] of cases){
    const sources={prompt,body};
    const rows=await analyze(sources,new AbortController().signal,()=>{},policy);
    const review=new Review(sources,rows);
    for(const r of review.rows)r.decision=r.suggest?'mask':'keep';
    const out=review.output();
    assert.deepEqual(Array.from(out.trace,r=>r.value),wanted,name);
    assert.ok(out.trace.every(r=>r.type==='客户'),name);
    assert.equal(copyFindings(review,out.draft).length,0,name);
    if(name==='同一公司兼有客户和供应商身份')assert.ok(review.rows.some(r=>r.customerCheck?.includes('多种身份')));
    if(name==='收件单位'){
      assert.equal(new Set(out.trace.map(r=>r.replacement)).size,1);
      const conflicts=review.rows.filter(r=>r.customerCheck);
      assert.equal(conflicts.length,2);
      assert.ok(conflicts.every(r=>r.uncertain));
      const kept=conflicts.find(r=>r.part==='body');
      kept.decision='keep';
      assert.equal(copyFindings(review,review.output().draft).length,0,'explicit mixed decisions');
      for(const r of conflicts)r.decision='keep';
      const allowed=review.output().draft;
      assert.equal(copyFindings(review,allowed).length,0,'keep both only once');
      const proceeds=copyFindings(review,allowed+'\n另抄送'+company+'。');
      assert.equal(proceeds.length,1,'new occurrence must be reviewed');
      assert.equal(proceeds[0].start,allowed.length+4);
    }
    if(name==='只处理正文'){
      assert.equal(out.trace[0].part,'body');
      assert.equal(review.rows.filter(r=>r.customerCheck).length,1);
      const edited=out.draft.replace('拟一封','另发给'+company+'，拟一封');
      assert.equal(copyFindings(review,edited).length,0,'prompt is outside employee scope');
    }
    console.log('PASS',name);
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
