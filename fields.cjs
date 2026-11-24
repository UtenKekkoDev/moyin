'use strict';

// Only use the value-level path when every directive can be understood.
// Conditions, narrative redactions and unrelated fields retain the general model path.
const policyTerms = [
  ['price', /(?:对外|对客户|对客|给客户|客户)?(?:给出)?的?(?:报价|开价|价钱)(?:区间|金额|数值)?/gy],
  ['supplierPrice', /(?:供应商|供方|供货方|上游|厂家)(?:给(?:我们|我方)的|的)?报价(?:金额)?/gy],
  ['delay', /(?:验收|交付|交货|项目|排期)?(?:延期|延误|延后|推迟|推后|顺延|延迟|拖期)(?:了)?(?:的)?(?:多久|多少天|天数|时间|时长|周期)?/gy],
  ['cost', /(?:采购|核算|内部)?成本|材料费/gy],
  ['other', /预算|(?:员工|个人|差旅)?垫付(?:款|金|的金额)?/gy],
  ['duration', /(?:正常|原定|计划|测试)?(?:工期|耗时|用时)/gy]
];
const verbs = /不要隐去|不要隐藏|不要遮盖|不隐去|不隐藏|不遮盖|维持原文|照原样写|原样保留|保持原样|原样写|保留|隐去|隐藏|遮盖|遮住|遮掉|隐掉|遮蔽|遮/g;
function parseFields(policy){
  const directives=new Map();
  let exclusive=false;
  const clauses=policy.split(/[，,。；;！!\n]|(?:、|并且|并|同时)(?=(?:请|只|仅)?(?:保留|隐去|隐藏|遮盖|遮住|遮掉|维持原文))/u);
  for(const part of clauses.map(s=>s.trim()).filter(Boolean)){
    if(/^(?:其余|其他|其它)(?:全部|都)?(?:保留|原样保留|维持原文)$/.test(part)){exclusive=true;continue;}
    const actions=[...part.matchAll(verbs)];
    if(actions.length!==1)return null;
    const action=actions[0][0];
    const mask=/^(?:隐去|隐藏|遮盖|遮住|遮掉|隐掉|遮蔽|遮)$/.test(action);
    let rest=part.slice(0,actions[0].index)+part.slice(actions[0].index+action.length);
    if(/(?:只|仅)/.test(rest)){
      if(!mask)return null;
      exclusive=true;
    }
    rest=rest.replace(/(?:另外|额外|请|把|将|只|仅|都|原样|照常|全部|[ \t])/gu,'');
    const targets=rest.split(/(?:以及|和|与|及|、)/u);
    for(const target of targets){
      const pair=policyTerms.find(([,rx])=>{
        rx.lastIndex=0;const hit=rx.exec(target);return hit&&hit[0]===target;
      });
      if(!pair)return null;
      const role=pair[0];
      if(mask&&role!=='price'&&role!=='supplierPrice'&&role!=='delay')return null;
      if(directives.has(role)&&directives.get(role).mask!==mask)return null;
      directives.set(role,{mask,basis:part});
    }
  }
  if(![...directives.values()].some(d=>d.mask))return null;
  return {directives,exclusive};
}

const number='(?:\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万亿点壹贰叁肆伍陆柒捌玖拾佰仟萬億]+|半)';
const gap='[ \\t]*',range=gap+'(?:到|至|[-–—~～])'+gap;
const prefix='(?:人民币|港元|港币|美元|欧元|英镑|日元|RMB|CNY|USD|EUR|HKD|[¥￥$€£])';
const moneyUnit='(?:[十百千万亿萬億]'+gap+')?(?:元人民币|人民币|元整(?!理|改|合|顿|备)|美元|美金|港元|欧元|英镑|日元|元|块钱|USD|CNY|RMB|EUR|HKD)';
const timeUnit='(?:个?'+gap+'(?:半月|工作日|自然日|日历日|星期|礼拜|月|季度|小时|钟头)|天|周|日)';
// At least one endpoint must carry a currency or duration unit.
function valuePattern(unit,lead=''){
  const numberWithPrefix=lead?'(?:'+lead+gap+')?'+number:number;
  const qualified=numberWithPrefix+gap+unit+(lead?'':'(?:半)?');
  const bare=lead?lead+gap+number+'(?:'+gap+'[千萬万亿億kK])?':number;
  const single=lead?'(?:'+qualified+'|'+bare+')':qualified;
  return new RegExp('(?:'+single+'|'+numberWithPrefix+')'+range+single+'|'+single,'giu');
}
const tokens={money:valuePattern(moneyUnit,prefix),time:valuePattern(timeUnit)};
const compactMoney=new RegExp(number+gap+'(?:[千萬万亿億]|[kKwW](?![a-zA-Z]))','gu');
const numericCell=new RegExp('^'+number+'(?:'+range+number+')?$','u');
const bareField=new RegExp('(报价(?:金额)?|采购成本|预算|延期天数|延误天数)'+gap+'(?:[（(][^()（）\\n]{1,8}[)）])?'+gap+'[=:：＝]'+gap+'('+number+'(?:'+range+number+')?)'+gap+'(?=$|[，,。；;|｜\\t\\n])','gu');
const calendar=/\d{1,4}\s*(?:年\s*\d{1,2}\s*)?月\s*\d{1,2}\s*[日号]?|(?:延[期后]至|推迟到|顺延至|下月|本月)\s*\d{1,2}\s*[日号]/gu;
// A position on a schedule (第二天、第 3 个工作日) is not an elapsed
// duration. Leave “逾期第三天” available for the ordinary role check.
const ordinalDay=/第\s*(?:\d+|[零〇一二三四五六七八九十百千两]+)\s*(?:个\s*)?(?:工作日|自然日|日历日|天|日|周)/gu;
const transactionNoun=/(?:包装回收|包装|修模|清洗|打样|打孔|加工|安装|搬运|装卸|停车|过路|快递)(?:收费|费用?)|打样预算|借款|还款|退款|订金|定金/u;
const otherMoneyTerms=/对外(?:报(?:价|了)?|给价)|报给|报了|报多少|报价|开价|要价|售价|对客价|客户价|(?:客户|买方|采购方)的(?:总价|最终价)|底价|成本|预算|支出|利润|回款|采购(?:价|入账)|进货价|进价|余额|(?:代垫|先垫|垫付)[款金]?|垫了|垫款|尾款|货款(?:余额)?|运输费|运费|押金|保证金|预[收付](?:款|金)?|材料费|物料(?:费|款|那边)|报销[款额]?/u;
const moneyRole=new RegExp(transactionNoun.source+'|'+otherMoneyTerms.source,'gu');
const adjacentAmountLabel=new RegExp('^(?:的|为|是|属于|系)?((?:正式|含税|对外|客户|采购|内部|员工)?(?:报价|押金|保证金|垫付款?|底价|成本|采购价|进货价|进价|货款|运费)|'+transactionNoun.source+')','u');
const supplierAsSender=/(?<!给|向|对)(?:供应商|供货方|供方|上游|厂家|工厂)(?:(?:发|报|回)?给(?:我们|我方|我司|采购)(?:的)?|回(?:我们|我方|我)的|发来的|给出的|的)?(?:采购)?$/u;
const delayWord=/延期|延误|延迟|延后|推迟|推后|顺延|拖期|滞后|推延|晚点|往后挪|晚/u;
const durationWord=/耗时|用时|用去|用掉|工期|历时|持续|培训|试运行|停用|停机|提前|各用|各需|原需|仍需|原定用时|预留|(?:更换|检修|测试|联调|排查|复核|演练|备货)(?:原本|正常|通常|预计|还)?(?:排了?|占用?|需要?|得用|要|用)/u;
const timeRole=new RegExp(delayWord.source+'|'+durationWord.source,'gu');
// A work activity and its measurement can sit beside a separate late delivery.
// Match only a complete local activity phrase; preserve explicit delay modifiers.
const workDuration=/(?:工时|清洁|标定|校准|焊接|点焊|焊板|弯管|改线|打磨|装配|烘干|运输|打包|清洗|检测|安装|调试|布线|检修|加工|清点|试验|试水|压边|重新编号)(?:本身|实际)?(?:所需|需要|所用|用了|花了|做了|耗时|历时)?(?:的)?\s*$/u;
// Keep the forecast attached to its own predicate, even when the outcome
// later in the same sentence contains the identical number of days.
const forecastDelay=/(?:本以为|原以为|一度以为|曾以为|担心|预估|预计|预测|估计|预判|判断|有可能|可能|假如|假设)(?:赶工|交付|归还|交货|交件|进度|工期)?(?:将会|可能会|可能|会|要|将|得)?(?:比(?:合同|原定|原计划|约定|承诺)(?:时点|日期|时间)?)?(?:延期|延误|耽误|延后|推迟|顺延|逾期|超期|迟交|晚交|晚到|晚点|晚还|迟到|迟|晚|慢)(?:交货|交付|到货|归还|返还)?(?:了|的)?\s*$/u;
function roleOf(text,family){
  const all=[...text.matchAll(family==='money'?moneyRole:timeRole)];
  if(!all.length)return null;
  const match=all.at(-1);
  if(text.length-match.index-match[0].length>14)return null;
  const name=match[0];
  if(family==='money'){
    const before=text.slice(0,match.index);
    if((name==='报价'||name==='报了')&&supplierAsSender.test(before))return 'supplierPrice';
    if(transactionNoun.test(name))return 'other';
    if(name==='底价')return /(?:对外|(?:报给|给|向|对)(?:客户|买方|门店))(?:的|报的|报出的)?$/u.test(before)?'price':'cost';
  }
  if(family==='money')return /成本|采购(?:价|入账)|进货?价|材料费|物料/.test(name)?'cost':/预算|支出|利润|回款|余额|垫|尾款|货款|费|押金|保证金|报销|预收|预付/.test(name)?'other':'price';
  return durationWord.test(name)?'duration':'delay';
}
// Inspect the transaction immediately governing this number. A supplier can
// also be the recipient of our quote, so its name alone is insufficient.
const directionalQuote=/(?:(供应商|供货方|供方|厂家|工厂|上游|我们|我方|本司|我司|销售|业务员)(?:这次)?(?:给|向|对)[\p{Script=Han}]{1,8}?)报(?:价|了|出|的是)?(?:为|是)?(?:每[个只条件套批台把张盒])?\s*$/u;
const purchaseRecord=/(?:采购单|进货单|入库单|采购发票|供应商发票)(?:中|里|上)?(?:注明|记载|写着|列明|列的|登记的|记录的)?(?:采购)?(?:单价|价格|金额)?(?:为|是|[:：])?(?:每[个只条件套批台把张盒])?\s*$/u;
const paidAmount=/(?:已付|先付|支付|实付|另付|已收|实收|到账|汇入|转入|垫付|收取|退回|付了|收了|打款)(?:了|的)?(?:共计|合计|总计|共|为|是)?\s*$/u;
const installment=/(?:第[一二三四五六七八九十\d]+笔|首笔|首期|二期|末期)?(?:工程款|进度款|合同款|预付款)(?:项)?(?:共计|合计|为|是)?\s*$/u;
function writingAmount(left,right,prior){
  // An outgoing quotation may name the work between the reporting verb and
  // its value ("报的是整批拆装"). Do not absorb a second price or an expense.
  const offer=/(?:我们|我方|本司|我司|销售|业务员)(?:已经|已)?(?:给|向|对)[\p{Script=Han}]{1,10}?报(?:的(?:是|为)|了)([\p{Script=Han}]{0,9})\s*$/u.exec(left);
  if(offer&&!/另|及|和|与|采购|成本|费用|押金|预算|返款|报销|结算|未|没有|并非/u.test(offer[1]))return 'price';
  if(/(?:出租车费|交通费|报销费用?|搬运费|快递费)(?:共计|合计|总计|共|为|是)?\s*$/u.test(left))return 'other';
  // A unit-only continuation inherits the immediately preceding incoming
  // quote, not a supplier mentioned elsewhere in the document.
  if(/^\s*每[件个套只箱台张批份支包]\s*$/u.test(left)&&
    /(?:供货商|供应商|配件商|厂商|上游|厂家|供方)[\p{Script=Han}]{0,9}(?:向|给)(?:我们|我方|我司|采购)报(?:过|出|了)?[^，,。；;！？]{0,16}(?:价|报价)$/u.test(prior||''))return 'supplierPrice';
  // Read a single noun phrase terminating in 报价. A conjunction or
  // negation can introduce a different figure instead.
  const namedQuote=/^(的|写成|标为|列为)((?:给[\p{Script=Han}]{1,8}的)?[\p{Script=Han}]{0,6}?报价)/u.exec(right);
  if(namedQuote&&!/[不未非和与及或]/u.test(namedQuote[2])&&!/(?:不要|别|不能)(?:把|将)?\s*$/u.test(left)){
    const stated=roleOf(left,'money');
    if(!stated||/[和与及、]\s*$/u.test(left)){
      if(/^(?:供应商|供方|上游|厂家)(?:的|给出的)/u.test(namedQuote[2]))return 'supplierPrice';
      return roleOf(namedQuote[2],'money');
    }
  }
  const quote=directionalQuote.exec(left);
  if(quote)return /^(?:供应商|供货方|供方|厂家|工厂|上游)$/u.test(quote[1])?'supplierPrice':'price';
  if(purchaseRecord.test(left))return 'cost';
  if(paidAmount.test(left)||installment.test(left))return 'other';
  if(/^(?:的)?(?:已付|已收|实付|实收)(?:货款|工程款|合同款)/u.test(right)&&!roleOf(left,'money'))return 'other';
  // “把120元标成进货价” explicitly assigns the amount a local role.
  // Only match positive assignments; “不能算作成本” is not evidence of cost.
  const assigned=/^\s*(?:写成|标成|标为|列作|列为|记作|记为|算作|作为|用于核算|核算)((?:给[\p{Script=Han}]{1,8}的|内部|采购|对外|客户|对客)?(?:底价|成本|采购价|进货价|进价|货款|报价))/u.exec(right);
  if(assigned&&!/(?:别|不(?:要|能|应|可|必)?|未)(?:把|将|用|按|以)?\s*$/u.test(left)){
    const stated=roleOf(left,'money');
    // “客户报价120元用于核算成本” already identifies the original value.
    return stated||roleOf(assigned[1],'money');
  }
  // A bare supplier reply establishes an incoming amount, but not necessarily
  // a quoted price (it might be a refund or an advance).
  if(/(?:供应商|供货方|供方|上游|厂家|工厂)(?:发|回)?给(?:我们|我方|我司|采购)的(?:也?[是为])?\s*$/u.test(left))return /^(?:的)?报价/u.test(right)?'supplierPrice':'other';
  if(/(?:供应商|供货方|供方|上游|厂家|工厂)报给(?:我们|我方|我司|采购)的(?:也?[是为])?\s*$/u.test(left))return 'supplierPrice';
  if(/(?:用|按|以|把|将)\s*$/u.test(left)){
    const writing=right.match(/^\s*(?:来)?(?:给[\p{Script=Han}]{1,8}?)?(?:撰写|起草|拟定|拟写|写成|写|拟|出具)(?:(?:一)?[份个张段封])?((?:[\p{Script=Han}]{1,8}的|供应商|供货方|供方|上游|厂家|对外|对客|客户|门店)?报价)(?:说明|回复|确认|单|函|邮件)/u);
    if(writing&&!/不|未|别|非|而|再|以及|[和与]/u.test(writing[1])){
      if(/(?:不要|别|不能|禁止|切勿|不应|不再|没有|没|未)(?:再)?(?:用|按|以|把|将)\s*$/u.test(left))return 'other';
      return roleOf(writing[1],'money');
    }
  }
  // An instruction can name the document first, then select the amount by
  // its addressee. Restrict inheritance to this adjacent quote-writing clause.
  if(/(?:把|将)(?:对|给|报给)[\p{Script=Han}]{1,8}的\s*$/u.test(left)&&
     /^(?:列入|列在|填入|填在|写入|写在)/u.test(right)&&
     /(?:写|拟|起草)(?:(?:一)?[份封张])?(?:客户|对外|对客)?报价(?:确认|说明|回复|单|函)\s*$/u.test(prior||'')&&
     !/(?:未|不要|别|不必|不用)(?:写|拟|起草)/u.test(prior))return 'price';
  return null;
}
function contextRole(line,offset,length,family,header,priorTimeEnd){
  const clauses=line.slice(0,offset).split(/[，,；;。！？|｜\t]/u);
  let left=clauses.at(-1);
  if(family==='money'){
    const writing=writingAmount(left,line.slice(offset+length),clauses.at(-2));
    if(writing)return writing;
  }
  if(family==='time'&&priorTimeEnd!==undefined){
    // “晚还四小时和标定四小时” names a new activity. A bare list such as
    // “顺延两天和三天” still shares its original predicate.
    const gap=line.slice(priorTimeEnd,offset);
    const coordinated=/^\s*(?:、|以及|还有|并列出?|和|与|及)\s*(.+)$/u.exec(gap);
    if(coordinated&&!/[，,。；;！？|｜\t]/u.test(gap)){
      left=coordinated[1].trim();
    }
  }
  if(family==='time'){
    if(/(?:通常|平常|正常|常规|原定)[^，,。；;！？]{0,28}(?:运输|配送|装车|送抵|送达|交接|装卸)(?:本来|一般|通常)?(?:需要|需|用时|耗时)\s*$/u.test(left)&&!delayWord.test(left))return 'duration';
    // Time recovered from an earlier estimate measures progress, not the
    // remaining gap to the due date. Classify only the recovery verb's object.
    if(/(?:追回|挽回|赶回|抢回|追回来|赶回来|追回去)(?:了|的)?(?:工期|进度|时间)?\s*$/u.test(left))return 'recovered';
    if(forecastDelay.test(left)){
      const after=line.slice(offset+length);
      // An immediate correction of this forecast confirms it did not occur.
      // A new subject after the comma may describe another shipment.
      if(/^\s*[，,；;]\s*(?:但|不过|然而)?(?:最终|最后|实际(?:上)?|结果)(?:仍然|还是|仍|却)?(?:如期|按时|按期|没有延期|并未延期|未曾延期)/u.test(after))return 'negated';
      return 'forecast';
    }
    // Attach a duration to the immediately preceding delivery predicate.
    // A later process verb can give the same number a different use.
    const late=/(?:(?:逾期|超期)(?:归还|签收|返还|交付|交货|交件)?|(?:超过|超出)(?:借用|归还|交货|交付|验收)?(?:期限|截止点|截止时间|合同期限)|(?:延迟|迟|晚)(?:交|还|寄|开(?:风|机|门|工|会))|(?:归还|交还|交回|退还)(没有|并非|不是|没|未|不)?慢|比(?:原定|约定|原约|承诺|确认单|预定时间)(?:时间|日期)?迟)(?:了)?(?:的)?\s*$/u.exec(left);
    if(late){
      const prefix=left.slice(0,late.index);
      // In “每晚开机两小时”, 晚 names a time of day.
      if(late[0].startsWith('晚开')&&/(?:每|今|昨|明|当|前|傍|早|那|这|整|一|周[一二三四五六日]|星期[一二三四五六日天])$/u.test(prefix))return null;
      const negated=/(?:没有|并非|不是|不曾|未曾|不会|没|未|不)(?:发生)?$/u.test(prefix);
      if(late[1]||(negated&&!/(?:不得不|不能不|并非没有|不是没有)$/u.test(prefix)))return 'negated';
      return 'delay';
    }
    if(workDuration.test(left)&&!delayWord.test(left)&&!/比|超出|迟|没|未|不/u.test(left))return 'duration';
  }
  if(family==='money'&&/^(?:是|为|的)?(?:进货|采购)单价/u.test(line.slice(offset+length))&&
     !roleOf(left,'money'))return 'cost';
  const role=roleOf(left,family);
  if(family==='money'&&(!role||/[和与及、](?:第[一二三四五六七八九十\d]+(?:款|件|项|笔)(?:的)?)?\s*$/u.test(left))){
    // In “700元押金与700元报价”, each adjoining noun labels its own value.
    const label=line.slice(offset+length).match(adjacentAmountLabel);
    if(label)return roleOf(label[1],family);
  }
  if(role)return role;
  const right=line.slice(offset+length).split(/[，,；;。！？|｜\t]/u)[0];
  if(/^(?:的|为|是|属于|系|用于|才是)/.test(right)){
    const rightRole=roleOf(right.slice(0,12),family);
    if(rightRole)return rightRole;
  }
  return header?roleOf(header,family):null;
}
function values(sources,{separateSupplierQuotes=false}={}){
  const found=[];
  for(const [part,text] of Object.entries(sources)){
    let start=0,headers=null,previous='';
    for(const line of text.split('\n')){
      const cells=line.split(/[|｜\t]/u);
      const dates=[...line.matchAll(calendar)];
      for(const ordinal of line.matchAll(ordinalDay)){
        const prefix=line.slice(Math.max(0,ordinal.index-12),ordinal.index);
        if(!/(?:延期|逾期|超期|延误)(?:已(?:经)?|的|进入|到了|已到)?\s*$/u.test(prefix))dates.push(ordinal);
      }
      const rowValues=[];
      function add(family,index,value,role,header){
        if(role==='supplierPrice'&&!separateSupplierQuotes)role='cost';
        const left=start+index,right=left+value.length;
        const before=line.slice(0,index).split(/[，；;。！？|｜\t]/u).at(-1);
        const after=line.slice(index+value.length).split(/[，；;。！？|｜\t]/u)[0];
        rowValues.push({part,family,role,start:left,end:right,value,
          context:before.slice(-96)+'〔'+value+'〕'+after.slice(0,72),header});
      }
      for(const [family,re] of [...Object.entries(tokens),['money',compactMoney]]){
        let priorTimeEnd;
        for(const hit of line.matchAll(re)){
          const end=hit.index+hit[0].length;
          if(family==='time'&&dates.some(d=>d.index<end&&hit.index<d.index+d[0].length))continue;
          if(family==='money'&&/^[十百千万億亿萬]?\s*(?:元|元人民币)$/.test(hit[0])&&/[（([]\s*$/.test(line.slice(0,hit.index)))continue;
          if(rowValues.some(v=>v.start<start+end&&start+hit.index<v.end))continue;
          const column=line.slice(0,hit.index).split(/[|｜\t]/u).length-1;
          const header=headers&&cells.length===headers.length?headers[column]:null;
          let role=contextRole(line,hit.index,hit[0].length,family,header,priorTimeEnd);
          if(family==='time')priorTimeEnd=end;
          if(!role&&/(?:问|[？?]|多少|多久)/u.test(previous)&&/^\s*(?:(?:[Aa答]|回答|回复|答复|预计)[：:\s]*)?$/u.test(line.slice(0,hit.index))){
            role=roleOf(previous,family);
          }
          if(re===compactMoney&&(!role||/^(?:天|日|周|件|台|套|人|小时)/.test(line.slice(end).trimStart())))continue;
          add(family,hit.index,hit[0],role,header);
        }
      }
      if(headers&&headers.length===cells.length){
        let index=0;
        for(const [col,cell] of cells.entries()){
          const value=cell.trim(),at=index+cell.indexOf(value),header=headers[col];
          const family=roleOf(header,'money')?'money':roleOf(header,'time')?'time':null;
          if(family&&numericCell.test(value)&&!rowValues.some(v=>v.start<=start+at&&v.end>=start+at+value.length)){
            add(family,at,value,roleOf(header,family),header);
          }
          index+=cell.length+1;
        }
      }
      for(const m of line.matchAll(bareField)){
        const index=m.index+m[0].lastIndexOf(m[2]),left=start+index;
        if(rowValues.some(v=>v.start<left+m[2].length&&left<v.end))continue;
        const family=/天数$/.test(m[1])?'time':'money';
        add(family,index,m[2],roleOf(m[1],family),null);
      }
      found.push(...rowValues);
      if(cells.length<2)headers=null;
      else if(!rowValues.length&&cells.some(c=>roleOf(c,'money')||roleOf(c,'time')))headers=cells;
      previous=line;start+=line.length+1;
    }
  }
  return found;
}
function fieldCandidates(sources,spec){
  const candidates=values(sources,{separateSupplierQuotes:spec.directives.has('supplierPrice')});
  const delayBasis=spec.directives.get('delay')?.basis||'';
  const actualOnly=spec.directives.get('delay')?.actualOnly||/(?:实际(?:发生)?|已经发生|已发生)(?:的)?延期/u.test(delayBasis);
  for(const c of candidates){
    if(c.role==='forecast'&&!actualOnly)c.role='delay';
    if(actualOnly&&c.family==='time'){
      const source=sources[c.part];
      const before=source.slice(Math.max(0,c.start-24),c.start),right=source.slice(c.end,c.end+24);
      // Nominal references (“原先预估的三天”) give no evidence of actual
      // slippage. Do not apply this to a different occurrence of the value.
      if(/(?:原先|之前|先前|原来|起初|曾经|当时|此前|原)(?:所)?(?:预计|预估|预判|担心|估算|估计|以为)的\s*$/u.test(before)||
         /^(?:只是|仅是|仅为|只作|只是指|是|为)(?:原先|当时|起初|先前|此前|原来|之前|原)(?:的)?(?:估算|估计|预判|预估|预计|担心)/u.test(right))c.role='forecast';
    }
    if(c.family!=='money'||(!spec.directives.has('budget')&&!spec.directives.has('lodging')))continue;
    const label=c.context.split('〔')[0];
    const named=/(预算|住宿费)(?:用|金额)?(?:总计|合计|共计|为|是|共|约|[:：])?\s*$/u.exec(label)
      ||/^(预算|住宿费)(?:用|金额)?$/u.exec(c.header||'');
    if(named)c.role=named[1]==='预算'?'budget':'lodging';
  }
  // Resolve a bare demonstrative in the prompt only when every matching
  // body occurrence has the same known use. Keep explicit new purposes local.
  const bodyTimeRoles=new Map();
  for(const c of candidates){
    if(c.family!=='time'||c.part!=='body')continue;
    if(!bodyTimeRoles.has(c.value))bodyTimeRoles.set(c.value,c.role);
    else if(bodyTimeRoles.get(c.value)!==c.role)bodyTimeRoles.set(c.value,null);
  }
  for(const c of candidates){
    if(c.family!=='time'||c.part!=='prompt'||c.role)continue;
    const left=sources.prompt.slice(Math.max(0,c.start-16),c.start),right=sources.prompt.slice(c.end);
    if(/(?:解释|说明|交代|提及|写明|写清|写一下|说一下)(?:一下)?这\s*$/u.test(left)&&/^\s*(?:[。！？；;，,]|$)/u.test(right)){
      c.role=bodyTimeRoles.get(c.value)||null;
    }
  }
  return candidates;
}

// Check restrictions against this transaction. Equal numbers elsewhere in a
// file do not establish either its recipient or its transmission status.
function limitedQuote(c,source,directive){
  let left=source.slice(0,c.start).split(/[，,。；;！？\n|｜\t]/u).at(-1);
  left=left.split(/以及|而|另(?:外)?(?=给|向)|[和与](?=(?:我们|我方|给|向|发给|报给|对))/u).at(-1);
  const right=source.slice(c.end).split(/[，,。；;！？\n|｜\t]|[和与及](?=给|向|[\d￥¥])/u)[0];
  const phrase=left+'〔金额〕'+right;
  if(directive.preDealOnly&&(/(?:成交|签约|中标)(?:之|以)?后|(?:最终|实际)(?:结算|收款|付款)/u.test(left)||
    /^(?:是|为|属(?:于)?|的)(?:成交后|签约后|最终结算|实际收付)/u.test(right)))return 'other';
  if(directive.issuedOnly){
    if(/(?:未|没有|尚未|还没|暂未)(?:正式)?(?:对外)?(?:报价|报出|报给|发给|发送|发出|寄出|送达)|(?:拟报|拟给|准备报|打算报|报价草案|报价草稿|预拟报价|内部测算)|(?:准备|计划|打算|拟|将)(?:发给|寄给|报给|送达)/u.test(phrase))return 'other';
    if(!/(?:已(?:经)?(?:向|对|给)?[^〔〕，。]{0,12}(?:报|发|寄|送)|报了|报的是|报给|发给|寄给|送达|收到(?:的|我方|我们)|(?:已|正式)(?:对外)?报出)/u.test(phrase))return 'unknown';
  }
  if(directive.recipient){
    const name=directive.recipient.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const destination=new RegExp('(?:给|向|对|面向)'+name+'(?:的|报|发|寄|开|送|出具|提供|回复|确认|[：:])|'+name+'(?:已(?:经)?)?(?:收到|拿到)(?:的|我方|我们)|'+name+'的(?:对客|销售)?(?:报价|售价)','u');
    if(!destination.test(phrase))return /(?:给|向|对)[\p{Script=Han}]{1,12}(?:的(?:整批|整场|本次)?报价|报(?:了|的是|价))|(?:发给|报给|寄给)[\p{Script=Han}]{1,12}的/u.test(phrase)?'other':'unknown';
  }
  return 'price';
}

async function fieldMatches(sources,rows,spec,policy,generate,progress,referenceBody=sources.body){
  const candidates=fieldCandidates(sources,spec);
  // Keep explicit declarations and user vocabulary authoritative. Model-only
  // entity guesses can be superseded by a value with clear field semantics.
  const guesses=new Map();
  for(const r of rows.filter(r=>r.origin==='本地模型'||r.origin==='提示词人名补查')){
    const context=sources[r.part].slice(Math.max(0,r.start-18),r.start);
    if(/(?:代号|项目名(?:称)?|简称|全称|名为|叫作|称作)[为是：:“「"\s]*$/u.test(context))continue;
    guesses.set(r.part+':'+r.start+':'+r.end,r);
    const calendarValue=new RegExp('^(?:'+calendar.source+')$','u').test(r.value);
    const following=sources[r.part].slice(r.end,r.end+35);
    const fieldLabel=/^(?:本次|对外|对客|采购|预计|员工|正常|计划|测试)?(?:报价|开价|要价|售价|(?:代垫|先垫|垫付)[款金]?|垫款|尾款|货款余额|运输费|运费|押金|保证金|成本|工期|耗时|用时|交付|交货|验收|出货|上线)$/u.test(r.value);
    const usedAsLabel=(fieldLabel&&(/^\s*(?:$|[|｜（(：:＝=¥￥€$]|\d|[一二三四五六七八九十])/.test(following)||/^(?:将|要|未|已|仍|预计|暂定)?(?:延期|顺延|推迟|延后|推后|如期)/u.test(following)||
      following.startsWith('\n')))||(/^对[客外]$/u.test(r.value)&&/^报价/u.test(following));
    if((calendarValue&&/(?:延[期后]至|顺延至|推迟到|定于|交付日期[：:])\s*$/.test(context))||
       ((usedAsLabel||/^(客户|报价|成本|工期|延期)$/.test(r.value))&&!r.owner)){
      r.suggest=false;r.uncertain=true;
    }
  }
  const unclear=candidates.filter(c=>!c.role);
  const bodyEvidence=(referenceBody||'').split(/[。；;！？\n]/u).filter(Boolean);
  for(let i=0;i<unclear.length;){
    progress('本地模型正在核对金额和时长在本句中的用途…');
    // A neighbouring candidate changing role must not change this duration's
    // prompt. Keep adjacent monetary items in batches to limit local latency.
    const time=unclear[i].family==='time';
    let end=i+1;
    while(!time&&end<unclear.length&&end<i+12&&unclear[end].family!=='time')end++;
    const batch=unclear.slice(i,end),data={},properties={};
    i=end;
    batch.forEach((c,j)=>{
      data[j+1]={来源:c.part==='prompt'?'写作提示词':'正文',原句:c.context,表头:c.header};
      const refersToBody=sources.body!==undefined||/(?:这|上述|前述)(?:段|笔)?\s*〔/u.test(c.context);
      if(time&&c.part==='prompt'&&refersToBody&&bodyEvidence.length){
        const evidence=bodyEvidence.filter(line=>line.includes(c.value)).slice(0,4).map(line=>{
          const pos=line.indexOf(c.value);
          return line.slice(Math.max(0,pos-72),pos+c.value.length+72);
        });
        if(evidence.length)data[j+1].正文线索=evidence;
      }
      properties[j+1]={type:'string',enum:c.family==='time'?['延期','一般时长','不确定']:['客户报价','采购成本','其他金额','不确定']};
    });
    const instruction=time?'只判〔〕内时长所衡量的事件。从原承诺的时点到实际交付的差额，判“延期”；从开始加工、运输、等待到完成的历时，判“一般时长”。句里提到别的事件晚了，不改变本处的用途。写作提示词省略事件时按正文线索匹配动作。无法确定所指事件选“不确定”。'
      :'逐项判断〔〕里这个数值在本处的业务用途。延期是比原计划延后，正常用时或提前属于一般时长。对客户的销售价格才属于客户报价，垫付款、材料费或财务往来按其自身用途判断。独立阅读每一处；证据不足选“不确定”。';
    const raw=await generate(instruction,JSON.stringify({位置:data}),{type:'object',properties,required:Object.keys(properties),additionalProperties:false});
    for(const [j,c] of batch.entries())c.role=({'延期':'delay','一般时长':'duration','客户报价':'price','采购成本':'cost','其他金额':'other'})[raw[j+1]]||'unknown';
  }
  const price=spec.directives.get('price');
  if(price?.recipient||price?.issuedOnly||price?.preDealOnly){
    for(const c of candidates)if(c.role==='price')c.role=limitedQuote(c,sources[c.part],price);
  }
  const matches=[];
  const targeted=new Set(candidates.filter(c=>spec.directives.get(c.role)?.mask).map(c=>c.value));
  // Remove wider entity guesses for an action plus a measured value (e.g.
  // “测试排三日”). Never demote a named project or a dictionary entry by overlap alone.
  const endingAt=new Map(candidates.map(c=>[c.part+':'+c.end,c]));
  // A model can extract only the digits from a complete currency or duration.
  // Ground containment in source offsets so an identical project ID elsewhere
  // retains its own decision.
  const valueEnds={};
  for(const [part,source] of Object.entries(sources))valueEnds[part]=new Uint32Array(source.length);
  for(const c of candidates)valueEnds[c.part].fill(c.end,c.start,c.end);
  for(const r of guesses.values()){
    if(valueEnds[r.part][r.start]>=r.end){
      r.suggest=false;
      continue;
    }
    const contained=endingAt.get(r.part+':'+r.end);
    if(!contained||contained.start<=r.start)continue;
    const lead=r.value.slice(0,contained.start-r.start);
    if(/^(?:签收|测试|验收|交付|交货|联调|复核|排查|上线)?(?:比原定|比约定)?(?:晚了?|顺延|延期|推迟|排了?|占用?|需要?|耗时|用时)$/u.test(lead)){
      r.suggest=false;r.uncertain=true;
    }
  }
  for(const c of candidates){
    const guess=guesses.get(c.part+':'+c.start+':'+c.end);
    if(guess){
      Object.assign(guess,{suggest:false,type:c.family==='time'?'时间':'金额',role:'',owner:'',ambiguous:false,origin:'原文数值核对'});
    }
    const directive=spec.directives.get(c.role);
    const fallback=spec.directives.get(c.family==='time'?'delay':'price');
    const uncertain=c.role==='unknown'&&fallback?.mask;
    if(!directive&&!uncertain&&!targeted.has(c.value))continue;
    matches.push({part:c.part,start:c.start,end:c.end,value:c.value,type:c.family==='time'?'时间':'金额',
      suggest:directive?.mask??false,basis:(directive||fallback)?.basis||policy,uncertain:!!uncertain});
  }
  return matches;
}
module.exports={parseFields,fieldCandidates,fieldMatches,values};
