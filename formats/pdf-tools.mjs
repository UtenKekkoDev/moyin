import {getDocument,GlobalWorkerOptions,AnnotationMode} from './vendor/pdf.min.mjs';
GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;

export async function loadPdf(bytes){
  const asset=dir=>new URL('./vendor/'+dir+'/',import.meta.url).href;
  const job=getDocument({data:bytes,cMapUrl:asset('cmaps'),cMapPacked:true,standardFontDataUrl:asset('standard_fonts'),wasmUrl:asset('wasm'),iccUrl:asset('iccs'),isEvalSupported:false,stopAtErrors:true});
  let pdf;
  try{
    pdf=await job.promise;
    if(pdf.numPages>60)throw Error('单次支持 60 页以内的 PDF，请分卷处理。');
    const pages=[];let body='',overflow=false;
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number);
      const frame=page.getViewport({scale:1});
      if(!(frame.width>0&&frame.height>0&&Number.isFinite(frame.width+frame.height)))throw Error('无法读取页面尺寸。');
      const record={number,width:frame.width,height:frame.height,start:body.length,end:body.length,items:[],hasText:false};
      const content=await page.getTextContent();
      for(const item of content.items){
        if(typeof item.str!=='string')continue;
        if(item.str.trim())record.hasText=true;
        if(overflow)continue;
        const start=body.length;
        body+=item.str+(item.hasEOL?'\n':'');
        record.items.push({start,end:start+item.str.length,item});
        if(body.length>60000)overflow=true;
      }
      record.end=body.length;pages.push(record);
      if(!overflow)body+='\n';
      page.cleanup();
    }
    return {pdf,pages,body:overflow?'':body.slice(0,-1),overflow};
  }catch(e){await job.destroy();throw e;}
}

export async function renderPage(pdf,record){
  const page=await pdf.getPage(record.number);
  const scale=Math.min(2.25,2400/Math.max(record.width,record.height));
  const view=page.getViewport({scale});
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
  await page.render({canvas,viewport:view,background:'white',annotationMode:AnnotationMode.ENABLE}).promise;
  return canvas;
}

export function paintMask(ctx,rect,counts){
  const {width,height}=ctx.canvas;
  const x=Math.floor(width*rect.x),y=Math.floor(height*rect.y);
  const right=Math.ceil(width*(rect.x+rect.w)),bottom=Math.ceil(height*(rect.y+rect.h));
  const w=right-x,h=bottom-y;
  ctx.fillStyle='black';ctx.fillRect(x,y,w,h);
  if(counts){
    const label=String(rect.count);
    const size=Math.min(36,Math.floor(h*.75),Math.floor(w*1.2/(label.length+1)));
    if(size<4)throw Error('有选区过小，无法在黑框上标注字数。请放大该选区或关闭字数显示。');
    ctx.fillStyle='white';ctx.font='bold '+size+'px sans-serif';
    ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText(label,x+w/2,y+h/2,w);
  }
}

// Generate a fresh image-only PDF. Source images, streams, revisions, attachments,
// text, annotations and metadata cannot enter this writer.
export async function exportPdf(doc,masks,counts,progress){
  const chunks=[],offsets=[0],enc=new TextEncoder();let length=0;
  const add=data=>{const buf=typeof data==='string'?enc.encode(data):data;chunks.push(buf);length+=buf.byteLength;};
  const obj=(id,data)=>{offsets[id]=length;add(id+' 0 obj\n');add(data);add('\nendobj\n');};
  add('%PDF-1.4\n');
  const kids=doc.pages.map((_,i)=>(3+i*3)+' 0 R').join(' ');
  obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,'<< /Type /Pages /Count '+doc.pages.length+' /Kids ['+kids+'] >>');
  for(const [i,record] of doc.pages.entries()){
    progress(record.number);
    const canvas=await renderPage(doc.pdf,record);const ctx=canvas.getContext('2d');
    for(const rect of masks.filter(r=>r.page===record.number))paintMask(ctx,rect,counts);
    const jpeg=await new Promise((ok,fail)=>canvas.toBlob(blob=>blob?ok(blob):fail(Error('本机图像编码失败。')),'image/jpeg',.96));
    const id=3+i*3,w=record.width.toFixed(3),h=record.height.toFixed(3);
    obj(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+w+' '+h+'] /Resources << /XObject << /Im0 '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>');
    offsets[id+1]=length;add((id+1)+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.size+' >>\nstream\n');
    add(new Uint8Array(await jpeg.arrayBuffer()));add('\nendstream\nendobj\n');canvas.width=canvas.height=1;
    const cmd='q '+w+' 0 0 '+h+' 0 0 cm /Im0 Do Q';
    obj(id+2,'<< /Length '+cmd.length+' >>\nstream\n'+cmd+'\nendstream');
  }
  const start=length;
  add('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
  for(const offset of offsets.slice(1))add(String(offset).padStart(10,'0')+' 00000 n \n');
  add('trailer\n<< /Root 1 0 R /Size '+offsets.length+' >>\nstartxref\n'+start+'\n%%EOF\n');
  return new Blob(chunks,{type:'application/pdf'});
}
