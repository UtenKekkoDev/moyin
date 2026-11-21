'use strict';

// A company suffix establishes an organization, not its relationship to the employee.
const suffix=/(?:有限公司|有限责任公司|股份公司|集团公司)$/u;
const declaration=/(?:^|[\n。！？；;，,|｜])\s*(?:本次|本单)?(客户(?:公司)?(?:全称|名称)?|收件单位|收货单位|供应商(?:名称)?|发票抬头|开票单位)\s*(?:为|是|[：:])\s*[“「"]?([\p{Script=Han}A-Za-z0-9（）()·-]{2,48}?(?:有限责任公司|有限公司|股份公司|集团公司))(?=$|[\s，,。！？；;、”」"（(|｜])/gu;

function companyEvidence(sources,terms){
  const evidence=new Map();
  for(const [part,text] of Object.entries(sources)){
    for(const match of text.matchAll(declaration)){
      const [,label,name]=match;
      const role=label.startsWith('客户')?'客户':label.startsWith('收')?'收件单位':label.startsWith('供应商')?'供应商':label;
      if(!evidence.has(name))evidence.set(name,{locations:new Map(),roles:new Set()});
      const entry=evidence.get(name);
      entry.locations.set(part+':'+(match.index+match[0].length-name.length),role);
      entry.roles.add(role);
      if(!terms.has(name))terms.set(name,{value:name,type:'机构',role:'',origin:'公司字段'});
    }
  }
  return evidence;
}

function reviewCompany(row,evidence,part){
  if(row.origin==='本机词表'||!suffix.test(row.value)||!['客户','人员','机构'].includes(row.type))return;
  const entry=evidence.get(row.value);
  if(!entry&&row.type!=='人员')return;
  const local=entry?.locations.get(row.part+':'+row.start);
  const roles=entry?.roles||new Set();
  const supplierOnly=roles.has('供应商')&&!roles.has('客户');
  const relation=supplierOnly?'供应商':(local||(roles.size===1?[...roles][0]:null));
  if(relation&&relation!=='客户'&&relation!=='收件单位'&&!roles.has('客户')){
    Object.assign(row,{type:'机构',role:'',owner:'',suggest:false});
    return;
  }
  const uncertain=relation!=='客户';
  Object.assign(row,{type:'客户',role:'full',owner:'',suggest:!!relation||roles.has('客户')||roles.has('收件单位')});
  if(uncertain){
    row.uncertain=true;
    if(roles.has('客户'))row.customerCheck='同一家公司在材料中有多种身份，请确认是否遮盖此处名称。';
    else if(relation==='收件单位')row.customerCheck='材料把这家公司列为收件单位，请确认它是否是本次客户。';
    else row.customerCheck='公司名称已定位，客户身份待确认。';
    row.customerCheckPart=part;
  }
}
module.exports={companyEvidence,reviewCompany};
