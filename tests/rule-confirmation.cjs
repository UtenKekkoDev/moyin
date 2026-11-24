const assert=require('node:assert/strict');
const {prepareRule,confirmed}=require('../rule-card.cjs');
const card=text=>prepareRule(text).card;

assert.equal(card('  ').route,'default');
for(const scope of ['','在正文中','在提示词中']){
  for(const [targets,expected] of [['对客报价',['对客报价']],['对客报价和延期天数',['对客报价','延期时长']]]){
    const text='只'+scope+'隐藏'+targets, preview=card(text);
    assert.equal(preview.route,'structured');
    assert.equal(preview.exclusive,true);
    assert.equal(preview.scope,scope===''?'both':scope.includes('正文')?'body':'prompt');
    assert.deepEqual(preview.hide.map(entry=>entry.label),expected);
    assert(preview.hide.every(entry=>text.includes(entry.basis)));
    assert(confirmed(card(text),preview));
  }
}
const limited=card('只在正文中隐藏已报给业主的报价和实际延期天数');
assert.deepEqual(limited.conditions,['报价受方为业主','仅已报出的报价','仅实际发生的延期']);
assert(!confirmed(limited,card('只隐藏对客报价和延期天数')));
const exception=card('只隐藏人名，但保留收件人梁蕊的姓名。');
assert.deepEqual(exception.keep,[{label:'梁蕊',basis:'但保留收件人梁蕊的姓名'}]);
const additive=card('隐藏客户报价，保留采购成本。');
assert.equal(additive.exclusive,false);
assert.deepEqual(additive.keep,[{label:'采购成本',basis:'保留采购成本'}]);
const unknown=card('第三页的风险按红黄绿重新改写。');
assert.equal(unknown.route,'fallback');
assert(!confirmed(unknown));
assert(!confirmed(unknown,{...unknown,route:'structured'}));
assert(!confirmed(unknown,card('仅把尾页改成三行')));
assert(confirmed(unknown,unknown));
