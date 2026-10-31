/**
 * Search for the topics page. One-meeting issues are hidden until someone
 * looks for them, so a misspelled plural, a split name, or words out of order
 * still has to find the issue.
 *
 * The browser runs this same function (injected from its source), so the
 * first paint and later keystrokes stay in agreement.
 */
export function topicTools(
  name: string,
  blob: string,
  description: string,
  latest: string,
  query: string,
  once: boolean,
): { score: number; why: string } {
  const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by', 'from']);

  function normalize(value: string): string {
    return String(value ?? '')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/&/g, ' and ')
      .toLowerCase()
      .replace(/([a-z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-z])/g, '$1 $2')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function forms(word: string): string[] {
    const out = [word];
    const pair: Record<string, string> = { feet: 'foot', foot: 'feet', people: 'person', person: 'people', children: 'child', child: 'children' };
    if (pair[word]) out.push(pair[word]);
    if (/(?:[sxz]es|[cs]hes)$/.test(word) && word.length > 4) out.push(word.slice(0, -2));
    else if (word.length > 4 && word.endsWith('ies')) out.push(word.slice(0, -3) + 'y');
    else if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) out.push(word.slice(0, -1));
    else if (word.length > 3 && !word.endsWith('s')) out.push(`${word}s`);
    return out;
  }

  function wordIn(word: string, text: string): boolean {
    if (!text) return false;
    const tokens = text.split(' ').filter(Boolean);
    const variants = forms(word);
    for (let i = 0; i < variants.length; i++) {
      const form = variants[i];
      // "4" and "7-0" are real queries. A one-letter word is not, or "a" would match everything.
      if (form.length < 2) {
        if (/\d/.test(form)) {
          for (let t = 0; t < tokens.length; t++) if (tokens[t] === form) return true;
        }
        continue;
      }
      for (let t = 0; t < tokens.length; t++) {
        if (tokens[t] === form || (form.length >= 3 && tokens[t].startsWith(form))) return true;
      }
      // "peacehealth" against "peace health": only a match that starts on a word.
      if (form.length >= 6) {
        let pos = 0;
        const compact = tokens.join('');
        for (let t = 0; t < tokens.length; t++) {
          if (compact.startsWith(form, pos)) return true;
          pos += tokens[t].length;
        }
      }
    }
    return false;
  }

  function wordsOf(value: string): string[] {
    const all = normalize(value).split(' ').filter((w) => w.length > 1 || /\d/.test(w));
    const kept = all.filter((w) => !STOP.has(w));
    return kept.length ? kept : all;
  }

  function clip(source: string, words: string[]): string {
    const clean = String(source ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const parts = clean.split(' ');
    let at = 0;
    for (let i = 0; i < parts.length; i++) {
      const token = normalize(parts[i]);
      if (words.some((w) => wordIn(w, token))) {
        at = i;
        break;
      }
    }
    const start = Math.max(0, at - 5);
    const slice = parts.slice(start, start + 16);
    const prefix = start > 0 ? '…' : '';
    const suffix = start + 16 < parts.length ? '…' : '';
    return `${prefix}${slice.join(' ')}${suffix}`;
  }

  const words = wordsOf(query);
  if (!normalize(query) || !words.length) return { score: 0, why: '' };
  const nameN = normalize(name);
  const blobN = normalize(`${name} ${description} ${latest} ${blob}`);
  if (!words.every((w) => wordIn(w, blobN))) return { score: 0, why: '' };
  const inName = words.filter((w) => wordIn(w, nameN)).length;
  const flat = normalize(query).replace(/ /g, '');
  let score = 100;
  if (inName === words.length) {
    if (nameN === normalize(query) || nameN.replace(/ /g, '') === flat) score = 500;
    else if (nameN.startsWith(normalize(query)) || nameN.replace(/ /g, '').startsWith(flat)) score = 400;
    else score = 300;
  } else if (inName > 0) score = 200 + inName * 10;
  const missing = words.filter((w) => !wordIn(w, nameN));
  const has = (source: string) => missing.some((w) => wordIn(w, normalize(source)));
  // Prefer the field that holds the word the title left out, so "Griffin" quotes the remembrance, not the title.
  const whySource = missing.length
    ? (has(description) ? description : has(latest) ? latest : once ? description : '')
    : once ? description : '';
  return { score, why: whySource ? clip(whySource, missing) : '' };
}

/** The browser copy of topicTools, so keystrokes use the same rules as the first paint. */
export function topicSearchScript(tuck: boolean): string {
  return `<script>(function(){
${topicTools.toString()}
var q=document.getElementById('topic-find'),list=document.getElementById('topic-all'),none=document.getElementById('topic-none'),count=document.getElementById('topic-count');
if(!q||!list)return;
var tuck=${tuck ? 'true' : 'false'};
var rows=Array.prototype.slice.call(list.children);
function apply(){
  var query=q.value,empty=!query.trim(),shown=[],onceShown=0;
  rows.forEach(function(li){
    var once=li.getAttribute('data-once')==='1';
    var meetings=Number(li.getAttribute('data-meetings'))||0;
    var result=empty?{score:!tuck||!once?1:0,why:''}:topicTools(li.getAttribute('data-name')||'',li.getAttribute('data-find')||'',li.getAttribute('data-desc')||'',li.getAttribute('data-latest')||'',query,once);
    var why=li.querySelector('.why');
    if(why){why.textContent=result.why||'';why.hidden=!result.why;}
    li.hidden=result.score===0;
    if(result.score){shown.push({li:li,score:result.score,meetings:meetings,name:(li.getAttribute('data-name')||'').toLowerCase()});if(once)onceShown++;}
  });
  if(empty) rows.slice().sort(function(a,b){return (Number(a.getAttribute('data-order'))||0)-(Number(b.getAttribute('data-order'))||0);}).forEach(function(li){list.appendChild(li);});
  else {
    shown.sort(function(a,b){return b.score-a.score||b.meetings-a.meetings||(a.name<b.name?-1:a.name>b.name?1:0);});
    shown.forEach(function(row){list.appendChild(row.li);});
    rows.forEach(function(li){if(li.hidden)list.appendChild(li);});
  }
  if(count){
    if(empty||!shown.length){count.hidden=true;count.textContent='';}
    else {count.hidden=false;count.textContent=shown.length+(shown.length===1?' match':' matches')+(onceShown?' · '+onceShown+' mentioned once':'');}
  }
  if(none) none.hidden=shown.length!==0;
}
q.addEventListener('input',function(){
  apply();
  try {
    var url=new URL(location.href);
    var trimmed=q.value.trim();
    if(trimmed) url.searchParams.set('q',trimmed); else url.searchParams.delete('q');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
  } catch(e) {}
});
apply();
})();</script>`;
}
