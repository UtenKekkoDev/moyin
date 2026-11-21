const segmenter=new Intl.Segmenter('zh',{granularity:'grapheme'});
export const charCount=text=>Array.from(segmenter.segment(text)).length;
export function sanitizedText(source,rows,counts){
  const ranges=[];
  for(const row of rows.filter(r=>r.decision==='mask').sort((a,b)=>a.start-b.start||b.end-a.end)){
    const last=ranges.at(-1);
    if(last&&last.end>row.start)last.end=Math.max(last.end,row.end);
    else ranges.push({start:row.start,end:row.end});
  }
  let pos=0,out='';
  for(const {start,end} of ranges){
    out+=source.slice(pos,start);
    const value=source.slice(start,end);
    // Keep original line and Markdown paragraph boundaries even inside a selection.
    out+=value.split(/(\r\n|\r|\n)/).map(s=>!s||/^[\r\n]+$/.test(s)?s:(counts?'█'.repeat(charCount(s)):'【已隐去】')).join('');
    pos=end;
  }
  return out+source.slice(pos);
}
