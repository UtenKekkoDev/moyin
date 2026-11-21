'use strict';
const kinds=['客户','人员','项目','机构','敏感内容'];
function validateVocabulary(entries=[]){
  if(!Array.isArray(entries)||entries.length>160)throw Error('本机词表最多支持 160 条。');
  const owners=new Map();
  return entries.map(e=>{
    if(!e||!kinds.includes(e.type)||!Array.isArray(e.aliases)||e.aliases.length>12)throw Error('词表的类别或别名无效。');
    const clean=value=>{
      if(typeof value!=='string'||value!==value.trim()||!value||value.length>80||/[\r\n\t]/.test(value))throw Error('词表中的词项须为 1～80 个字符。');
      return value;
    };
    const value=clean(e.value),aliases=[...new Set(e.aliases.map(clean))];
    if(e.type!=='客户'&&aliases.length)throw Error('仅客户条目支持简称。');
    for(const term of [value,...aliases]){
      const role=term===value?'main':'alias',key=e.type+'|'+role;
      if(owners.has(term)&&owners.get(term)!==key)throw Error('词表中同一写法的类别或用途有冲突。');
      owners.set(term,key);
    }
    return {type:e.type,value,aliases:aliases.filter(a=>a!==value)};
  });
}
function applyVocabulary(terms,entries){
  const aliases=new Map();
  for(const {value,type,aliases:names} of entries){
    terms.set(value,{value,type,role:type==='客户'?'full':'',origin:'本机词表'});
    for(const name of names){
      terms.set(name,{value:name,type,role:'alias',origin:'本机词表'});
      if(!aliases.has(name))aliases.set(name,new Set());
      aliases.get(name).add(value);
    }
  }
  return aliases;
}
module.exports={validateVocabulary,applyVocabulary};
