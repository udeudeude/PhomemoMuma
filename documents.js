'use strict';
(() => {
const $ = (id) => document.getElementById(id);
const PRINT_WIDTH = 384;
const MAX_PAGE_HEIGHT = 9000;
const SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const WRITE = '0000ff02-0000-1000-8000-00805f9b34fb';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const preview = $('preview');
let source = null, device = null, writer = null, busy = false, abortRequested = false;
let previewSequence = 0, lastPreview = null, lastPreviewPage = 0, lastPreviewSettings = '';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function log(s) { $('log').textContent += '\n' + s; }
function status(s) { $('message').textContent = s; }
function connected() { return !!(device && device.gatt && device.gatt.connected && writer); }
function options() {
  return {
    layout: document.querySelector('input[name="layout"]:checked').value,
    rotate: Number($('rotation').value),
    margin: Number($('margin').value),
    method: $('method').value,
    contrast: Number($('contrast').value),
    density: Number($('density').value)
  };
}
function updateControls() {
  const loaded = !!source, canPrint = loaded && connected() && !busy;
  $('print-one').disabled = !canPrint;
  $('print-range').disabled = !canPrint;
  $('save-image').disabled = !lastPreview || busy;
  $('connect').disabled = busy;
  $('document-file').disabled = busy;
  $('cancel').hidden = !busy;
  $('connection-status').textContent = connected() ? 'Connected: ' + device.name : 'Not connected';
  $('print-one').textContent = busy ? 'Sending print data…' : 'Print this page';
}
function errorText(e) { return e && (e.message || e.name) ? (e.message || e.name) : String(e); }
function pageNumber() {
  return Math.max(1, Math.min(source ? source.pages : 1, Number($('preview-page').value) || 1));
}
function setPages(count) {
  for (const id of ['preview-page','page-from','page-to']) {
    $(id).disabled = false; $(id).min = 1; $(id).max = count;
  }
  $('preview-page').value = 1;
  $('page-from').value = 1;
  $('page-to').value = count;
  $('page-summary').textContent = count + (count === 1 ? ' page.' : ' pages. Set the range to avoid printing more than you need.');
}
function blankPreview() {
  const c = preview.getContext('2d'); c.fillStyle = 'white'; c.fillRect(0,0,384,140);
  c.fillStyle = '#111827'; c.font = 'bold 19px sans-serif'; c.textAlign = 'center'; c.fillText('Choose a document',192,72);
}
function loadImage(file) {
  return new Promise((resolve,reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image format is not supported by this browser.')); };
    img.src = url;
  });
}
async function loadDocument(file) {
  if (!file) return;
  if (busy) return;
  const sequence = ++previewSequence;
  status('Opening ' + file.name + '…');
  try {
    let next;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (!window.pdfjsLib) throw new Error('PDF renderer unavailable. Connect to the internet once and reload this page in Bluefy.');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      const loading = window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
      const pdf = await loading.promise;
      next = { kind:'pdf', pdf, pages:pdf.numPages, name:file.name };
    } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      next = { kind:'image', image:await loadImage(file), pages:1, name:file.name };
    } else if (file.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(file.name)) {
      next = { kind:'text', text:await file.text(), pages:1, name:file.name };
    } else { throw new Error('Please choose a PDF, photograph, or plain text file.'); }
    if (sequence !== previewSequence) return;
    source = next;
    lastPreview = null;
    $('filename').textContent = file.name;
    setPages(source.pages);
    log('Loaded ' + file.name + ' (' + source.pages + ' pages)');
    status('File opened. Preparing monochrome print preview…');
    await updatePreview();
  } catch(e) { log('Open error: ' + errorText(e)); status('Could not open file: ' + errorText(e)); }
  updateControls();
}
function sourceBoundingBox(canvas, crop) {
  if (!crop) return {x:0,y:0,w:canvas.width,h:canvas.height};
  const ctx = canvas.getContext('2d',{willReadFrequently:true});
  const {width:w,height:h} = canvas;
  const rgba = ctx.getImageData(0,0,w,h).data;
  let left=w, right=-1, top=h, bottom=-1;
  // Skip tiny specks by sampling at two-pixel intervals.
  for (let y=0;y<h;y+=2) for (let x=0;x<w;x+=2) {
    const i=(y*w+x)*4;
    if (rgba[i]<205 || rgba[i+1]<205 || rgba[i+2]<205) {
      if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y;
    }
  }
  if (right<left || bottom<top) return {x:0,y:0,w,h};
  const pad = Math.max(5,Math.round(w/90));
  left=Math.max(0,left-pad);top=Math.max(0,top-pad);
  right=Math.min(w,right+pad);bottom=Math.min(h,bottom+pad);
  return {x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)};
}
function outputCanvasFromSource(raw,settings,crop) {
  const box = sourceBoundingBox(raw,crop);
  const inner = PRINT_WIDTH - settings.margin*2;
  const scaledHeight = Math.max(1,Math.ceil(box.h * inner / box.w));
  const h = Math.max(55, scaledHeight + settings.margin*2 + 12);
  if(h>MAX_PAGE_HEIGHT)throw new Error('This page would exceed the safe length limit. Use another layout or crop the source.');
  const c = document.createElement('canvas'); c.width=PRINT_WIDTH;c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='white';ctx.fillRect(0,0,PRINT_WIDTH,h);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(raw,box.x,box.y,box.w,box.h,settings.margin,settings.margin,inner,scaledHeight);
  return monochrome(c,settings);
}
function monochrome(canvas,settings) {
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const {width:w,height:h} = canvas, image=ctx.getImageData(0,0,w,h);
  const pixels=image.data, luma = new Float32Array(w*h), multiplier=1+settings.contrast/100;
  for(let i=0;i<luma.length;i++){
    const at=i*4;
    const a=pixels[at+3]/255;
    const white=(pixels[at]*.299+pixels[at+1]*.587+pixels[at+2]*.114)*a+255*(1-a);
    luma[i]=Math.max(0,Math.min(255,(white-128)*multiplier+128));
  }
  const dither=settings.method==='dither';
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,previous=luma[i],v=previous<180?0:255;
    if(dither){
      const e=previous-v;
      if(x+1<w)luma[i+1]+=e*7/16;
      if(y+1<h){
        if(x>0)luma[i+w-1]+=e*3/16;
        luma[i+w]+=e*5/16;
        if(x+1<w)luma[i+w+1]+=e/16;
      }
    }
    pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=v;
    pixels[i*4+3]=255;
  }
  ctx.putImageData(image,0,0);return canvas;
}
function wrappedLines(ctx,text,width) {
  const lines=[];
  for(const paragraph of text.replace(/\r/g,'').split('\n')){
    if(!paragraph.trim()){lines.push('');continue;}
    let line='';
    for(const word of paragraph.trim().split(/\s+/)){
      const next=line ? line+' '+word : word;
      if(ctx.measureText(next).width<=width){line=next;continue;}
      if(line){lines.push(line);line='';}
      for(const ch of word){
        if(line && ctx.measureText(line+ch).width>width){lines.push(line);line=ch;}
        else line+=ch;
      }
    }
    lines.push(line);
  }
  return lines;
}
function textCanvas(text,settings) {
  const c=document.createElement('canvas');
  const fontSize=23,step=31,inner=PRINT_WIDTH-settings.margin*2;
  const tmp=document.createElement('canvas').getContext('2d');
  tmp.font=fontSize+'px Arial, sans-serif';
  const lines=wrappedLines(tmp,text,inner);
  const h=Math.max(60,settings.margin*2+lines.length*step+18);
  if(h>MAX_PAGE_HEIGHT)throw new Error('Too much text to print on a single page; shorten the source.');
  c.width=PRINT_WIDTH;c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle='black';ctx.font=fontSize+'px Arial, sans-serif';ctx.textBaseline='top';
  lines.forEach((line,i)=>ctx.fillText(line,settings.margin,settings.margin+i*step));
  return monochrome(c,settings);
}
async function extractText(page) {
  const items=(await page.getTextContent()).items;
  let s='',prevY=null;
  for(const item of items){
    if(typeof item.str!=='string')continue;
    const y=item.transform?item.transform[5]:null;
    if(prevY!==null && y!==null && Math.abs(y-prevY)>3)s+='\n';
    else if(s&&!/[\s\n]$/.test(s)&&item.str&&!/^[,.;:!?)\]}]/.test(item.str))s+=' ';
    s+=item.str;
    if(item.hasEOL){s+='\n';prevY=null;}
    else if(y!==null)prevY=y;
  }
  return s.trim();
}
async function makePage(n,settings) {
  if(!source)throw new Error('Choose a document first.');
  if(source.kind==='text')return textCanvas(source.text,settings);
  if(source.kind==='image'){
    const img=source.image,raw=document.createElement('canvas');
    let sw=img.naturalWidth,sh=img.naturalHeight;
    const scale=Math.min(1,1200/sw,2400/sh);
    sw=Math.max(1,Math.round(sw*scale));sh=Math.max(1,Math.round(sh*scale));
    const sideways=(settings.rotate%180)!==0;
    raw.width=sideways?sh:sw;raw.height=sideways?sw:sh;
    const x=raw.getContext('2d');
    x.fillStyle='white';x.fillRect(0,0,raw.width,raw.height);
    x.translate(raw.width/2,raw.height/2);x.rotate(settings.rotate*Math.PI/180);
    x.drawImage(img,-sw/2,-sh/2,sw,sh);
    return outputCanvasFromSource(raw,settings,settings.layout==='crop');
  }
  const pdfPage=await source.pdf.getPage(n);
  if(settings.layout==='reflow'){
    const text=await extractText(pdfPage);
    if(text.length>0)return textCanvas(text,settings);
    log('Page '+n+' has no selectable text; falling back to whole-page rendering.');
  }
  const rotation=(pdfPage.rotate+settings.rotate)%360;
  const base=pdfPage.getViewport({scale:1,rotation});
  const scale=Math.min(2.3,1100/base.width,2300/base.height);
  const viewport=pdfPage.getViewport({scale,rotation});
  const raw=document.createElement('canvas');
  raw.width=Math.ceil(viewport.width);raw.height=Math.ceil(viewport.height);
  const x=raw.getContext('2d',{alpha:false,willReadFrequently:true});
  x.fillStyle='white';x.fillRect(0,0,raw.width,raw.height);
  await pdfPage.render({canvasContext:x,viewport,background:'rgb(255,255,255)'}).promise;
  return outputCanvasFromSource(raw,settings,settings.layout==='crop');
}
function showPreview(result,pageNum,settingsString){
  preview.width=result.width;preview.height=result.height;
  preview.getContext('2d').drawImage(result,0,0);
  lastPreview=result;lastPreviewPage=pageNum;lastPreviewSettings=settingsString;
  $('dimensions').textContent=result.width+' × '+result.height+' dots';
  updateControls();
}
async function updatePreview() {
  if(!source || busy)return;
  const run=++previewSequence,n=pageNumber(),settings=options(),settingKey=JSON.stringify(settings);
  status('Rendering page '+n+'…');
  try {
    const result=await makePage(n,settings);
    if(run!==previewSequence)return;
    showPreview(result,n,settingKey);
    status('Ready: page '+n+' of '+source.pages+'.');
  }catch(e){if(run===previewSequence){status('Preview error: '+errorText(e));log('Preview error: '+errorText(e));}}
}
async function connectPrinter(){
  try{
    if(!navigator.bluetooth)throw new Error('Use Bluefy: this browser does not support Bluetooth printing.');
    device=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'Mr.in_'},{namePrefix:'M02'},{namePrefix:'Phomemo'}],optionalServices:[SERVICE]});
    const server=await device.gatt.connect();
    const service=await server.getPrimaryService(SERVICE);
    writer=await service.getCharacteristic(WRITE);
    device.addEventListener('gattserverdisconnected',()=>{writer=null;log('Printer disconnected');updateControls();});
    log('Connected to '+device.name+' via FF00/FF02');status('Printer connected. Ready to print.');
  }catch(e){writer=null;status('Connection failed: '+errorText(e));log('Bluetooth error: '+errorText(e));}
  updateControls();
}
function oneBitRaster(c){
  const {width,height}=c;
  const data=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
  const packed=new Uint8Array(48*height);
  for(let y=0;y<height;y++)for(let x=0;x<PRINT_WIDTH;x++)
    if(data[(y*PRINT_WIDTH+x)*4]<128)packed[y*48+(x>>3)]|=128>>(x&7);
  return packed;
}
async function printPages(first,last){
  if(!source||!connected()||busy)return;
  if(last<first){status('Last page must be after or equal to the first page.');return;}
  if(last-first+1>10&&!confirm('Print '+(last-first+1)+' pages? At this width that can use a lot of paper.'))return;
  busy=true;abortRequested=false;updateControls();
  const progress=$('progress');progress.hidden=false;progress.value=0;
  const settings=options(),count=last-first+1;
  let sent=0;
  async function send(bytes){
    for(let i=0;i<bytes.length;i+=20){
      if(abortRequested)throw new Error('Printing stopped by user; the current page may be incomplete.');
      if(!connected())throw new Error('Printer disconnected during transmission.');
      const chunk=bytes.slice(i,i+20);
      if(writer.writeValueWithoutResponse)await writer.writeValueWithoutResponse(chunk);
      else await writer.writeValue(chunk);
      sent+=chunk.length;
      await sleep(35);
    }
  }
  try{
    for(let n=first;n<=last;n++){
      if(abortRequested)break;
      status('Preparing page '+n+' of '+last+'…');
      const c=await makePage(n,settings),raster=oneBitRaster(c);
      log('Page '+n+': '+PRINT_WIDTH+' × '+c.height+' at density '+settings.density);
      status('Sending page '+n+' of '+last+'…');
      await send(new Uint8Array([0x1b,0x40,0x1b,0x61,0x00,0x1f,0x11,0x02,settings.density]));
      for(let y=0;y<c.height;y+=240){
        const rows=Math.min(240,c.height-y);
        await send(new Uint8Array([0x1d,0x76,0x30,0x00,48,0,rows&255,rows>>8]));
        await send(raster.subarray(y*48,(y+rows)*48));
        progress.value=Math.round(((n-first)+(y+rows)/c.height)/count*98);
        if(y+rows<c.height)await sleep(350);
      }
      await send(new Uint8Array([0x1b,0x64,0x02,0x1f,0x11,0x08,0x1f,0x11,0x0e,0x1f,0x11,0x07,0x1f,0x11,0x09]));
      log('Sent page '+n+' ('+raster.length+' bitmap bytes)');
      if(n<last)await sleep(500);
    }
    if(!abortRequested){progress.value=100;status('Data sent. Confirm the result on the physical paper.');}
    else status('Print sequence stopped.');
  }catch(e){status('Printing stopped: '+errorText(e));log('Print error: '+errorText(e));}
  finally{
    busy=false;updateControls();
    setTimeout(()=>{progress.hidden=true;},2000);
  }
}
function savePreview(){
  if(!lastPreview)return;
  try{
    const a=document.createElement('a');
    a.download='PhomemoMuma-page-'+lastPreviewPage+'.png';
    a.href=lastPreview.toDataURL('image/png');
    document.body.appendChild(a);a.click();a.remove();
    status('Preview image prepared. Check Downloads in Bluefy or the Files app.');
  }catch(e){status('Image export failed: '+errorText(e));}
}
blankPreview();
$('document-file').addEventListener('change',async event=>{
  const file=event.target.files&&event.target.files[0];
  await loadDocument(file);
  event.target.value='';
});
$('preview-page').addEventListener('change',()=>{if(source){$('preview-page').value=pageNumber();updatePreview();}});
for(const id of ['rotation','margin','method','density'])$(id).addEventListener('change',updatePreview);
for(const input of document.querySelectorAll('input[name="layout"]'))input.addEventListener('change',updatePreview);
$('contrast').addEventListener('input',()=>{$('contrast-value').textContent=$('contrast').value;updatePreview();});
$('connect').addEventListener('click',connectPrinter);
$('print-one').addEventListener('click',()=>printPages(pageNumber(),pageNumber()));
$('print-range').addEventListener('click',()=>{
  const first=Number($('page-from').value),last=Number($('page-to').value);
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last>source.pages||last<first){status('Please enter a valid page range.');return;}
  printPages(first,last);
});
$('cancel').addEventListener('click',()=>{abortRequested=true;status('Stopping transmission…');});
$('save-image').addEventListener('click',savePreview);
$('copy-log').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('log').textContent);status('Report copied.');}
  catch(e){status('Clipboard access denied: '+errorText(e));}
});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(e=>log('Offline cache unavailable: '+errorText(e)));
updateControls();
})();