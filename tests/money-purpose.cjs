'use strict';
const assert=require('node:assert/strict');
const {applyPolicy}=require('../policy.cjs');
const {fieldMatches}=require('../fields.cjs');

// [ ] marks the exact price spans in each text, including repeated numbers.
const cases=[
  '采购入账每套95元，门店报价每套[95元]。',
  '停车费42元，含停车费的对外报价为[42元]。',
  '先付货款620元，给客户的报价为[620元]。',
  '请把531元标为进货价，把[531元]列为客户报价。',
  '财务按85元核算内部底价，对外底价定为[85元]。',
  '报价[301元]，用这笔货款做对账；301元货款另记。',
  '把客户报价[180元]用于核算内部底价。',
  '别把客户报价[72元]记为货款。',
  '客户报价[85元]不含停车费，停车费另付85元。',
  '采购价120元没有列为报价。',
  '写出630元的采购价和[630元]的报价。',
  '先列22元打样预算和第二款[22元]的报价。',
  '并列[66元]的报价与第二笔66元的修模费。',
  '把52元写成采购价，把[52元]写成给买家的报价。',
  '厂家给我司报了33元，销售给供货方报了[33元]。',
  '订金98元，另附[98元]的报价和98元的包装回收费。',
  '按11元退款、11元还款分别填写。财务收回的借款也是11元。',
  '28元清洗费和28元修模费，清洗费的对外报价是[29元]。',
  '报给物业的拆装总价为[1680元]。物业预先打来的第一笔工程款为800元。',
  '供方给仓库报每个33元；我们给汽修店报的是每个[48元]。',
  '采购单上写着每件29元；发给批发商的报价表上列的是每件[44元]。',
  '今早只付了60元卸货费，客户还没收到报价。',
  '厂家给我方报每件90元，我们给厂家报每件[90元]。',
  '采购单上注明单价为19元；客户报价为[19元]。',
  '先付了80元，现场服务的对客报价是[80元]。',
  '首期进度款为99元，收到的合同款99元，合同款对应的对客报价是[99元]。',
  '把[390元]写成给冷柜厂的打样报价，别忘了附图。',
  '把284元已付货款和[284元]的学校报价分成两段。',
  '请区分每套64元的成本和[92元]的对客报价。',
  '采购单上写着每件29元；提醒采购29元是进货单价。',
  '把[95元]的打样报价和95元的打样预算分开写。',
  '分别列出320元的供应商的打样报价与[320元]的学校报价。'
];
async function run(){
  for(const [spec,body,expected] of [
    [{recipient:'茶社',preDealOnly:true},'我方给茶社报的是整套装配517元，尚未成交。给旅店的整批报价是517元；采购成本是517元。',['517元']],
    [{recipient:'旅店',issuedOnly:true},'已发给旅店的报价是76元；准备发给旅店的报价是72元。已发给学校的报价是76元。',['76元']],
    [{preDealOnly:true},'给学校的报价是96元。签约后给学校的追加报价是93元。',['96元']],
    [{issuedOnly:true},'内部测算每批81元。还没报给学校的报价是80元。',[]]
  ]){
    const dir={directives:new Map([['price',{mask:true,basis:'本次报价要求',...spec}]])};
    const rows=await fieldMatches({body,prompt:body},[],dir,'本次报价要求',()=>({1:'其他金额',2:'其他金额'}),()=>{});
    for(const part of ['body','prompt']){
      const hits=rows.filter(r=>r.part===part&&r.suggest);
      assert.deepEqual(hits.map(r=>r.value),expected,body);
      for(const r of hits)assert.equal(r.start,body.indexOf(r.value));
    }
  }
  for(const marked of cases){
    const text=marked.replace(/[[\]]/g,'');
    const expected=[];
    let brackets=0;
    for(const hit of marked.matchAll(/\[([^\]]+)\]/g)){
      expected.push([hit.index-brackets,hit[1]]);
      brackets+=2;
    }
    const rows=[];
    await applyPolicy({body:text,prompt:text},rows,'只遮客户报价。',()=>{throw Error('unexpected inference: '+text);},()=>{});
    for(const part of ['body','prompt']){
      const actual=rows.filter(r=>r.part===part&&r.suggest).map(r=>[r.start,r.value]);
      assert.deepEqual(actual,expected,text);
    }
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
