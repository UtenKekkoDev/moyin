'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const backend=require('../model.cjs');
const web=name=>fs.readFileSync(path.join(__dirname,'../web',name),'utf8');
const {Review,copyFindings,makeSnapshot,returnSpans,restoreText}=vm.runInNewContext(
  web('review.js')+web('outbound.js')+'\n;({Review,copyFindings,makeSnapshot,returnSpans,restoreText})'
);

// Brackets identify the exact expected person spans in the two source texts.
const policy='只隐藏人名，但保留收件人梁蕊的姓名。';
const cases=[
  ['原设备培训',policy,'[冯澈]负责演示，梁蕊负责收集问题。','给梁蕊写邮件，问她是否收到[冯澈]的讲义。'],
  ['反转保留对象','只隐藏人名，但保留收件人冯澈的姓名。','冯澈负责演示，[梁蕊]负责收集问题。','给[梁蕊]写邮件，问她是否收到冯澈的讲义。'],
  ['提示词独有人名','只遮人名，但保留收件人「方宁」。','会议室已预订。','给方宁发一封提醒，同时抄送[周恺]。'],
  ['保留人没有出现',policy,'经办人：[许棠]。','请提醒[许棠]提交回执。'],
  ['只有保留人','只遮人名，但保留收件人方宁。','方宁已确认收货。','给方宁拟一封致谢邮件。'],
  ['同姓且重复出现','只隐藏姓名，但保留收件人周宁。','负责人：[周岚]。联系人：周宁。','请问周宁是否收到[周岚]的邮件，请[周岚]补上日期。'],
  ['两位有名收件人','只隐藏人名，保留收件人罗芷，保留收件人周恺。','罗芷负责记录，周恺负责演示，[方宁]负责签到。','请给罗芷和周恺写邮件，附上[方宁]的说明。'],
  ['全文都遮的对照','只隐藏人名。','[冯澈]负责演示，[梁蕊]负责收集问题。','给[梁蕊]写邮件，问她是否收到[冯澈]的讲义。']
];
function source(marked){return marked.replace(/\[([^\]]+)\]/gu,'$1');}
async function run(){
  const signal=new AbortController().signal;
  await backend.withModel(signal,async generate=>{
    backend.withModel=async(_,work)=>work(generate);
    const {analyze}=require('../analyze.cjs');
    for(const [name,requirement,body,prompt] of cases){
      const sources={body:source(body),prompt:source(prompt)};
      const rows=await analyze(sources,signal,()=>{},requirement);
      const review=new Review(sources,rows);
      for(const row of review.rows)row.decision=row.suggest?'mask':'keep';
      const out=review.output();
      const codes=new Map();
      for(const r of out.trace){
        assert.equal(r.type,'人员',name);
        if(codes.has(r.value))assert.equal(r.replacement,codes.get(r.value),name);
        codes.set(r.value,r.replacement);
      }
      assert.equal(codes.size,new Set(codes.values()).size,name);
      const marked='【写作要求】\n'+prompt+'\n\n【项目材料】\n'+body;
      assert.equal(out.draft,marked.replace(/\[([^\]]+)\]/gu,(_,v)=>codes.get(v)||'〈缺代号〉'),name);
      assert.equal(copyFindings(review,out.draft).length,0,name);
      for(const value of codes.keys())assert.ok(copyFindings(review,out.draft+'\n抄送'+value).length,name);
      const {mapping}=makeSnapshot(review,out.draft,'test',name);
      const spans=returnSpans(out.draft,mapping);
      for(const item of spans)item.choice=item.options[0];
      assert.equal(restoreText(out.draft,spans),source(marked),name);
      if(name==='原设备培训'){
        const recipient=review.rows.find(row=>row.part==='prompt'&&row.value==='梁蕊');
        assert.match(recipient.basis,/保留收件人梁蕊/u);
        recipient.decision='mask';
        const edited=review.output();
        assert.equal(edited.trace.filter(row=>row.value==='梁蕊').length,1);
        assert.ok(edited.draft.includes('梁蕊负责收集问题'));
        assert.equal(copyFindings(review,edited.draft).length,0);
      }
      console.log('PASS',name);
    }
  });
}
run().catch(error=>{console.error(error);process.exitCode=1;});
