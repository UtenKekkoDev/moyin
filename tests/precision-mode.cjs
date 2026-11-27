const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mock,test}=require('node:test');
const {prepareRule}=require('../rule-card.cjs');
const {classify,supportedPlan}=require('../precision.cjs');

test('quote_recipient checks only an explicitly named receiver in scope',async()=>{
  const make=text=>supportedPlan(prepareRule(text).plan);
  const sources={body:'我们的报价是300元。',prompt:'请写300元。'};
  async function run(rule,name,match){
    return classify(sources,make(rule),async(system,input,schema)=>{
      const ids=Object.keys(schema.properties);
      assert.equal(ids.length,1);
      const request=JSON.parse(input);
      assert.equal(request.候选[0].来源,'正文');
      if(request.目标收报价方){
        assert.equal(request.目标收报价方,'会场');
        assert.equal(request.候选[0].实际收报价方,name);
        return {1:match};
      }
      assert.equal('quote_recipient' in schema.properties[1].properties,name!==undefined);
      return {1:{依据:'我方向单位报出价格。',类别:'对客报价',quote_recipient:name}};
    });
  }
  for(const [name,match,mask,uncertain] of [
    ['会场','match',true,false],['会议中心','match',true,false],['门店','mismatch',false,false],
    ['运营方','uncertain',false,true],['会场','mismatch',false,true],['我方','match',false,true]
  ]){
    const rows=await run('只在正文中隐藏给会场的报价',name,match);
    assert.equal(rows.find(r=>r.part==='body').suggest,mask);
    assert.equal(rows.find(r=>r.part==='body').uncertain,uncertain);
    assert.equal(rows.find(r=>r.part==='prompt').suggest,false);
  }
  assert((await run('只在正文中隐藏对客报价')).some(r=>r.suggest));
  const rows=await classify(sources,make('只在正文中隐藏给会场的报价'),async(_,input)=>{
    assert.equal(JSON.parse(input).目标收报价方,undefined);
    return {1:{依据:'该笔为实付的费用。',类别:'已发生收付',quote_recipient:'不适用'}};
  });
  assert(rows.every(row=>!row.suggest&&!row.uncertain));
});
test('all prices includes internal estimates and purchase prices only within the selected section',async()=>{
  const rule=supportedPlan(prepareRule('只在正文中隐藏全部价格','precision').plan);
  const sources={body:'内部测算120元，供方价格80元，回复客户160元，押金40元。',prompt:'请写160元。'};
  const rows=await classify(sources,rule,async(_,input,schema)=>{
    const candidates=JSON.parse(input).候选;
    assert(candidates.every(c=>c.来源==='正文'));
    const kinds=['内部测算价','供方采购价','对客报价','已发生收付'];
    return Object.fromEntries(candidates.map((c,i)=>{
      assert(schema.properties[c.编号].properties.类别.enum.includes('内部测算价'));
      return [c.编号,{类别:kinds[i],依据:'按该处业务上下文判断。'}];
    }));
  });
  assert.deepEqual(rows.filter(r=>r.suggest).map(r=>[r.part,r.value]),[['body','120元'],['body','80元'],['body','160元']]);
});
test('local mode switch waits for process close; external disconnect never spawns a fallback',async t=>{
  const events=[];
  t.mock.method(require('node:child_process'),'spawn',(_file,args)=>{
    const child=new EventEmitter(),name=args[1].includes('27B')?'27B':'4B';
    events.push('start'+name);
    child.kill=()=>setTimeout(()=>{events.push('close'+name);child.emit('close',0);},12);
    return child;
  });
  t.mock.method(require('node:fs'),'existsSync',()=>true);
  t.mock.method(require('node:fs'),'statSync',()=>({size:2708805216}));
  let connected=true;
  t.mock.method(globalThis,'fetch',async()=>{if(!connected)throw Error('断连');return {ok:true};});
  const {withModel}=require('../model.cjs'),signal=new AbortController().signal;
  const old=process.env.MOYIN_27B_URL;
  try{
    delete process.env.MOYIN_27B_URL;
    await Promise.all([withModel(signal,async()=>{}),withModel(signal,async()=>{},'precision')]);
    assert.deepEqual(events,['start4B','close4B','start27B','close27B']);
    connected=false;process.env.MOYIN_27B_URL='http://127.0.0.1:8001';
    await assert.rejects(withModel(signal,g=>g('test','test',{}),'precision'),/切回快速模式/);
    assert.equal(events.length,4);
  }finally{if(old===undefined)delete process.env.MOYIN_27B_URL;else process.env.MOYIN_27B_URL=old;}
});
