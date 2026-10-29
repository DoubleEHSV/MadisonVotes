'use strict';
const $ = id => document.getElementById(id);
const countyBase = 'https://services3.arcgis.com/x30BNDiAn8ea61Vv/arcgis/rest/services/2026_Precincts/FeatureServer/0';
const censusBase = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer';
let data, summaries, mode = 'browse', filter = 'All contests', districts = {}, selection = new Map(), request = 0;
const openedComparisons = new Set();
const filters = ['All contests', 'Federal', 'State', 'County', 'Amendments'];
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function getJSON(url, params = {}) {
  const response = await fetch(url + '?' + new URLSearchParams({ f:'json', ...params }), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('The source could not be reached.');
  const json = await response.json();
  if (json.error) throw new Error('The source returned an error.');
  return json;
}
function spatialQuery(url, point) {
  return getJSON(url + '/query', { geometry:JSON.stringify({x:point.x,y:point.y,spatialReference:{wkid:4326}}), geometryType:'esriGeometryPoint', inSR:'4326', spatialRel:'esriSpatialRelIntersects', outFields:'*', returnGeometry:'false' });
}
function getDistrict(result) {
  if (result.status !== 'fulfilled') return null;
  const rows = result.value.features;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].attributes.STATE !== '01') return null;
  const value = Number(rows[0].attributes.BASENAME);
  return Number.isInteger(value) && value > 0 ? value : null;
}
function busy(value, text = 'Finding your address…') { $('find').disabled=value; $('find').innerHTML=value?escapeHTML(text):'Find my sample ballot <span>→</span>'; }
function announce(text) { $('message').textContent=text; }
function showResults() { $('results').hidden=false; render(); $('results').scrollIntoView({behavior:'smooth', block:'start'}); $('results').focus({preventScroll:true}); }
function group(r) { if (r.scope==='Congress' || r.title==='United States Senator') return 'Federal'; if (r.scope.startsWith('County')) return 'County'; return 'State'; }
function eligible(r) {
  if (mode === 'browse') return true;
  switch(r.scope) {
    case 'State Senate': return districts.senate === r.district;
    case 'State House': return districts.house === r.district;
    case 'Congress': return districts.congress === r.district;
    case 'State Education': return r.district === 8;
    case 'County Education': return districts.countySchool === 'yes' && (!r.district || districts.countyBoard === String(r.district));
    default: return true;
  }
}
function allItems() { return [...data.races.filter(eligible).map(r=>({...r,group:group(r)})),...data.amendments.map(a=>({...a,group:'Amendments'}))]; }
function summaryCard(label,value,note='') { return `<div><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong><small>${escapeHTML(note)}</small></div>`; }
function updateSelectionCount() { $('selection-count').textContent = `${selection.size} selection${selection.size===1?'':'s'}`; }
function options(r) {
  const choices = r.candidates || [{name:'Yes',party:''},{name:'No',party:''}];
  return choices.map((c,i)=>{
    const website = ['verified','user_provided'].includes(c.websiteStatus) && /^https?:\/\//.test(c.website || '') ? c.website : null;
    const websiteLabel = c.websiteLabel || 'Website';
    const link = r.candidates ? (website
      ? `<a class="candidate-link" href="${escapeHTML(website)}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${escapeHTML(c.name)} ${escapeHTML(websiteLabel)} (opens in a new tab)">${escapeHTML(websiteLabel)} ↗</a>`
      : `<span class="candidate-unavailable">${c.websiteStatus==='unavailable'?'Website unavailable':'No verified website'}</span>`) : '';
    return `<div class="candidate-row"><label class="candidate"><input type="radio" name="${r.id}" value="${i}" ${selection.get(r.id)?.value===String(i)?'checked':''}><span>${escapeHTML(c.name)}</span>${c.party?`<small>${escapeHTML(c.party)}</small>`:''}</label>${link}</div>`;
  }).join('');
}
function summarySourceLinks(refs) {
  return (refs || []).map(ref => summaries?.sources?.[ref]).filter(Boolean).map(s=>`<a href="${escapeHTML(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(s.title)} ↗</a>`).join('');
}
function summaryClaim(item, candidate) {
  return `<td><span class="comparison-mobile-name">${escapeHTML(candidate)}</span><span class="claim-basis">${escapeHTML(item.basis)}</span><p>${escapeHTML(item.text)}</p><div class="claim-sources">${summarySourceLinks(item.sources)}</div></td>`;
}
function comparison(r) {
  const isRace = r.candidates?.length === 2;
  if (!isRace && !r.text) return '';
  const content = isRace ? summaries?.races?.[r.id] : summaries?.amendments?.[r.id];
  const label = isRace ? 'Compare candidates' : 'Understand this amendment';
  let body = '<p class="summary-method">The saved summary could not load. Your ballot checklist is still available; reload to try again.</p>';
  if (content && isRace) {
    const names = r.candidates.map(c=>c.name);
    const row = (topic,positions) => `<tr><th scope="row">${escapeHTML(topic)}</th>${positions.map((p,i)=>summaryClaim(p,names[i])).join('')}</tr>`;
    body = `<p class="summary-method">${escapeHTML(summaries.methodology)}</p><table class="comparison-table"><caption class="sr-only">${escapeHTML(r.title)}: issues, voting and service records, and endorsements</caption><thead><tr><th scope="col">Issue</th>${names.map(n=>`<th scope="col">${escapeHTML(n)}</th>`).join('')}</tr></thead><tbody>${content.issues.map(i=>row(i.topic,i.positions)).join('')}${row('Voting & service record',content.records)}${row('Endorsements',content.endorsements)}</tbody></table><p class="summary-footnote">Open the sources for context. This tool does not endorse candidates or predict future votes.</p>`;
  } else if (content) {
    body = `<p class="summary-method">AI-written explanation based on PARCA’s guide · October 29, 2026. Not written or endorsed by PARCA.</p><h5>${escapeHTML(content.topic)}</h5><dl class="amendment-summary"><dt>A YES vote</dt><dd>${escapeHTML(content.yes)}</dd><dt>A NO vote</dt><dd>${escapeHTML(content.no)}</dd><dt>Context</dt><dd>${escapeHTML(content.context)}</dd></dl><div class="claim-sources">${summarySourceLinks(content.sources)}</div><p class="summary-footnote">Read the full ballot wording above and the linked analysis before deciding.</p>`;
  }
  return `<details class="comparison" data-comparison="${r.id}" ${openedComparisons.has(r.id)?'open':''}><summary><span>${label}</span><span class="summary-tag">AI summary</span></summary><div class="comparison-body">${body}</div></details>`;
}
function render() {
  const all=allItems(), visible=filter==='All contests'?all:all.filter(x=>x.group===filter);
  const allowed=new Set(all.map(x=>x.id)); for(const id of selection.keys()) if(!allowed.has(id)) selection.delete(id);
  $('filters').innerHTML=filters.map(f=>`<button class="filter ${f===filter?'active':''}" aria-pressed="${f===filter}" data-filter="${f}">${f}<span>${f==='All contests'?all.length:all.filter(x=>x.group===f).length}</span></button>`).join('');
  $('contests-heading').textContent=filter;
  $('race-count').textContent=`${visible.length} contest${visible.length===1?'':'s'}`;
  $('contests').innerHTML=visible.length?visible.map(r=>`<article class="contest"><span class="scope">${escapeHTML(r.scope||'Ballot measure')}</span><h4>${escapeHTML(r.title)}</h4>${r.text?`<p class="amend-text">${escapeHTML(r.text)}</p>`:`<p class="vote-note"><a class="office-link" href="offices/${encodeURIComponent(r.id)}.html" target="_blank" rel="noopener noreferrer" aria-label="What does this office do? ${escapeHTML(r.title)} (opens in a new tab)">What does this office do? ↗</a></p>`}<div role="group" aria-label="${escapeHTML(r.title)}">${options(r)}</div><button class="text-button" data-reset="${r.id}" style="font-size:10px">Clear this contest</button>${comparison(r)}</article>`).join(''):'<p class="empty">No matched contests in this category. Check the district confirmation section above.</p>';
  const unknown=[];
  if(mode!=='browse') {
    if(!districts.senate)unknown.push('State Senate');
    if(!districts.house)unknown.push('State House');
    if(!districts.congress)unknown.push('U.S. House');
    if(!districts.countySchool)unknown.push('county schools');
    if(districts.countySchool==='yes'&&!districts.countyBoard)unknown.push('county school board');
  }
  $('pending').hidden=mode==='browse'||!unknown.length;
  $('pending').textContent=`Still to confirm: ${unknown.join(', ')}. Unresolved district contests are excluded from this checklist. Confirm your districts above before treating it as complete.`;
  updateSchoolQuestion();
  updateSelectionCount();
}
function updateSchoolQuestion() {
  $('school-check').hidden = mode === 'browse';
  const county = districts.countySchool === 'yes';
  $('county-board-field').hidden = !county;
  $('county-board').disabled = !county;
  $('school-status').textContent = county
    ? `County superintendent included.${districts.countyBoard === '3' ? ' County Board of Education District 3 included.' : districts.countyBoard === 'other' ? ' District 3 board race excluded for your selected district.' : ' Confirm your county board district to include the correct board race.'} Based on your answer; confirm with election officials.`
    : districts.countySchool === 'no'
      ? 'County superintendent and county board races excluded based on your answer.'
      : 'County school races stay off your checklist until you confirm your school electorate.';
}
function resetSchoolQuestion() {
  document.querySelector('input[name="school-area"][value=""]').checked = true;
  $('county-board').value = '';
}
$('school-area').addEventListener('change', e => {
  if (e.target.name !== 'school-area' || mode === 'browse') return;
  districts.countySchool = e.target.value;
  districts.countyBoard = '';
  $('county-board').value = '';
  render();
});
$('county-board').addEventListener('change', () => {
  if (mode === 'browse' || districts.countySchool !== 'yes') return;
  districts.countyBoard = $('county-board').value;
  render();
});
function fillSelects() {
  for(const [id,scope] of [['senate','State Senate'],['house','State House']]) {
    [...new Set(data.races.filter(r=>r.scope===scope).map(r=>r.district))].sort((a,b)=>a-b).forEach(d=>{const o=document.createElement('option');o.value=d;o.textContent=`District ${d}`;$(id).append(o);});
  }
}
function renderSummary() {
  $('lookup-summary').innerHTML=summaryCard('County','Madison, Alabama')+summaryCard('State Senate',districts.senate?`District ${districts.senate}`:'Unresolved',districts.manual?'Self-reported':'Census 2026 boundaries')+summaryCard('State House',districts.house?`District ${districts.house}`:'Unresolved',districts.manual?'Self-reported':'Census 2026 boundaries')+summaryCard('U.S. House',districts.congress?`District ${districts.congress}`:'Unresolved','120th Congress boundaries');
  if(districts.precinct) $('lookup-summary').innerHTML+=summaryCard(`County GIS precinct ${districts.precinct.PrecNum}`,districts.precinct.PlaceNam,districts.precinct.Address);
}
async function lookupCandidate(candidate, token) {
  $('matches').hidden=true; busy(true,'Matching precinct & districts…'); announce('Checking official geographic sources…');
  try {
    const results=await Promise.allSettled([spatialQuery(countyBase,candidate.location),...[0,1,2].map(id=>spatialQuery(`${censusBase}/${id}`,candidate.location))]);
    if(token!==request)return;
    if(results[0].status!=='fulfilled') throw new Error('The county precinct service is unavailable. Please try again, or use the official voter lookup.');
    const precincts=results[0].value.features;
    if(!precincts?.length)throw new Error('No Madison County precinct covers this address in the county map. Check your address or use the official voter lookup. We have not assigned a ballot.');
    if(precincts.length!==1)throw new Error('This point overlaps multiple precincts. An election official must confirm the correct precinct before a ballot can be assigned.');
    mode='matched';filter='All contests';selection.clear();
    districts={congress:getDistrict(results[1]),senate:getDistrict(results[2]),house:getDistrict(results[3]),precinct:precincts[0].attributes};
    $('senate').value=districts.senate||''; $('house').value=districts.house||''; resetSchoolQuestion();
    $('result-kicker').textContent='ADDRESS MATCH · DISTRICTS ESTIMATED';
    $('result-title').textContent='Your sample ballot explorer';
    $('result-address').textContent=candidate.address;
    $('result-notice').textContent='This is a draft checklist from the supplied November 3, 2026 sample, filtered by geographic boundaries. State school board District 8 is included countywide. County school races require confirmation below. The county GIS polling place is shown for reference; confirm it and your official ballot style with Alabama VoterView.';
    renderSummary(); announce('Address matched. Review the draft checklist below.');showResults();
  } catch(error) { if(token===request)announce(error.message||'The lookup did not complete. Please try again.'); }
  finally { if(token===request)busy(false); }
}
$('address-form').addEventListener('submit',async event=>{
  event.preventDefault();const token=++request;busy(true);announce('');$('matches').hidden=true;
  // Hide previous results so an unsuccessful search never leaves a stale ballot assigned.
  $('results').hidden=true;
  try {
    const street=$('street').value.trim(),city=$('city').value.trim(),zip=$('zip').value.trim();
    if(!/^\d+\s+\S/.test(street))throw new Error('Enter a full residential street address, including the house number.');
    const result=await getJSON('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates',{SingleLine:`${street}, ${city}, AL ${zip}`,countryCode:'USA',outFields:'Addr_type,RegionAbbr,Postal',outSR:'4326',maxLocations:'5',forStorage:'false'});
    if(token!==request)return;
    const matches=(result.candidates||[]).filter(c=>c.score>=90&&['PointAddress','StreetAddress','Subaddress'].includes(c.attributes.Addr_type)&&c.attributes.RegionAbbr==='AL'&&String(c.attributes.Postal)===zip);
    if(!matches.length)throw new Error('We couldn’t confidently match that street address and ZIP code. Check the details and try again.');
    $('match-list').replaceChildren();
    matches.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='match';b.textContent=c.address+' →';b.addEventListener('click',()=>lookupCandidate(c,token));$('match-list').append(b);});
    $('matches').hidden=false;announce('Address found. Confirm the exact match below.');$('match-list').firstChild.focus();
  } catch(error) {if(token===request)announce(error.message||'Address service unavailable. Please try again.');}
  finally {if(token===request)busy(false);}
});
$('browse').addEventListener('click',()=>{
  if(!data)return; ++request;busy(false);$('matches').hidden=true;announce('');mode='browse';districts={};filter='All contests';selection.clear();
  for(const id of ['senate','house'])$(id).value=''; resetSchoolQuestion();
  $('result-kicker').textContent='COUNTY SAMPLE · ALL DISTRICTS';$('result-title').textContent='Explore the Madison County sample';$('result-address').textContent='November 3, 2026 · General and Constitutional Amendment Election';
  $('lookup-summary').innerHTML=summaryCard('Source','Provided county PDF')+summaryCard('Contests',data.races.length,'Includes different districts')+summaryCard('Amendments',data.amendments.length)+summaryCard('Address match','Not performed');
  $('result-notice').textContent='County browsing shows every race found in the supplied PDF, including mutually exclusive districts. This is not a personalized ballot. Start with your address above to filter district races.';showResults();
});
$('apply-districts').addEventListener('click',()=>{
  if(mode==='browse') { $('result-notice').textContent='Start with an address lookup to confirm Madison County coverage before applying district information.';return; }
  districts={...districts,senate:Number($('senate').value)||null,house:Number($('house').value)||null,manual:true};
  $('result-notice').textContent='Checklist updated using your self-reported districts. These entries have not been verified by this app. Confirm your official ballot style with election officials. Unconfirmed district races remain excluded.';renderSummary();render();
});
$('filters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(b){filter=b.dataset.filter;render();}});
$('contests').addEventListener('change',e=>{if(e.target.matches('input[type=radio]')){const radio=e.target;selection.set(radio.name,{value:radio.value});updateSelectionCount();}});
$('contests').addEventListener('toggle',e=>{const id=e.target.dataset.comparison;if(id){if(e.target.open)openedComparisons.add(id);else openedComparisons.delete(id);}},true);
$('contests').addEventListener('click',e=>{const b=e.target.closest('[data-reset]');if(b){selection.delete(b.dataset.reset);render();}});
$('clear').addEventListener('click',()=>{selection.clear();render();});
const printPreview = document.createElement('dialog');
printPreview.id = 'print-preview';
printPreview.setAttribute('aria-labelledby','print-preview-title');
printPreview.innerHTML = `<div class="print-preview-toolbar"><div><h2 id="print-preview-title">Your compact checklist</h2><p>Two columns, your choices, and space for undecided contests. Prints every contest on your checklist, regardless of the active filter.</p></div><div class="print-preview-actions"><button type="button" class="secondary" id="close-print-preview">Back to ballot</button><button type="button" class="primary" id="confirm-print">Print checklist</button></div></div><section id="print-checklist" aria-label="Printable ballot checklist"></section>`;
document.body.append(printPreview);
function preparePrintChecklist() {
  const sheet = $('print-checklist');
  if (!data || $('results').hidden) { sheet.innerHTML=''; return; }
  const items = allItems();
  const selected = items.filter(r=>selection.has(r.id)).length;
  const precinct = districts.precinct;
  const context = mode === 'browse'
    ? 'COUNTY SAMPLE · ALL DISTRICTS · Not a personalized ballot; includes mutually exclusive district races.'
    : `DRAFT ADDRESS-MATCHED CHECKLIST${districts.manual?' · Includes self-reported districts':''}`;
  const place = precinct ? `<p class="print-location">County GIS precinct ${escapeHTML(precinct.PrecNum)} · ${escapeHTML(precinct.PlaceNam)} · ${escapeHTML(precinct.Address)}</p>` : '';
  const entries = items.map(r=>{
    const value = selection.get(r.id)?.value;
    const choice = r.candidates ? r.candidates[Number(value)] : value==='0'?{name:'YES'}:value==='1'?{name:'NO'}:null;
    const topic = !r.candidates ? summaries?.amendments?.[r.id]?.topic : '';
    const title = topic ? `${r.title} — ${topic}` : r.title;
    return `<article class="print-contest"><h3>${escapeHTML(title)}</h3><p><span class="print-mark" aria-hidden="true">${choice?'X':''}</span>${choice?`<strong>${escapeHTML(choice.name)}</strong>${choice.party?` <span class="print-party">(${escapeHTML(choice.party)})</span>`:''}`:'<span class="print-undecided">Undecided <span class="print-write-line"></span></span>'}</p></article>`;
  }).join('');
  sheet.innerHTML = `<header class="print-heading"><h1>My voting checklist</h1><p class="print-election">Madison County, Alabama · November 3, 2026</p><p class="print-context">${escapeHTML(context)}</p>${place}<p class="print-tally">${selected} of ${items.length} contests selected · X = your choice · blank = undecided</p></header><div class="print-items">${entries}</div><footer class="print-footer"><p>${mode==='browse'?'Look up your address before using this as a personal checklist. ':''}Personal notes, not an official ballot. Confirm your ballot and polling place: myinfo.alabamavotes.gov/VoterView.</p>${!$('pending').hidden?`<p>${escapeHTML($('pending').textContent)}</p>`:''}<p>Amendments are abbreviated here; review the full ballot wording before voting.</p></footer>`;
}
function printChecklist(){preparePrintChecklist();if(!printPreview.open)printPreview.showModal();}
$('close-print-preview').addEventListener('click',()=>printPreview.close());
$('confirm-print').addEventListener('click',()=>window.print());
window.addEventListener('beforeprint',preparePrintChecklist);
for(const id of ['print','print-bottom'])$(id).addEventListener('click',printChecklist);
async function init(){
  $('find').disabled=true;$('browse').disabled=true;
  const summaryLoad=fetch('comparisons.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(json=>{summaries=json;if(!$('results').hidden)render();}).catch(()=>{summaries=null;});
  try{const r=await fetch('ballot.json');if(!r.ok)throw Error();data=await r.json();fillSelects();$('find').disabled=false;$('browse').disabled=false;}catch{announce('The ballot source could not load. Reload the page or open the original PDF below.');}
  await summaryLoad;
}
init();
