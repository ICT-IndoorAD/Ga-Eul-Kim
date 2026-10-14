const LABELS={dht_temp_C:"DHT 온도",dht_humi_pct:"DHT 습도",am_temp_C:"AM 온도",am_humi_pct:"AM 습도",co2_ppm:"CO₂",voc_level:"VOC",pm25_ugm3:"PM2.5"};
const UNITS={dht_temp_C:"℃",dht_humi_pct:"%",am_temp_C:"℃",am_humi_pct:"%",co2_ppm:"ppm",voc_level:"단계",pm25_ugm3:"µg/m³"};
let DATA=null, activeRange="all", OUTDOOR=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fmt=(n,d=0)=>n==null||Number.isNaN(+n)?"—":Number(n).toLocaleString("ko-KR",{maximumFractionDigits:d});
const dt=v=>new Date(v).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});

fetch("data/dashboard_data.json").then(r=>r.json()).then(d=>{DATA=d;render();fetchOutdoor(37.5665,126.978,"서울");}).catch(()=>{$("#dataNotice span").textContent="데이터 파일을 불러오지 못했습니다. 로컬 서버로 실행해 주세요."});

$$('.nav-item').forEach(b=>b.onclick=()=>{$$('.nav-item,.view').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.view).classList.add('active');});
$$('.range-btn').forEach(b=>b.onclick=()=>{$$('.range-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeRange=b.dataset.range;renderCharts();});
$('#resetData').onclick=()=>location.reload();
$('#csvUpload').onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>useUploadedCsv(reader.result,file.name);reader.readAsText(file);};
$('#citySearch').onclick=searchCity;
$('#useSeoul').onclick=()=>{$('#cityInput').value='서울';fetchOutdoor(37.5665,126.978,'서울');};
$('#experimentForm').onsubmit=saveExperiment;
$('#clearExperiments').onclick=()=>{localStorage.removeItem('ict-air-experiments');renderExperiments();};

function statusFor(key,value){
  if(value==null)return["결측","bad"];
  if(key==='co2_ppm')return value>=1500?["매우 나쁨","bad"]:value>=1000?["나쁨","bad"]:value>=800?["보통","warn"]:["좋음",""];
  if(key==='pm25_ugm3')return value>75?["매우 나쁨","bad"]:value>35?["나쁨","bad"]:value>15?["보통","warn"]:["좋음",""];
  if(key==='voc_level')return value>=3?["매우 나쁨","bad"]:value>=2?["주의","warn"]:["좋음",""];
  if(key.includes('temp'))return value>=20&&value<26?["쾌적",""]:["확인","warn"];
  return value>=40&&value<=60?["적정",""]:["확인","warn"];
}

function render(){
  const s=DATA.summary,l=s.latest;
  $('#latestTime').textContent=`${dt(s.latest_timestamp)} 기준`;
  const keys=['dht_temp_C','dht_humi_pct','co2_ppm','pm25_ugm3','voc_level'];
  $('#kpiGrid').innerHTML=keys.map(k=>{const [st,cls]=statusFor(k,l[k]);return `<article class="kpi"><div class="kpi-top"><span class="kpi-label">${LABELS[k]}</span><span class="chip ${cls}">${st}</span></div><strong>${fmt(l[k],k.includes('temp')?1:0)} <small>${UNITS[k]}</small></strong><small>${k==='co2_ppm'?'고정값 여부 함께 확인':k==='pm25_ugm3'?'1분 평균과 함께 판단':'마지막 측정값'}</small></article>`}).join('');
  $('#observedHours').textContent=`${fmt(s.observed_hours,2)}시간`;$('#comfortPct').textContent=`${fmt(s.comfort_pct,1)}%`;$('#sessionCount').textContent=`${s.sessions}개`;$('#maxGap').textContent=`최대 중단 ${fmt(s.max_gap_hours,2)}시간`;
  $('#pmMax').textContent=`${fmt(s.pm25_max)} µg/m³`;$('#co2Max').textContent=`${fmt(s.co2_max)} ppm`;$('#pmOver').textContent=`${fmt(s.pm25_over_35_pct,2)}%`;
  renderPrediction();renderEvents();renderCharts();renderAppliedInsights();renderDecision();renderExperiments();
}

function renderPrediction(){
  const s=DATA.summary;const variablePct=100-s.co2_fixed_rows/s.rows*100;const score=Math.max(8,Math.min(100,Math.round(variablePct*2+s.sessions*4+6)));
  $('#readinessScore').textContent=score;$('.readiness-ring').style.background=`conic-gradient(${score>=70?'var(--teal)':score>=40?'var(--yellow)':'var(--red)'} 0 ${score}%,#edf1f2 ${score}% 100%)`;
  $('#predictionBadge').textContent=score>=70?'가능':score>=40?'제한적':'중지';$('#predictionBadge').className=`badge ${score<70?'bad':''}`;
  $('#predictionTitle').textContent=score>=70?'5~10분 단기 예측을 시험할 수 있습니다':'현재 데이터로 CO₂ 예측을 권장하지 않습니다';
  $('#predictionText').textContent=`전체 ${fmt(s.rows)}행 중 ${fmt(s.co2_fixed_rows)}행의 CO₂가 813 ppm입니다. 고정값은 예측 신호로 사용할 수 없습니다.`;
  $('#predictionChecklist').innerHTML=[['1초 기록 간격 확보',true],['연속 24시간 이상 확보',s.observed_hours>=24],['CO₂ 정상 변동 확보',variablePct>=70],['실험 조건 메타데이터',false]].map(([t,ok])=>`<li class="${ok?'ok':''}">${t}</li>`).join('');
}

function sensorState(r){if(['am_temp_C','am_humi_pct','co2_ppm'].includes(r.key)&&r.longest_constant_rows>10000)return['고정값 의심','bad'];if(r.missing>0)return['일부 결측','warn'];return['사용 가능',''];}
function renderQuality(){
  const s=DATA.summary;$('#qualitySummary').innerHTML=`<div class="score">주의</div><div><strong>AM 센서 계열에서 장시간 고정값이 발견됐습니다.</strong><p>AM 온도 0℃·습도 99% 패턴이 ${fmt(s.am_suspect_pct,2)}%이며, CO₂ 813 ppm이 ${fmt(s.co2_fixed_rows)}행 지속됐습니다.</p></div>`;
  $('#sensorTable').innerHTML=DATA.sensors.map(r=>{const[st,cl]=sensorState(r);return `<tr><td><strong>${LABELS[r.key]}</strong></td><td><span class="state ${cl}">${st}</span></td><td>${fmt(r.min,1)}</td><td>${fmt(r.mean,1)}</td><td>${fmt(r.max,1)}</td><td>${fmt(r.unique)}</td><td>${fmt(r.longest_constant_rows)}행</td><td>${fmt(r.missing)}</td></tr>`}).join('');
  $('#sessionTable').innerHTML=DATA.sessions.map(r=>`<tr><td>${r.session}</td><td>${dt(r.start)}</td><td>${dt(r.end)}</td><td>${fmt(r.duration_min,1)}분</td><td>${fmt(r.rows)}</td><td>${fmt(r.co2_mean,1)} ppm</td><td>${fmt(r.co2_max)} ppm</td><td><span class="state ${r.suspect_pct>.5?'bad':''}">${fmt(r.suspect_pct*100,1)}%</span></td></tr>`).join('');
}

function renderEvents(){
  $('#eventList').innerHTML=DATA.events.length?DATA.events.map(e=>`<article class="event-item ${e.type.startsWith('PM')?'pm':''}"><span class="event-bar"></span><div><h3>${e.type}</h3><p>${dt(e.start)} ~ ${dt(e.end)}</p></div><div class="event-value"><strong>${fmt(e.duration_min,2)}분</strong><small>${e.type.startsWith('PM')?'최대 '+fmt(e.peak_pm25)+' µg/m³':'최대 '+fmt(e.peak_co2)+' ppm'}</small></div></article>`).join(''):'<div class="empty">감지된 이벤트가 없습니다.</div>';
}

function rangedRows(){const rows=DATA.minute;if(activeRange==='all'||!rows.length)return rows;const count=(activeRange==='24h'?24:6)*60;return rows.slice(-count);}
function renderCharts(){if(!DATA)return;const rows=rangedRows();lineChart('#co2Chart',rows,[{key:'co2',color:'#ef8d32',label:'CO₂'}],[800,1000,1500],'ppm');lineChart('#pmChart',rows,[{key:'pm25',color:'#3978b9',label:'1분 평균'},{key:'pm25_max',color:'#c94f4f',label:'1분 최대'}],[15,35],'µg/m³');lineChart('#climateChart',rows,[{key:'dht_temp',color:'#ef8d32',label:'온도'},{key:'dht_humi',color:'#167d78',label:'습도'}],[], '℃ / %');}
function lineChart(sel,rows,series,thresholds,unit){
  const el=$(sel),W=900,H=290,p={l:48,r:16,t:18,b:35};if(!rows.length){el.innerHTML='<div class="empty">표시할 데이터가 없습니다.</div>';return;}
  const all=series.flatMap(s=>rows.map(r=>+r[s.key]).filter(Number.isFinite)).concat(thresholds);let lo=Math.min(...all),hi=Math.max(...all);if(lo===hi){lo-=1;hi+=1}const pad=(hi-lo)*.08;lo=Math.max(0,lo-pad);hi+=pad;const x=i=>p.l+i/(Math.max(1,rows.length-1))*(W-p.l-p.r),y=v=>p.t+(hi-v)/(hi-lo)*(H-p.t-p.b);
  let svg=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,yy=y(v);svg+=`<line x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}" stroke="#e5edef"/><text x="${p.l-8}" y="${yy+4}" text-anchor="end" fill="#71848b" font-size="10">${fmt(v,v<10?1:0)}</text>`}
  thresholds.forEach((v,i)=>svg+=`<line x1="${p.l}" y1="${y(v)}" x2="${W-p.r}" y2="${y(v)}" stroke="${i?'#c94f4f':'#d6a62c'}" stroke-dasharray="6 5" opacity=".75"/>`);
  series.forEach(s=>{let d='',started=false,prevTime=null;rows.forEach((r,i)=>{const v=+r[s.key],time=new Date(r.timestamp).getTime();if(!Number.isFinite(v)){started=false;prevTime=null;return}if(prevTime!==null&&time-prevTime>5*60000)started=false;d+=`${started?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;started=true;prevTime=time});svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`});
  const stamps=[0,Math.floor((rows.length-1)/2),rows.length-1];stamps.forEach(i=>svg+=`<text x="${x(i)}" y="${H-10}" text-anchor="middle" fill="#71848b" font-size="10">${dt(rows[i].timestamp)}</text>`);svg+=`<text x="8" y="14" fill="#71848b" font-size="10">${unit}</text></svg>`;el.innerHTML=svg;
}

async function searchCity(){
  const name=$('#cityInput').value.trim();if(!name)return;
  $('#outdoorStatus span').textContent=`${name} 위치를 검색하는 중입니다.`;
  try{const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=ko&format=json`);const d=await r.json();if(!d.results?.length)throw new Error('검색 결과 없음');const p=d.results[0];await fetchOutdoor(p.latitude,p.longitude,`${p.name}${p.admin1?' · '+p.admin1:''}`);}catch(e){showOutdoorError('도시를 찾지 못했습니다. 도시 이름을 다시 확인해 주세요.');}
}

async function fetchOutdoor(lat,lon,name){
  $('#outdoorStatus span').textContent=`${name}의 날씨와 대기질을 불러오는 중입니다.`;
  try{
    const weather=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=auto`;
    const air=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5&timezone=auto`;
    const [wr,ar]=await Promise.all([fetch(weather),fetch(air)]);if(!wr.ok||!ar.ok)throw new Error('API 응답 오류');const [w,a]=await Promise.all([wr.json(),ar.json()]);
    OUTDOOR={name,temp:w.current.temperature_2m,humi:w.current.relative_humidity_2m,wind:w.current.wind_speed_10m,pm25:a.current.pm2_5,time:w.current.time};
    $('#outdoorStatus span').textContent=`${name} · ${new Date(OUTDOOR.time).toLocaleString('ko-KR')} 외부 관측값`;
    renderOutdoor();renderDecision();
  }catch(e){showOutdoorError('외부 데이터를 불러오지 못했습니다. 실내 데이터만으로 화면을 유지합니다.');}
}
function showOutdoorError(message){OUTDOOR=null;$('#outdoorStatus').className='notice warning';$('#outdoorStatus span').textContent=message;renderOutdoor();renderDecision();}
function renderOutdoor(){
  if(!DATA)return;const l=DATA.summary.latest;
  $('#indoorTemp').textContent=`${fmt(l.dht_temp_C,1)}℃`;$('#indoorHumi').textContent=`${fmt(l.dht_humi_pct)}%`;$('#indoorPm').textContent=`${fmt(l.pm25_ugm3)} µg/m³`;
  if(!OUTDOOR){['#outdoorTemp','#outdoorHumi','#outdoorPm','#outdoorWind'].forEach(x=>$(x).textContent='—');$('#tempDiff').textContent=$('#humiDiff').textContent=$('#pmDiff').textContent='외부 데이터 없음';return;}
  $('#outdoorTemp').textContent=`${fmt(OUTDOOR.temp,1)}℃`;$('#outdoorHumi').textContent=`${fmt(OUTDOOR.humi)}%`;$('#outdoorPm').textContent=`${fmt(OUTDOOR.pm25,1)} µg/m³`;$('#outdoorWind').textContent=`${fmt(OUTDOOR.wind,1)} km/h`;$('#locationName').textContent=OUTDOOR.name;
  $('#tempDiff').textContent=`실내가 ${Math.abs(l.dht_temp_C-OUTDOOR.temp).toFixed(1)}℃ ${l.dht_temp_C>=OUTDOOR.temp?'높음':'낮음'}`;
  $('#humiDiff').textContent=`실내가 ${Math.abs(l.dht_humi_pct-OUTDOOR.humi).toFixed(0)}%p ${l.dht_humi_pct>=OUTDOOR.humi?'높음':'낮음'}`;
  $('#pmDiff').textContent=`실내가 ${Math.abs(l.pm25_ugm3-OUTDOOR.pm25).toFixed(1)} µg/m³ ${l.pm25_ugm3>=OUTDOOR.pm25?'높음':'낮음'}`;
}
function renderDecision(){
  if(!DATA)return;const l=DATA.summary.latest;let title='현재 실내환경을 유지하세요',reason='온습도와 PM2.5가 안정 범위에 있습니다.',badge='유지';
  if(OUTDOOR){
    if(l.co2_ppm>=1000&&OUTDOOR.pm25<=35){title='5~10분 환기를 권장합니다';reason='CO₂가 높고 외부 PM2.5가 환기 가능한 수준입니다.';badge='환기 권장';}
    else if(l.pm25_ugm3>OUTDOOR.pm25+5&&OUTDOOR.pm25<=35){title='외부 공기를 이용한 환기가 유리합니다';reason=`외부 PM2.5가 실내보다 ${fmt(l.pm25_ugm3-OUTDOOR.pm25,1)} µg/m³ 낮습니다.`;badge='환기 가능';}
    else if(OUTDOOR.pm25>35){title='창문 환기를 잠시 미루세요';reason='외부 PM2.5가 높아 짧은 환기 또는 기계환기가 적합합니다.';badge='외기 주의';}
  }else if(l.co2_ppm>=1000){title='CO₂ 상승을 확인하세요';reason='외부 데이터가 없어 환기 방식은 판단할 수 없습니다.';badge='확인 필요';}
  $('#decisionTitle').textContent=title;$('#decisionReason').textContent=reason;$('#decisionBadge').textContent=badge;$('#decisionDetail').textContent=OUTDOOR?`${OUTDOOR.name} 외부환경 반영`:'실내 데이터 기준';
  $('#compareActionTitle').textContent=title;$('#compareActionText').textContent=reason;
}
function renderAppliedInsights(){
  if(!DATA)return;const s=DATA.summary,l=s.latest,events=DATA.events.filter(e=>e.type.startsWith('PM'));const exposure=events.reduce((a,e)=>a+e.duration_min,0);
  const a=17.27,b=237.7,g=(a*l.dht_temp_C)/(b+l.dht_temp_C)+Math.log(l.dht_humi_pct/100),dew=(b*g)/(a-g);
  $('#insightComfort').textContent=`${fmt(s.comfort_pct,1)}%`;$('#exposureMinutes').textContent=`${fmt(exposure,1)}분`;$('#dewPoint').textContent=`${fmt(dew,1)}℃`;$('#condensationText').textContent=l.dht_temp_C-dew<3?'결로 위험 높음':'결로 위험 낮음';$('#cleanRows').textContent=fmt(s.analysis_rows);$('#excludedRows').textContent=`${fmt(s.excluded_rows)}행 제외`;
  const rows=DATA.minute.slice(-60);const forecast=(key)=>{const vals=rows.map(r=>+r[key]).filter(Number.isFinite);if(vals.length<10)return null;const n=vals.length,meanX=(n-1)/2,meanY=vals.reduce((x,y)=>x+y,0)/n;let num=0,den=0;vals.forEach((v,i)=>{num+=(i-meanX)*(v-meanY);den+=(i-meanX)**2});const slope=num/den;return{value:vals.at(-1)+slope*10,slope};};
  const tf=forecast('dht_temp'),hf=forecast('dht_humi');$('#tempForecast').textContent=tf?`${fmt(tf.value,1)}℃`:'—';$('#humiForecast').textContent=hf?`${fmt(hf.value,1)}%`:'—';$('#tempTrend').textContent=tf?`분당 ${tf.slope>=0?'+':''}${tf.slope.toFixed(3)}℃`:'데이터 부족';$('#humiTrend').textContent=hf?`분당 ${hf.slope>=0?'+':''}${hf.slope.toFixed(3)}%p`:'데이터 부족';
}
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function readExperiments(){try{return JSON.parse(localStorage.getItem('ict-air-experiments')||'[]')}catch{return[]}}
function saveExperiment(e){
  e.preventDefault();const list=readExperiments(),l=DATA?.summary?.latest||{};
  list.unshift({id:Date.now(),time:new Date().toISOString(),dataTime:DATA?.summary?.latest_timestamp||null,label:$('#experimentLabel').value.trim(),people:$('#peopleCount').value,window:$('#windowState').value,fan:$('#fanState').value,note:$('#experimentNote').value.trim(),baseline:{temp:l.dht_temp_C,humi:l.dht_humi_pct,co2:l.co2_ppm,pm25:l.pm25_ugm3}});
  localStorage.setItem('ict-air-experiments',JSON.stringify(list.slice(0,50)));e.target.reset();renderExperiments();
}
function deleteExperiment(id){localStorage.setItem('ict-air-experiments',JSON.stringify(readExperiments().filter(x=>x.id!==id)));renderExperiments();}
function expectedExperimentEffect(x){
  if(x.window==='열림'||x.fan==='켜짐')return '환기 후 CO₂·PM2.5 감소 여부를 확인합니다.';
  if(+x.people>0)return '인원 체류 후 CO₂·온습도 상승 여부를 확인합니다.';
  return '기록 전후 센서값의 변화를 비교합니다.';
}
function experimentResult(x){
  if(!x.baseline||!x.dataTime)return{state:'unavailable',title:'결과 계산 불가',text:'이 기록은 기준 센서값 저장 기능이 추가되기 전에 만들어졌습니다.'};
  const start=new Date(x.dataTime).getTime(),target=start+10*60000;
  const after=DATA.minute.find(r=>new Date(r.timestamp).getTime()>=target);
  if(!after)return{state:'waiting',title:'측정 결과 대기',text:`센서 기준시각 ${dt(x.dataTime)} 이후 10분 이상의 새 CSV 데이터가 필요합니다.`};
  const changes=[['온도',after.dht_temp-x.baseline.temp,'℃',1],['습도',after.dht_humi-x.baseline.humi,'%p',1],['CO₂',after.co2-x.baseline.co2,' ppm',0],['PM2.5',after.pm25-x.baseline.pm25,' µg/m³',1]];
  return{state:'done',title:'10분 후 실제 변화',text:changes.map(([n,v,u,d])=>`${n} ${v>=0?'+':''}${fmt(v,d)}${u}`).join(' · ')};
}
function renderExperiments(){
  const el=$('#experimentList');if(!el)return;const list=readExperiments();
  el.innerHTML=list.length?list.map(x=>{const result=experimentResult(x),base=x.baseline?`기준값: ${fmt(x.baseline.temp,1)}℃ · ${fmt(x.baseline.humi,1)}% · CO₂ ${fmt(x.baseline.co2)} ppm · PM2.5 ${fmt(x.baseline.pm25,1)}`:'기준값 없음';return `<div class="experiment-entry"><time>기록 ${dt(x.time)}</time><div class="experiment-content"><strong>${esc(x.label)}</strong><p>인원 ${esc(x.people||'미기록')}명 · 창문 ${esc(x.window)} · 환기장치 ${esc(x.fan)}${x.note?' · '+esc(x.note):''}</p><div class="experiment-baseline">${base}</div><div class="experiment-expected"><b>예상 효과</b><span>${expectedExperimentEffect(x)}</span></div><div class="experiment-result ${result.state}"><b>${result.title}</b><span>${result.text}</span></div></div><button data-delete-experiment="${x.id}">삭제</button></div>`}).join(''):'<div class="empty">아직 저장된 실험 기록이 없습니다.</div>';
  el.querySelectorAll('[data-delete-experiment]').forEach(b=>b.onclick=()=>deleteExperiment(+b.dataset.deleteExperiment));
}

function parseCsv(text){const lines=text.trim().split(/\r?\n/),heads=lines.shift().split(',');return lines.map(line=>{const vals=line.split(',');return Object.fromEntries(heads.map((h,i)=>[h.trim(),vals[i]?.trim()]))});}
function useUploadedCsv(text,name){
  const rows=parseCsv(text);if(!rows.length||!('timestamp'in rows[0])){alert('지원하는 air_log.csv 형식이 아닙니다.');return;}
  const nums=['dht_temp_C','dht_humi_pct','am_temp_C','am_humi_pct','co2_ppm','voc_level','pm25_ugm3'];const clean=rows.map(r=>{const o={timestamp:new Date(r.timestamp)};nums.forEach(k=>o[k]=r[k]===''?null:+r[k]);return o}).filter(r=>!isNaN(r.timestamp));
  const buckets=new Map();clean.forEach(r=>{const k=new Date(Math.floor(r.timestamp/60000)*60000).toISOString();if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r)});const avg=(a,k)=>{const v=a.map(x=>x[k]).filter(Number.isFinite);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null};
  DATA.minute=[...buckets].map(([timestamp,a])=>({timestamp,dht_temp:avg(a,'dht_temp_C'),dht_humi:avg(a,'dht_humi_pct'),am_temp:avg(a,'am_temp_C'),am_humi:avg(a,'am_humi_pct'),co2:avg(a,'co2_ppm'),voc:Math.max(...a.map(x=>x.voc_level||0)),pm25:avg(a,'pm25_ugm3'),pm25_max:Math.max(...a.map(x=>x.pm25_ugm3||0)),rows:a.length}));
  const last=clean.at(-1),co2fixed=clean.filter(x=>x.co2_ppm===813).length,span=(clean.at(-1).timestamp-clean[0].timestamp)/3600000;DATA.summary={...DATA.summary,rows:clean.length,start:clean[0].timestamp.toISOString(),end:last.timestamp.toISOString(),observed_hours:span,latest:Object.fromEntries(nums.map(k=>[k,last[k]])),latest_timestamp:last.timestamp.toISOString(),co2_fixed_rows:co2fixed,co2_max:Math.max(...clean.map(x=>x.co2_ppm||0)),pm25_max:Math.max(...clean.map(x=>x.pm25_ugm3||0)),pm25_over_35_pct:clean.filter(x=>x.pm25_ugm3>35).length/clean.length*100,comfort_pct:clean.filter(x=>x.dht_temp_C>=20&&x.dht_temp_C<=26&&x.dht_humi_pct>=40&&x.dht_humi_pct<=60).length/clean.length*100};
  $('#dataNotice').className='notice';$('#dataNotice').innerHTML=`<strong>업로드 데이터</strong><span>${name} · ${fmt(clean.length)}행을 브라우저에서 분석했습니다.</span>`;render();
}
