'use strict';
// Accept complete field instructions. Leave unconsumed qualifications with
// the general reviewer rather than treating them as document-wide rules.
const names=[
  ['price',/^(?:(?:发给|给|对)客户的?|对客|客户|对外)?(?:最终|含税)?报价(?:的?金额)?$/u],
  ['delay',/^(?:(?:实际(?:发生)?|已经发生|已发生)的?|交付|验收|交货|上线)?延期(?:的?(?:时长|时间|天数))?$/u],
  ['budget',/^(?:活动|内部)?预算(?:的?金额)?$/u],
  ['lodging',/^(?:酒店)?住宿费(?:用)?(?:的?金额)?$/u],
  ['人员',/^(?:所有|全部)?(?:(?:员工|人员|个人|人)的?姓名|姓名|人名)$/u],
  ['客户全称',/^客户(?:公司|企业)?全称$/u],
  ['客户简称',/^(?:客户(?:公司|企业)?)?简称$/u],
  ['客户',/^客户(?:公司|企业)?名称$/u],
  ['项目',/^(?:内部)?(?:项目|版本)(?:名称|名|代号|编号)$/u]
];
const both=/(?:Word\s*)?正文\s*(?:和|与|及|、)\s*(?:(?:写作)?(?:提示词|要求)|邮件草稿)/gu;
const action=/隐去|隐藏|遮盖|遮掉|遮住|遮|匿名化|替换|换成|处理/u;
function field(text){return names.find(([,re])=>re.test(text))?.[0];}
const references=/^(?:两部分(?:中出现的|中的)?(?:都|也)(?:要)?(?:处理|检查|查|遮|替换)|两部分(?:都)?按(?:同一|这个)要求处理)$/u;
const sameCode=/^(?:全文和提示词里)?(?:两种(?:写法|叫法)|同一个人每次出现|给这家公司)(?:都)?(?:使用|共用|用)(?:同)?一个(?:客户|人员)?代号$/u;
function supplemental(clause,directives){
  if(!directives.size)return false;
  const normalized=clause.replace(both,'两部分');
  if(references.test(normalized)||sameCode.test(clause))return true;
  const repeated=normalized.match(/^(?:两部分|(?:写作)?提示词)(?:中出现的|中的|里的)(.+?)(?:都|也)要(?:遮|处理|替换)$/u)||clause.match(/^(?:如果)?没有(.+?)就(?:保留原文|照原样)$/u);
  if(repeated)return directives.has(field(repeated[1]));
  if(/^(?:包括|包含)(?:邮件)?收件人$|^人名用人员代号$|^(?:写作)?提示词里的收件人也包括在内$/u.test(clause))return directives.has('人员');
  if(/^(?:包括|包含)写作提示词中的名称$|^(?:项目|版本)名称用项目代号$/u.test(clause))return directives.has('项目')||directives.has('客户');
  if(/^(?:包括|包含)全称和简称$/u.test(clause))return directives.has('客户');
  return false;
}
function masks(clause){
  let s=clause.replace(/^(?:请)?(?:只|仅)?(?:需|要)?(?:把|将)?/u,'');
  s=s.replace(both,'两部分').replace(/^两部分(?:里|中)(?:的|凡是)?/u,'');
  const mark=s.match(/^在(.+)上打码$/u);
  if(mark&&field(mark[1])==='人员')return ['人员'];
  if(!action.test(s))return null;
  s=s.replace(/^(?:隐去|隐藏|遮盖|遮掉|遮住|遮|替换|处理)(?:掉|把)?/u,'')
    .replace(/(?:需要|也要|都要|都)?(?:匿名化|遮掉|隐去|隐藏|替换|换成)(?:(?:成|为)?(?:同一)?(?:人员|客户|项目)?代号(?:占位符)?)?$/u,'')
    .replace(/用(?:人员|客户|项目)?代号$/u,'');
  const keys=s.split(/以及|[、及和与]/u).map(field);
  return keys.every(Boolean)?keys:null;
}
// A named recipient is an exception to the person field. Keep the literal
// until we can compare it with whole person spans in the document.
function recipientToKeep(clause){
  const match=clause.match(/^(?:但(?:是)?|不过)?(?:请)?(?:原样)?保留(?:邮件)?收件人\s*[：:]?\s*(.+?)(?:的(?:姓名|名字|人名))?$/u);
  if(!match)return null;
  let literal=match[1].trim();
  const quoted=literal.match(/^“([^”]+)”$|^「([^」]+)」$|^"([^"]+)"$/u);
  if(quoted)literal=quoted[1]||quoted[2]||quoted[3];
  if(!/^(?:[\p{Script=Han}]{2,4}|[A-Za-z]+(?:[ '-][A-Za-z]+){0,3})$/u.test(literal))return null;
  if(/^(?:的|是|为|和|与|及)|姓名|名字|称呼|本人|信息|地址|邮箱|电话|那位|所有|仅在|只在|除外/u.test(literal))return null;
  return literal;
}
function parseExclusive(policy){
  const exclusive=/(?:只|仅)(?:需|要|想)?(?:把|将|隐|遮|替换|处理|在(?:人名|姓名)上打码)|(?:其他|其余)(?:内容|信息)?(?:都|全部)?(?:原样保留|保留|照原样)/u.test(policy);
  if(!exclusive&&!policy.includes('收件人'))return null;
  const clauses=policy.split(/[，,。；;！!\n]/u).map(s=>s.trim()).filter(Boolean);
  const directives=new Map(),keeps=[],keptPeople=new Map();
  for(const c of clauses){
    if(/^(?:其他|其余)(?:内容|信息)?(?:都|全部)?(?:原样保留|保留|照原样)$/u.test(c))continue;
    if(supplemental(c,directives))continue;
    const person=recipientToKeep(c);
    if(person){keptPeople.set(person,c);continue;}
    const keys=masks(c);
    if(keys){for(const k of keys)directives.set(k,{mask:true,basis:c});continue;}
    const projectKeep=directives.has('项目')&&c.match(/^(版号|天数)(?:可以)?保留$/u);
    if(projectKeep){keeps.push(projectKeep[1]);continue;}
    const keep=c.match(/^(?:请)?(?:保留|留着|不要删掉|别删掉?|别改)(.+)$/u)||c.match(/^(.+?)(?:请|也要|也|都要|要|照|都|必须|原样|保持)?(?:保留|照原样写|照常写|留着|不变|原样)$/u);
    if(!keep||/仅|除了?|其中|部分|第一|最后|如果|仅限|单独|涉及/u.test(keep[1])||action.test(keep[1]))return null;
    // Never discard a literal or a named person's exception as incidental text.
    const ordinary=/^(?:(?:实际|采购|内部|对外|正常|员工|门店|公共|酒店|安装|拍摄|培训|施工|产品|验收本身需要的|运输|消毒|交货|发布|高铁票|快递|延期|质量|修复|故障|计划|客户|场地|交通|操作|其他|其余|原有|支出|预算){0,3}(?:金额|日期|时间|数量|工时|用时|工期|耗时|周期|成本|支出|垫付款|费用|费|报价|原因|内容|问题|现象|岗位名|地点|人名|预算|站点|距离|观察期|描述|安排|信息)|时间安排|打样费)$/u;
    const kept=keep[1].split(/以及|[和及与、]/u);
    if(!kept.every(s=>ordinary.test(s)||/^(?:(?:正常|计划)?(?:停用|操作|施工|运输|检测|检修|试运行)(?:时间|时长|周期|天数|用时)|读数|版号|押金|保证金)$/u.test(s)))return null;
    keeps.push(...kept);
  }
  if(!directives.size||(keptPeople.size&&!directives.has('人员')))return null;
  if(directives.has('delay')&&keeps.includes('天数'))return null;
  if(!exclusive&&(!keptPeople.size||directives.size!==1||keeps.length))return null;
  // A keep instruction referring to the same class may be an exception.
  const conflicts={price:/报价|价格|^金额$/,delay:/^(?:延期|延误)(?!原因)|^时长$/,budget:/预算|^金额$/,lodging:/住宿|^费用$|^金额$/,人员:/人名|姓名|收件人/,项目:/代号|项目名|版本名/,客户:/客户名|公司名|全称|简称/,客户全称:/公司名|全称/,客户简称:/简称/};
  for(const [key] of directives)if(keeps.some(k=>conflicts[key].test(k)))return null;
  return {directives,exclusive,keptPeople,retainedTerms:keeps};
}
// A section applies to the entire field selection only for a single explicit
// instruction. Multi-clause exceptions must retain their original wording.
function sectionPolicy(policy){
  const section='(正文|(?:写作)?提示词)';
  const place='(?:中|里|内)(?:的)?';
  const leading=new RegExp('^(?:请)?(?:只|仅)在'+section+place+'(.+)$','u');
  const embedded=new RegExp('^((?:请)?(?:只|仅)(?:把|将|隐去|隐藏|遮盖|遮|处理))'+section+place+'(.+)$','u');
  if(/[,，;；。！!\n]/u.test(policy.replace(/[。！!]$/u,'')))return null;
  const lead=policy.match(leading);
  if(lead)return {part:lead[1]==='正文'?'body':'prompt',instruction:'只'+lead[2]};
  const inner=policy.match(embedded);
  if(inner)return {part:inner[2]==='正文'?'body':'prompt',instruction:inner[1]+inner[3]};
  return null;
}
// Route complete, everyday requests for business values to the occurrence
// classifier. A date, section, named exception or other unconsumed qualifier
// must stay with the general reviewer.
const hideValue='(?:拿掉|去掉|抹掉|隐去|隐藏|遮(?:盖|掉|住)?|打码|删掉)';
function numericTarget(noun){
  const priceName='(?:成交前|对外|正式|含税|最终|整批)?(?:报价|售价|开价|价格)(?:的?(?:金额|数字|数值))?';
  const quote=new RegExp('^(?:(?:我们|我方|公司|业务)(?:已经|已)?|(?:已经|已))?(?:(?:报给|报向|给|对|向)([\\p{Script=Han}]{1,10})的)?('+priceName+')$','u').exec(noun);
  if(quote){
    const recipient=quote[1];
    // Quoted supplier costs and compound conditions are separate purposes.
    if(recipient&&/以及|除|只|仅|同时|或者|以外|之外|[或与及和、]|采购成本/u.test(recipient))return null;
    if(!recipient&&/^(?:价格|售价)(?:的?(?:金额|数字|数值))?$/u.test(noun))return null;
    return {key:'price',...(/已(?:经)?(?:报|给|向|对)/u.test(noun)?{issuedOnly:true}:{}),...(/成交前/u.test(noun)?{preDealOnly:true}:{}),
      ...(recipient&&!/^(?:客户|客人|买方)$/u.test(recipient)?{recipient}:{})};
  }
  const delay=/^(?:(实际(?:发生)?|已(?:经)?发生)的?)?(?:交付|交货|验收|上线|到货)?(?:延期|延误|推迟|延后|顺延)(?:的)?(?:时长|时间|天数|多久|多少天)?$/u.exec(noun);
  if(delay)return {key:'delay',actualOnly:!!delay[1]};
  if(/^(?:交付|交货|验收|到货|上线)比(?:承诺|约定|原定|原计划)(?:日期|时间)?晚(?:了)?的(?:时间|时长|天数)$/u.test(noun))return {key:'delay',actualOnly:true};
  return null;
}
const keepCategories=[
  ['cost',/^(?:备料|采购|材料|内部|进货)?成本$/u],
  ['duration',/^(?:正常|原定|计划|日常)?(?:维护|操作|配送|制作|保养|运输|施工|交付)?(?:需要的时间|耗时|工期|用时|时长|周期)$/u],
  ['other',/^(?:报销|垫付|垫付款|费用|支出|押金|预算)$/u],
  ['人员',/^(?:人员姓名|人名|姓名)$/u],
  ['schedule',/^(?:轮班|排班|班次|值班)安排$/u]
];
function parseNumericRequest(policy){
  const directives=new Map();
  let exclusive=false,keepJustStated=false;
  const lead=new RegExp('^(?:把|将)?'+hideValue+'(?:一下)?(.+)$','u');
  const tail=new RegExp('^(?:把|将)?(.+?)(?:全部|都)?'+hideValue+'(?:一下)?$','u');
  for(const clause of policy.split(/[，,。；;！!\n]/u).map(s=>s.trim()).filter(Boolean)){
    if(keepJustStated&&/^(?:接手人|财务|同事|我们|下班同事)(?:还)?(?:要|需要|得)用(?:它|这些)(?:核账|核对账目|排班|对账)$/u.test(clause))continue;
    keepJustStated=false;
    if(/^(?:其余|其他)(?:内容|信息)?(?:全部|都)?(?:原样保留|保留|照旧)$/u.test(clause)){exclusive=true;continue;}
    let s=clause.replace(/^(?:(?:这次|这份|这版|本次|我|请)\s*)+/u,'');
    const only=/^(?:只|仅)(?:需要|想要|需|要|想)?/u.exec(s);
    if(only){s=s.slice(only[0].length);exclusive=true;}
    const mask=lead.exec(s)||tail.exec(s);
    if(mask){
      for(const noun of mask[1].split(/以及|[、和与及]/u)){
        const target=numericTarget(noun);
        if(!target||directives.has(target.key))return null;
        const {key,...constraints}=target;
        directives.set(key,{mask:true,basis:clause,...constraints});
      }
      continue;
    }
    if(only)return null;
    const keep=/^(?:请)?(?:保留|留着)(.+)$/u.exec(s)||/^(.+?)(?:都|也)?(?:请|可以)?(?:照原样说|照原样留着|照留|原样保留|保留|留着|留给排班)$/u.exec(s);
    if(!keep)return null;
    for(const noun of keep[1].split(/以及|[、和与及]/u)){
      const key=keepCategories.find(([,pattern])=>pattern.test(noun))?.[0];
      if(!key||directives.get(key)?.mask)return null;
      directives.set(key,{mask:false,basis:clause});
    }
    keepJustStated=true;
  }
  return [...directives.values()].some(d=>d.mask)?{directives,exclusive}:null;
}
module.exports={parseExclusive,sectionPolicy,parseNumericRequest};
