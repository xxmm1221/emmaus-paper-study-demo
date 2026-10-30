/* Parse explicit Chinese book references only; a bare time such as 8:28 is not scripture. */
(function(global){
  function parse(text,books){
    const aliases=new Map(); for(const b of books)for(const name of [b.name,b.abbreviation])aliases.set(name,b);
    const names=[...aliases.keys()].sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    const re=new RegExp('('+names.join('|')+')\\s*(\\d+)(?:\\s*[:：]\\s*(\\d+)(?:\\s*[-–—]\\s*(\\d+))?|\\s*章(?:\\s*(\\d+)\\s*节)?)?','g');
    const result=[];for(const m of text.matchAll(re)){
      const b=aliases.get(m[1]),chapter=Number(m[2]),verse=Number(m[3]||m[5])||null,endVerse=Number(m[4])||verse;
      if(chapter<1||chapter>b.chapterCount || ((m[3]||m[5])&&!verse) || endVerse<verse)continue;
      if(!verse&&!m[0].includes('章')&&m[1]!==b.name)continue;
      if(/^[\d:：\-–—]/.test(text.slice(m.index+m[0].length)))continue;
      result.push({book:b.number,chapter,verse,endVerse,label:m[0],start:m.index,end:m.index+m[0].length});
    }
    // CMC uses printed references such as 罗八28 and 创一26. Preserve the
    // original label/offsets; do not rewrite the author's text to Arabic numerals.
    const numeral=s=>{if(/^\d+$/.test(s))return Number(s);const d={'零':0,'〇':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};let n=0,t=0;for(const c of s){if(c==='百'||c==='十'){n+=(t||1)*(c==='百'?100:10);t=0;}else t=d[c]??NaN;}return n+t;};
    const cn=new RegExp('('+names.join('|')+')\\s*([一二三四五六七八九十百零〇]+)\\s*(\\d+)(?:[-–—](\\d+))?','g');
    for(const m of text.matchAll(cn)){
      const b=aliases.get(m[1]),chapter=numeral(m[2]),verse=Number(m[3]),endVerse=Number(m[4]||m[3]);
      if(!chapter||chapter>b.chapterCount||verse<1||endVerse<verse||/^[\d:：]/.test(text.slice(m.index+m[0].length)))continue;
      if(result.some(r=>m.index<r.end&&m.index+m[0].length>r.start))continue;
      result.push({book:b.number,chapter,verse,endVerse,label:m[0],start:m.index,end:m.index+m[0].length});
    }
    return result.sort((a,b)=>a.start-b.start);
  }
  global.EmmausReferences={parse};
})(globalThis);
