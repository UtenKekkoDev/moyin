// Usage: runtime/node.exe tests/evaluate.cjs old|fresh|all result.json
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,'materials',name),'utf8');
const labels={p:'金额',t:'时间',c:'客户',n:'人员',k:'项目'};
const Review=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/review.js'),'utf8')+'\nReview');

function testCases(group){
  if(group==='old')return JSON.parse(read('旧稿40.json'));
  const data=read('员工要求留出.tsv');
  assert.equal(createHash('sha256').update(data).digest('hex'),'b273c35625e7237c8b565c6f55c8f008f05029b50901ad0b2cdfd516043214a9');
  return data.trimEnd().split(/\r?\n/).slice(1).map(line=>{
    const fields=line.split('\t');assert.equal(fields.length,4);
    const [name,policy,body,prompt]=fields;
    return {name,policy,body,prompt,aliases:[['禾境服饰有限公司','禾境']]};
  });
}
function unpack(raw,part,gold){
  let text='',cursor=0;
  for(const hit of raw.matchAll(/\{([ptcnk]):([^{}]+)\}/gu)){
    text+=raw.slice(cursor,hit.index);
    gold.push({part,start:text.length,end:text.length+hit[2].length,value:hit[2],type:labels[hit[1]]});
    text+=hit[2];cursor=hit.index+hit[0].length;
  }
  return text+raw.slice(cursor);
}
function measure(sources,rows,gold,aliases=[]){
  const {trace,draft}=new Review(sources,rows).output();
  const actual=trace.map(r=>{
    const offset=r.part==='prompt'?'【写作要求】\n'.length:(sources.prompt?'【写作要求】\n'.length+sources.prompt.length+2:0)+'【项目材料】\n'.length;
    return {part:r.part,start:r.start-offset,end:r.end-offset,value:r.value,code:r.replacement,type:r.replacement.slice(1,-1).replace(/[A-Z]+$/,'')};
  });
  const same=(a,b)=>a.part===b.part&&a.start===b.start&&a.end===b.end;
  const missed=gold.filter(g=>!actual.some(a=>same(a,g)));
  const exposed=missed.filter(g=>!actual.some(a=>a.part===g.part&&a.start<=g.start&&a.end>=g.end));
  const extra=actual.filter(a=>!gold.some(g=>same(a,g)));
  const wrongType=[],wrongCode=[],owners=new Map(),codes=new Map();
  for(const g of gold){
    const a=actual.find(a=>same(a,g))||actual.find(a=>a.part===g.part&&a.start<g.end&&a.end>g.start);
    if(!a)continue;
    if(a.type!==g.type){wrongType.push({g,a});continue;}
    if(!same(a,g))continue;
    const id=g.type+'|'+(aliases.find(group=>group.includes(g.value))?.[0]||g.value);
    if((owners.has(a.code)&&owners.get(a.code)!==id)||(codes.has(id)&&codes.get(id)!==a.code))wrongCode.push(a);
    owners.set(a.code,id);codes.set(id,a.code);
  }
  return {passed:!(missed.length||extra.length||wrongType.length||wrongCode.length),actual,gold,missed,exposed,extra,wrongType,wrongCode,draft};
}
async function main(){
  const [group,output]=process.argv.slice(2);assert.ok(['old','fresh','all'].includes(group)&&output);
  const backend=require('../model.cjs'),start=backend.withModel;
  const signal=new AbortController().signal,results=[];
  // Reuse the local server between documents. Each completion disables prompt caching.
  await start(signal,async generate=>{
    backend.withModel=async(_,run)=>run(generate);
    const {analyze}=require('../analyze.cjs');
    for(const suite of group==='all'?['old','fresh']:[group]){
      const cases=testCases(suite);assert.equal(cases.length,40);
      for(const c of cases){
        const gold=[],sources={body:unpack(c.body,'body',gold),prompt:unpack(c.prompt,'prompt',gold)};
        const rows=await analyze(sources,signal,()=>{},c.policy);
        results.push({suite,name:c.name,...measure(sources,rows,gold,c.aliases)});
        fs.writeFileSync(output,JSON.stringify(results,null,2));
        console.log(suite,results.length,c.name,results.at(-1).passed);
      }
    }
  });
}
main().catch(e=>{console.error(e);process.exitCode=1;});
