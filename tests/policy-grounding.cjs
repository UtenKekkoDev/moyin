'use strict';
const assert = require('node:assert/strict');
const {applyPolicy} = require('../policy.cjs');

async function evaluate(body, policy, proposed, initial = []) {
  const rows = initial.map(([value,type],id)=>({
    id, part:'body', start:body.indexOf(value), end:body.indexOf(value)+value.length,
    value, type, suggest:true
  }));
  const generate = async (_system, _input, schema) => schema.properties.mode ?
    {mode:'仅限指定项'} : {edits:proposed.map(([quote,kind])=>({
      line:1, quote, kind, occurrence:1, action:'隐去', basis:policy.split('，')[0]
    }))};
  await applyPolicy({body,prompt:''}, rows, policy, generate, ()=>{});
  return rows.filter(r=>r.suggest).map(r=>[r.value,r.type]);
}

async function run() {
  const policy='请把维修单上的柜门颜色隐去，其余原样保留';
  const {plan}=require('../rule-card.cjs').prepareRule(policy,'precision');
  const rows=[{part:'body',start:0,end:2,value:'李平',type:'人员',suggest:true,id:1}];
  const generate=async(_,input,schema)=>schema.properties.mode?{mode:'沿用默认'}:{edits:[]};
  const summary=await applyPolicy({body:'李平已签字。',prompt:''},rows,policy,generate,()=>{},plan);
  assert(summary.scoped);
  assert.equal(rows[0].suggest,false);
  const price='这次只隐去我们给客户的售价，其他记录照写。';
  assert.deepEqual(await evaluate('整理交接说明。',price,[['整理交接说明。','金额']]),[]);
  assert.deepEqual(await evaluate('确认单列860元。',price,[['确认单列860元。','金额']]),[['860元','金额']]);
  assert.deepEqual(await evaluate('采购成本42元。',price,[['42元','金额']]),[]);
  const late='只把比交货时间晚了多久遮住，正常排班保留。';
  assert.deepEqual(await evaluate('比约定晚了两天。',late,[['比约定晚了两天。','金额']],[['约定','项目']]),[['两天','时间']]);
  const people='只把负责审签的人的姓名换成代号，部门照写。';
  assert.deepEqual(await evaluate('请向何岑解释结论。',people,[['请向何岑解释结论。','敏感内容']],[['何岑','人员']]),[['何岑','人员']]);
  // Do not limit a coordinated list of fields to its final field.
  const mixed='只把项目代号和对客报价打码，其他事项保留。';
  assert.deepEqual(await evaluate('岭帆报价35元。',mixed,[['岭帆','项目'],['35元','金额']]),[['岭帆','项目'],['35元','金额']]);
  const twoPrices='只把采购成本和对客售价打码，给会审用。';
  assert.deepEqual(await evaluate('采购成本36元，售价57元。',twoPrices,[['36元','金额'],['57元','金额']]),[['36元','金额'],['57元','金额']]);
  const outward='给客户看的这份，把我们开给展厅的报价数字藏一下；费用报销和采购都照写。';
  const names=[['朱绮','人员'],['雷帆器材有限公司','客户'],['雨伞','项目']];
  assert.deepEqual(await evaluate('朱绮为雷帆器材有限公司负责雨伞。供方报给我们的也是48元，出租车费12元，报给展厅98元。',
    outward,[['48元','金额'],['12元','金额'],['98元','金额']],names),[...names,['98元','金额']]);
  assert.deepEqual(await evaluate('记录员周瑛完成交接。','请只把材料里出现的人员姓名替换掉，岗位留给排班用。',
    [['记录员周瑛','人员']],[['记录员周瑛','人员']]),[['周瑛','人员']]);
  assert.deepEqual(await evaluate('付了35元。','只帮我隐去报给外面客户的价格。要是没有，原文直接留着。',
    [['付了35元。','金额']],[['付了','项目']]),[]);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
