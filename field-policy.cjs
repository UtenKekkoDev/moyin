'use strict';
// Accept complete, exclusive field instructions. Unconsumed qualifications,
// exceptions and single-section restrictions stay with the general reviewer.
const names=[
  ['price',/^(?:(?:发给|给|对)客户的?|客户|对外)?(?:最终|含税)?报价(?:的?金额)?$/u],
  ['delay',/^(?:实际|交付|验收|交货|上线)?延期(?:的?(?:时长|时间|天数))?$/u],
  ['budget',/^(?:活动|内部)?预算(?:的?金额)?$/u],
  ['lodging',/^(?:酒店)?住宿费(?:用)?(?:的?金额)?$/u],
  ['人员',/^(?:(?:所有|全部)?(?:员工|人员|个人|人)的?姓名|姓名|所有人名|人名)$/u],
  ['客户全称',/^客户(?:公司|企业)?全称$/u],
  ['客户简称',/^(?:客户(?:公司|企业)?)?简称$/u],
  ['客户',/^客户(?:公司|企业)?名称$/u],
  ['项目',/^(?:内部)?(?:项目|版本)(?:名称|名|代号|编号)$/u]
];
const both=/(?:Word\s*)?正文\s*(?:和|与|及|、)\s*(?:写作)?(?:提示词|要求)/gu;
const action=/隐去|隐藏|遮盖|遮掉|遮住|遮|匿名化|替换|换成|处理/u;
function field(text){return names.find(([,re])=>re.test(text))?.[0];}
const references=/^(?:两部分(?:中出现的|中的)?(?:都|也)(?:要)?(?:处理|检查|遮|替换)|两部分(?:都)?按(?:同一|这个)要求处理)$/u;
const sameCode=/^(?:全文和提示词里)?(?:两种(?:写法|叫法)|同一个人每次出现|给这家公司)(?:都)?(?:使用|共用|用)(?:同)?一个(?:客户|人员)?代号$/u;
function supplemental(clause,directives){
  if(!directives.size)return false;
  const normalized=clause.replace(both,'两部分');
  if(references.test(normalized)||sameCode.test(clause))return true;
  const repeated=normalized.match(/^(?:两部分|(?:写作)?提示词)(?:中出现的|中的|里的)(.+?)(?:都|也)要(?:遮|处理|替换)$/u)||clause.match(/^(?:如果)?没有(.+?)就(?:保留原文|照原样)$/u);
  if(repeated)return directives.has(field(repeated[1]));
  if(/^(?:包括|包含)(?:邮件)?收件人$|^人名用人员代号$/u.test(clause))return directives.has('人员');
  if(/^(?:包括|包含)写作提示词中的名称$|^(?:项目|版本)名称用项目代号$/u.test(clause))return directives.has('项目')||directives.has('客户');
  if(/^(?:包括|包含)全称和简称$/u.test(clause))return directives.has('客户');
  return false;
}
function masks(clause){
  let s=clause.replace(/^(?:请)?(?:只|仅)?(?:需|要)?(?:把|将)?/u,'');
  s=s.replace(both,'两部分').replace(/两部分(?:里|中)的?/gu,'');
  if(!action.test(s))return null;
  s=s.replace(/^(?:隐去|隐藏|遮盖|遮掉|遮住|遮|替换|处理)(?:掉|把)?/u,'')
    .replace(/(?:需要|也要|都要)?(?:匿名化|遮掉|隐去|隐藏|替换|换成)(?:(?:成|为)?(?:人员|客户|项目)?代号(?:占位符)?)?$/u,'')
    .replace(/用(?:人员|客户|项目)?代号$/u,'');
  const keys=s.split(/以及|[、及和与]/u).map(field);
  return keys.every(Boolean)?keys:null;
}
function parseExclusive(policy){
  if(!/(?:只|仅)(?:需|要|想)?(?:把|将|隐|遮|替换|处理)|(?:其他|其余)(?:内容|信息)?(?:都|全部)?保留/u.test(policy))return null;
  const clauses=policy.split(/[，,。；;！!\n]/u).map(s=>s.trim()).filter(Boolean);
  const directives=new Map(),keeps=[];
  for(const c of clauses){
    if(supplemental(c,directives))continue;
    const keys=masks(c);
    if(keys){for(const k of keys)directives.set(k,{mask:true,basis:c});continue;}
    const keep=c.match(/^(?:请)?(?:保留|不要删掉|别改)(.+)$/u)||c.match(/^(.+?)(?:请|也要|也|都要|照|都|必须|原样|保持)?(?:保留|照原样写|照常写|留着|不变|原样)$/u);
    if(!keep||/仅|除了?|其中|部分|第一|最后|如果|仅限|单独|涉及/u.test(keep[1])||action.test(keep[1]))return null;
    // Never discard a literal or a named person's exception as incidental text.
    const ordinary=/^(?:(?:实际|采购|内部|对外|正常|员工|门店|公共|酒店|安装|拍摄|培训|施工|产品|验收本身需要的|运输|消毒|交货|发布|高铁票|快递|延期|质量|修复|故障|计划|客户|场地|交通|操作|其他|其余|原有|支出|预算){0,3}(?:金额|日期|时间|数量|工时|用时|工期|耗时|周期|成本|支出|垫付款|费用|费|报价|原因|内容|问题|现象|岗位名|地点|人名|预算|站点|距离|观察期|描述|安排|信息)|时间安排|打样费)$/u;
    const kept=keep[1].split(/以及|[和及与、]/u);
    if(!kept.every(s=>ordinary.test(s)))return null;
    keeps.push(...kept);
  }
  if(!directives.size)return null;
  // A keep instruction referring to the same class may be an exception.
  const conflicts={price:/报价|价格|^金额$/,delay:/^(?:延期|延误)(?!原因)|^时长$/,budget:/预算|^金额$/,lodging:/住宿|^费用$|^金额$/,人员:/人名|姓名|收件人/,项目:/代号|项目名|版本名/,客户:/客户名|公司名|全称|简称/,客户全称:/公司名|全称/,客户简称:/简称/};
  for(const [key] of directives)if(keeps.some(k=>conflicts[key].test(k)))return null;
  return {directives,exclusive:true};
}
module.exports={parseExclusive};
