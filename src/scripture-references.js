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
    }return result;
  }
  global.EmmausReferences={parse};
})(globalThis);
