  function rules(text) {
    const entries = [];
    const add = (value, type, source = "格式规则", canonical = value) => entries.push({value, type, source, canonical});
    const patterns = [
      ["邮箱", /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![A-Za-z0-9])/g],
      ["电话", /(?<![0-9])((?:(?:\+86|0086)[ -]?)?1[3-9]\d[ -]?\d{4}[ -]?\d{4})(?![0-9])/g],
      ["编号", /(?:内部编号|项目编号|合同编号|工单号|编号)\s*[:：｜]\s*([A-Za-z0-9][A-Za-z0-9_./-]{2,50})/g],
      ["编号", /(?<![A-Za-z0-9])([A-Z]{2,10}(?:-[A-Z0-9]{1,12})*-\d{2,10})(?![A-Za-z0-9-])/g],
      ["项目", /(?:项目名称|项目代号|项目名|项目)\s*[:：｜]\s*[「“"]?([\p{Script=Han}A-Za-z0-9_-]{2,24})/gu],
      ["客户", /(?:客户全称|客户名称|客户名|客户)\s*[:：｜]\s*[「“"]?([\p{Script=Han}A-Za-z0-9_-]{2,40})/gu],
      ["机构", /(?:供应商名称|合作方|供应商|公司名称|单位名称)\s*[:：｜]\s*[「“"]?([\p{Script=Han}A-Za-z0-9_-]{2,40})/gu],
      ["人员", /(?:负责人|联系人|经办人|汇报人|项目经理|姓名)\s*[:：｜]\s*([\p{Script=Han}]{2,4})(?=$|[\s，。；、｜（(])/gmu]
    ];
    for (const [type, re] of patterns) for (const m of text.matchAll(re)) add(m[1], type);
    for (const m of text.matchAll(/(?:项目(?:名称|代号|名)|内部代号|内部(?:项目|版本)(?:名称|名|代号)?)\s*(?:[：:]|(?:定为|叫作|为|是))?\s*[「“"]([^」”"\r\n]{1,32})[」”"]/gu))
      add(m[1], "项目");
    // Only merge explicit declarations. A shared ambiguous abbreviation gets its own
    // neutral placeholder so the reviewer can resolve it occurrence by occurrence.
    const aliases = new Map();
    for (const e of entries) {
      if (!["机构","项目","客户"].includes(e.type)) continue;
      const escaped = e.value.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped + "[（(]\\s*(?:以下)?简称\\s*[为：:「“\\x22]*([\\p{Script=Han}A-Za-z0-9_-]{2,20})[”」\\x22]?\\s*[）)]", "gu");
      for (const m of text.matchAll(re)) {
        if (!aliases.has(m[1])) aliases.set(m[1], new Map());
        aliases.get(m[1]).set(e.value, e.type);
      }
    }
    for (const [alias, owners] of aliases) {
      const [canonical, type] = owners.entries().next().value;
      if (owners.size > 1) add(alias, "待核简称", "多义简称");
      else add(alias, type, "明确简称", canonical);
    }
    return entries;
  }

module.exports = rules;
