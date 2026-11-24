const assert=require('node:assert/strict');
const {applyPolicy}=require('../policy.cjs');
const {parseExclusive,sectionPolicy,parseNumericRequest}=require('../field-policy.cjs');
const {values}=require('../fields.cjs');
const noInference=()=>{throw Error('Unexpected inference for fully specified fields');};

async function run(){
  const quoted=parseNumericRequest('我只想去掉给画廊的成交前报价。采购成本照留。');
  assert.equal(quoted.exclusive,true);
  assert.deepEqual(quoted.directives.get('price'),{mask:true,basis:'我只想去掉给画廊的成交前报价',recipient:'画廊',preDealOnly:true});
  const joined=parseNumericRequest('请把我方对展馆的报价和交付比约定晚的天数都遮掉，正常运输耗时留给排班。');
  assert.equal(joined.exclusive,false);
  assert.equal(joined.directives.get('delay').actualOnly,true);
  assert.equal(joined.directives.get('price').recipient,'展馆');
  const submitted=parseNumericRequest('费用、人名都请原样保留。我只需要隐去已经报给客户的价格。');
  assert.equal(submitted.directives.get('price').issuedOnly,true);
  assert.equal(submitted.directives.get('人员').mask,false);
  for(const qualified of ['只遮给展馆的第一笔报价','只遮给展馆的报价，保留试单报价','只想去掉报价和原句','只需遮实际延误的天数，提示词里的不遮','只需遮给展馆以外的报价','只遮报价，接手人要用它核账'])
    assert.equal(parseNumericRequest(qualified),null,qualified);
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
  for(const policy of ['只在正文里隐藏姓名，提示词也要遮报价。','只遮正文最后一段的人名。','只遮报价，保留第一笔报价。','只遮人名，但保留收件人的姓名。','只遮人名，但仅在提示词保留收件人赵芹。','只遮报价，但保留收件人赵芹。']){
    assert.equal(sectionPolicy(policy),null);
    assert.equal(parseExclusive(policy),null);
  }
  assert.deepEqual(values({body:'请把预算700元整理成表，合计900元整。'}).map(c=>c.value),['700元','900元整']);
  for(const part of ['body','prompt']){
    for(const [line,expected] of [
      ['第二天上午才交，比约定晚了两天。',['两天']],
      ['第 3 个工作日到货，安装用三个工作日。',['三个工作日']],
      ['发货延至第三日，返还延后三日。',['三日']],
      ['第三周复检。',[]],
      ['逾期第三天仍未收到。',['三天']]
    ])assert.deepEqual(values({[part]:line}).map(c=>c.value),expected,line);
  }
  const amounts={body:'木框含税报价为520元，押金520元。',prompt:'列出520元的押金和520元的报价。'};
  const moneyRows=[];
  await applyPolicy(amounts,moneyRows,'只遮客户报价，留着押金。',noInference,()=>{});
  assert.deepEqual(moneyRows.filter(r=>r.suggest).map(r=>[r.part,r.start]),[
    ['body',amounts.body.indexOf('520元')],['prompt',amounts.prompt.lastIndexOf('520元')]
  ]);
  assert.equal(parseExclusive('只遮客户报价，留着第一笔报价。'),null);
  const scopeText='海隅集团。待核简称。松岑。平湖。原定用时三天。';
  const scopeRows=[
    ['海隅集团','客户',{}],['海隅','客户',{}],['待核简称','客户',{customerCheck:'身份待核'}],
    ['松岑','人员',{}],['平湖','项目',{uncertain:true}],['三天','项目',{}]
  ].map(([value,type,status],id)=>({id,part:'body',value,type,start:scopeText.indexOf(value),
    end:scopeText.indexOf(value)+value.length,suggest:true,...status}));
  const summary=await applyPolicy({body:scopeText,prompt:''},scopeRows,'只遮延期。',noInference,()=>{});
  assert.equal(summary.scopeDescription,'本次仅遮延期时长');
  assert.deepEqual(scopeRows.filter(r=>r.scopeExcluded).map(r=>r.value),['松岑']);
  const quoteSources={body:'供方报价712元，对外报价712元。',prompt:'按712元拟一份客户报价单，供应商报价712元。'};
  for(const [policy,expected] of [
    ['只遮对客报价，保留采购成本。',[quoteSources.body.lastIndexOf('712元'),quoteSources.prompt.indexOf('712元')]],
    ['只遮供应商报价，保留对客报价。',[quoteSources.body.indexOf('712元'),quoteSources.prompt.lastIndexOf('712元')]]
  ]){
    const rows=[];
    await applyPolicy(quoteSources,rows,policy,noInference,()=>{});
    assert.deepEqual(rows.filter(r=>r.suggest).map(r=>[r.part,r.start,r.value]),[['body',expected[0],'712元'],['prompt',expected[1],'712元']]);
  }
  for(const [body,roles] of [
    ['供应商回给我们的是215元，供方报给我们的也是215元。',['other','cost']],
    ['把215元写成体育馆的报价回复，注明包装费另收215元。',['price','other']],
    ['请写份报价确认，把对馆方的215元列入第一条，打孔收费215元单列。',['price','other']],
    ['供应商报价180元，给供应商报价240元。',['cost','price']],
    ['采购底价80元，对外底价95元。',['cost','price']],
    ['700元押金与700元报价。',['other','price']]
  ])assert.deepEqual(values({body}).map(c=>c.role),roles,body);
  for(const instruction of ['只在人名上打码，其他内容保留。','只处理员工姓名，正文和提示词都要查。']){
    assert.equal(parseExclusive(instruction).directives.get('人员').mask,true);
  }
  for(const [text,expected] of [
    ['供应商报价180元，给供应商报价290元。',['cost','price']],
    ['请对照380元的报价和180元的垫付款。',['price','other']],
    ['并列记录700元押金与700元报价。',['other','price']],
    ['采购底价315元，给客户的底价480元。',['cost','price']]
  ]){
    for(const part of ['body','prompt'])assert.deepEqual(values({[part]:text}).map(c=>c.role),expected,text);
  }
  for(const [text,expected] of [
    ['写明晚还的四小时和清洁标定的四小时。',['delay','duration']],
    ['按交回晚三日、弯管三日写摘要。',['delay','duration']],
    ['分别顺延两天和三天。',['delay','delay']],
    ['原工期两天和交付延期三天。',['duration','delay']],
    ['迟寄的一天和加工的一天。',['delay','duration']],
    ['试水四天以及迟交四天。',['duration','delay']],
    ['迟还的一日和清点所需的半日。',['delay','duration']],
    ['推迟安装两天。',['delay']],
    ['晚还一天以及装配延后三天。',['delay','delay']],
    ['推迟两天和额外窗口三天。',['delay',null]],
    ['晚还两天和运输一天、打包半天。',['delay','duration','duration']]
  ]){
    for(const part of ['body','prompt'])assert.deepEqual(values({[part]:text}).map(c=>c.role),expected,text);
  }
  for(const instruction of ['只把延期时长隐去，检修用时要保留。','只隐藏交付延期，试运行天数保留。','只隐去延期天数，别删检测周期。']){
    assert.equal(parseExclusive(instruction).directives.get('delay').mask,true);
  }
  assert.equal(parseExclusive('只隐去延期天数，别删首次交付延期。'),null);
  for(const [instruction,keepDefaults] of [['遮人名，但保留收件人沈澜。',true],['只遮人名，但保留收件人沈澜。',false]]){
    const rows=names();
    const company='其他公司',body=sources.body+company;
    rows.push({id:2,part:'body',type:'客户',value:company,start:sources.body.length,end:body.length,suggest:true});
    await applyPolicy({...sources,body},rows,instruction,noInference,()=>{});
    assert.equal(rows[0].suggest,false);
    assert.match(rows[0].basis,/保留收件人沈澜/u);
    assert.equal(rows[1].suggest,true);
    assert.equal(rows[2].suggest,keepDefaults);
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
