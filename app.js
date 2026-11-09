(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const LIVE = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
  const db = LIVE ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
  const KEYS = { session:'yishu_session_v1', demo:'yishu_demo_v1', draft:'yishu_draft_v1', cache:'yishu_cache_v1' };
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(16).slice(2));
  const nowISO = () => new Date().toISOString();
  const fmtTime = iso => iso ? new Intl.DateTimeFormat('zh-HK',{hour:'2-digit',minute:'2-digit',month:'short',day:'numeric'}).format(new Date(iso)) : '';
  const initial = name => [...String(name||'同').trim()][0] || '同';
  const safeParse = (s, fallback=null) => { try{return JSON.parse(s)}catch{return fallback} };
  const store = { get:(k,f=null)=>{const raw=localStorage.getItem(k);return raw===null?f:safeParse(raw,f);}, set:(k,v)=>localStorage.setItem(k,JSON.stringify(v)), remove:k=>localStorage.removeItem(k) };
  const REVIEW_FIELDS = [
    {key:'fusion',title:'融合手法',question:'傳統與現代元素的比例是否平衡？',help:'作品是否看起來太像純粹的「古裝劇戲服」？還是太像「普通現代衫印個圖案」？',placeholder:'例如：傳統雲肩與現代短版剪裁融合自然，因為……',chips:['平衡自然','偏重古典','偏重現代']},
    {key:'proportion',title:'剪裁比例',question:'腰線或視覺重心清不清楚？',help:'整體的剪裁線條有沒有做到「上窄下寬」、「外鬆內緊」或「長短不對稱」等現代美感？',placeholder:'例如：腰線位置清楚，上緊下鬆的比例令……',chips:['比例鮮明','成功運用現代剪裁—上緊下鬆','成功運用現代剪裁—短版露腰','成功運用現代剪裁—前短後長','成功運用現代剪裁—不對稱設計','規整傳統','可嘗試更大膽的剪裁突破']},
    {key:'focus',title:'視覺焦點',question:'全身有沒有 1 至 2 個最吸引眼球的設計焦點？',help:'例如特色領口、腰封、雲肩，或不同布料的軟硬、厚薄對比。',placeholder:'例如：腰封是最搶眼的視覺主角，因為……',chips:['焦點突出','全身有……這個搶眼的視覺主角','能從線條看出軟硬材質對比','能從線條看出厚薄材質對比','元素過滿','有大量花紋或細節','視覺略顯擁擠，缺少留白','略顯單調','線條乾淨簡約']},
    {key:'communication',title:'設計圖的傳意',question:'線條是否清晰交代了衣服的結構？',help:'怎樣穿脫、拼接位在哪裡？可建議加上文字標註或局部放大圖，幫助理解不清楚的部分。',placeholder:'例如：拼接線條清楚；如加上背面局部放大圖，會更易理解……',chips:['清晰專業','線條清楚','附有局部放大圖','附有材質標註','尚待補充','整體構想不錯，但……部分結構尚未交代清楚','整體構想不錯，但……部分布料材質未交代清楚']}
  ];
  const emptyDraft=()=>Object.fromEntries(REVIEW_FIELDS.map(f=>[f.key,'']));
  const peerValue=(rec,key)=>rec?.[key]||((key==='fusion'?rec?.appreciation:key==='proportion'?rec?.improvement:'')||'');
  const state = { view:'home', homeMode:'student', session:store.get(KEYS.session), data:null, teacherData:null,
    loading:false, error:'', file:null, preview:'', draft:emptyDraft(), draftKey:'', lastSignature:'', lastTeacherSignature:'', demoTeacher:false, replacing:false,
    ai:{key:'',status:'idle',error:''}, aiImage:{key:'',status:'idle',error:''}, export:{status:'idle',error:'',progress:''}, studentExport:{status:'idle',error:''} };
  let pollTimer=null, countdownTimer=null, draftTimer=null, objectUrl=null;

  function toast(message, type='success') {
    const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=message;
    $('#toast-region').append(el); setTimeout(()=>el.remove(),4200);
  }
  function setLoading(on){ state.loading=on; const old=$('.loading-line'); if(old)old.remove(); if(on){const e=document.createElement('div');e.className='loading-line';document.body.append(e);} }
  function imageUrl(path){
    if(!path)return '';
    if(path.startsWith('data:')||path.startsWith('http')||path.startsWith('blob:'))return path;
    return `${CFG.SUPABASE_URL.replace(/\/$/,'')}/storage/v1/object/public/artworks/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  function saveSession(){ if(state.session)store.set(KEYS.session,state.session);else store.remove(KEYS.session); }
  function draftStorageKey(){
    const s=state.session, round=state.data?.round?.id||'none';
    return `${s?.classCode||''}:${s?.studentNo||''}:${round}`;
  }
  function loadDraft(){
    state.draftKey=draftStorageKey(); const all=store.get(KEYS.draft,{});
    state.draft={...emptyDraft(),...(all[state.draftKey]||{})};
  }
  function saveDraft(immediate=false){
    clearTimeout(draftTimer);
    const write=()=>{if(!state.draftKey)return;const all=store.get(KEYS.draft,{});all[state.draftKey]={...state.draft,updatedAt:nowISO()};store.set(KEYS.draft,all);const e=$('.draft-status');if(e)e.textContent='草稿已保存在此裝置 · '+new Date().toLocaleTimeString('zh-HK',{hour:'2-digit',minute:'2-digit'});};
    if(immediate)write();else draftTimer=setTimeout(write,450);
  }
  function clearDraft(){const all=store.get(KEYS.draft,{});delete all[state.draftKey];store.set(KEYS.draft,all);state.draft=emptyDraft();}

  // ----- 本機示範資料（明確與雲端正式模式分開） -----
  function sampleArt(n){
    const palettes=[['#b9c9aa','#314c38','#d8875b'],['#d9c0a3','#713f32','#e9dbbb'],['#a9c1c5','#223e4b','#d5a24c'],['#c3b2ca','#46344e','#e0c06b']];
    const p=palettes[n%palettes.length];
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="${p[0]}"/><circle cx="${210+n*70}" cy="${230-n*15}" r="${135+n*8}" fill="${p[2]}" opacity=".88"/><path d="M0 ${490-n*40} Q250 ${180+n*30} 800 ${430-n*20} V600 H0Z" fill="${p[1]}"/><path d="M${90+n*45} 0 L${390+n*25} 600" stroke="${p[2]}" stroke-width="22" opacity=".7"/><rect x="${480-n*25}" y="${80+n*20}" width="170" height="170" fill="none" stroke="${p[1]}" stroke-width="9"/></svg>`;
    return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);
  }
  function freshDemo(){
    const t=Date.now(), classId='demo-class', roundId='demo-round';
    const bots=[
      {id:'bot-1',class_id:classId,student_no:'81',display_name:'示例同學甲',token:'bot-1'},
      {id:'bot-2',class_id:classId,student_no:'82',display_name:'示例同學乙',token:'bot-2'},
      {id:'bot-3',class_id:classId,student_no:'83',display_name:'示例同學丙',token:'bot-3'}
    ];
    const artworks=bots.map((s,i)=>({id:'art-bot-'+i,round_id:roundId,student_id:s.id,title:['窗外的節奏','城市的另一面','色彩練習'][i],image_path:sampleArt(i),created_at:new Date(t-60000*(i+2)).toISOString()}));
    const round={id:roundId,class_id:classId,round_no:1,status:'collecting',submission_starts_at:new Date(t-60000).toISOString(),submission_ends_at:new Date(t+15*60000).toISOString()};
    return {classes:[{id:classId,name:'視覺藝術示範班',join_code:'DEMO15',teacher_pin:'1234',duration_minutes:15,current_round_id:roundId}],students:bots,rounds:[round],artworks,reviews:[]};
  }
  function demoDB(){const d=store.get(KEYS.demo);if(d)return d;const f=freshDemo();store.set(KEYS.demo,f);return f;}
  function saveDemo(d){store.set(KEYS.demo,d);}
  function demoAdvance(d){
    const c=d.classes.find(x=>x.id===(d.currentClassId||d.classes[0].id)); if(!c)return;
    const r=d.rounds.find(x=>x.id===c.current_round_id);if(!r)return;
    if(r.status==='collecting'&&Date.now()>=new Date(r.submission_ends_at).getTime())demoAssign(d,c,r);
  }
  function demoAssign(d,c,r){
    const arts=d.artworks.filter(a=>a.round_id===r.id);
    if(arts.length<2){r.status='complete';return;}
    const shuffled=[...arts].sort(()=>Math.random()-.5);
    shuffled.forEach((a,i)=>{
      if(d.reviews.some(x=>x.artwork_id===a.id))return;
      const reviewer=shuffled[(i+1)%shuffled.length].student_id;
      d.reviews.push({id:uid(),round_id:r.id,artwork_id:a.id,reviewer_id:reviewer,...emptyDraft(),ai_fusion:'',ai_proportion:'',ai_focus:'',ai_communication:'',ai_generated_at:null,submitted_at:null});
    });r.status='reviewing';
  }
  function demoStudentState(session){
    const d=demoDB();d.currentClassId=d.classes.find(c=>c.join_code===session.classCode)?.id;demoAdvance(d);
    const c=d.classes.find(x=>x.join_code===session.classCode);const s=d.students.find(x=>x.token===session.token);
    if(!c||!s)throw new Error('找不到示範學生紀錄，請重新進入。');
    const r=d.rounds.find(x=>x.id===c.current_round_id);
    const mine=d.artworks.find(a=>a.round_id===r?.id&&a.student_id===s.id);
    let assignment=d.reviews.find(x=>x.round_id===r?.id&&x.reviewer_id===s.id);
    if(assignment){const a=d.artworks.find(x=>x.id===assignment.artwork_id);assignment={...assignment,artwork:a};}
    let received=null;if(mine){const rev=d.reviews.find(x=>x.artwork_id===mine.id);if(rev?.submitted_at)received=rev;}
    saveDemo(d);
    return {class:{id:c.id,name:c.name,join_code:c.join_code,duration_minutes:c.duration_minutes},student:{id:s.id,student_no:s.student_no,display_name:s.display_name},round:r||null,my_artwork:mine||null,assignment:assignment||null,received:received||null,server_now:nowISO()};
  }
  function demoTeacherState(code,pin){
    const d=demoDB();const c=d.classes.find(x=>x.join_code===code);if(!c||c.teacher_pin!==pin)throw new Error('班別代碼或老師 PIN 不正確。');d.currentClassId=c.id;demoAdvance(d);
    const r=d.rounds.find(x=>x.id===c.current_round_id);const students=d.students.filter(s=>s.class_id===c.id||s.id.startsWith('bot-')||s.id.startsWith('student-')).filter((s,i,a)=>a.findIndex(x=>x.id===s.id)===i);
    const list=students.map(s=>{const a=d.artworks.find(x=>x.round_id===r?.id&&x.student_id===s.id);const review=d.reviews.find(x=>x.round_id===r?.id&&x.reviewer_id===s.id);return{id:s.id,student_no:s.student_no,display_name:s.display_name,has_artwork:!!a,review_status:review?(review.submitted_at?'submitted':'assigned'):'none'};}).sort((a,b)=>a.student_no.localeCompare(b.student_no,'zh-HK',{numeric:true}));
    saveDemo(d);return{class:{id:c.id,name:c.name,join_code:c.join_code,duration_minutes:c.duration_minutes},round:r||null,students:list,server_now:nowISO()};
  }
  function demoJoin(classCode,studentNo,name){
    const d=demoDB();let c=d.classes.find(x=>x.join_code===classCode);
    if(!c){c={id:'demo-class-'+uid(),name:'本機示範班 '+classCode,join_code:classCode,teacher_pin:'1234',duration_minutes:15,current_round_id:null};d.classes.push(c);const r={id:'demo-round-'+uid(),class_id:c.id,round_no:1,status:'collecting',submission_starts_at:nowISO(),submission_ends_at:new Date(Date.now()+15*60000).toISOString()};d.rounds.push(r);c.current_round_id=r.id;}
    d.currentClassId=c.id;let s=d.students.find(x=>x.student_no===studentNo&&(x.class_id===c.id||c.id==='demo-class'));
    if(!s){s={id:'student-'+uid(),class_id:c.id,student_no:studentNo,display_name:name,token:uid()};d.students.push(s);}else{s.display_name=name||s.display_name;}
    saveDemo(d);return{token:s.token,display_name:s.display_name};
  }

  // ----- 雲端 API -----
  async function rpc(name,args){const{data,error}=await db.rpc(name,args);if(error)throw new Error(error.message);return data;}
  function maybeGenerateAI(data){
    const rec=data?.received;if(!LIVE||!rec?.submitted_at)return;
    const key=rec.id||rec.submitted_at;
    if(rec.ai_generated_at){if(state.ai.key!==key||state.ai.status!=='done')state.ai={key,status:'done',error:''};return;}
    if(state.ai.key===key&&['loading','error'].includes(state.ai.status))return;
    generateAI(key);
  }
  async function generateAI(key){
    const rec=state.data?.received;if(!rec||rec.ai_generated_at)return;
    state.ai={key:key||rec.id||rec.submitted_at,status:'loading',error:''};render();
    try{
      const response=await fetch(`${CFG.SUPABASE_URL.replace(/\/$/,'')}/functions/v1/generate-feedback`,{method:'POST',headers:{'Content-Type':'application/json','apikey':CFG.SUPABASE_ANON_KEY},body:JSON.stringify({token:state.session.token})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'AI 建議暫時未能生成，請稍後重試。');
      if(result.status==='generating'){
        state.ai.status='waiting';render();setTimeout(()=>{if(state.view==='student')refreshStudent(true);},5000);return;
      }
      state.ai.status='done';state.lastSignature='';await refreshStudent();
    }catch(e){state.ai={key:key||rec.id||rec.submitted_at,status:'error',error:e.message};render();}
  }
  async function generateAIImage(key){
    const rec=state.data?.received;
    if(!rec||!rec.ai_generated_at||rec.ai_image_generated_at||state.aiImage.status==='loading')return;
    if(!confirm('生成改善效果圖會把原作、同學四部分意見及 AI 四部分評價傳到 Google Cloud Vertex AI，並產生額外圖像生成用量。每份作品只需生成一次，結果會保存在雲端。確定生成？'))return;
    const imageKey=key||rec.id||rec.submitted_at;
    state.aiImage={key:imageKey,status:'loading',error:''};render();
    try{
      const response=await fetch(`${CFG.SUPABASE_URL.replace(/\/$/,'')}/functions/v1/generate-improvement-image`,{
        method:'POST',headers:{'Content-Type':'application/json','apikey':CFG.SUPABASE_ANON_KEY},body:JSON.stringify({token:state.session.token})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok&&response.status!==202)throw new Error(result.error||'改善效果圖暫時未能生成，請稍後重試。');
      if(result.status==='generating'){
        state.aiImage.status='waiting';render();setTimeout(()=>{if(state.view==='student')refreshStudent(true);},7000);return;
      }
      state.aiImage.status='done';state.lastSignature='';await refreshStudent();toast('改善效果圖已生成並保存。');
    }catch(e){state.aiImage={key:imageKey,status:'error',error:e.message};render();}
  }
  async function refreshStudent(silent=false){
    if(!state.session||state.session.role!=='student')return;
    if(!silent)setLoading(true);
    try{
      const data=LIVE?await rpc('get_student_state',{p_token:state.session.token}):demoStudentState(state.session);
      const signature=JSON.stringify({round:data.round,art:data.my_artwork,assignment:data.assignment,received:data.received});
      state.data=data;store.set(KEYS.cache,{session:state.session,data});
      if(data.received?.ai_image_generated_at){const key=data.received.id||data.received.submitted_at;if(state.aiImage.key!==key||state.aiImage.status!=='done')state.aiImage={key,status:'done',error:''};}
      if(signature!==state.lastSignature){state.lastSignature=signature;loadDraft();render();}
      else updateTimer();
      state.error='';
      if(data.received?.submitted_at&&!data.received?.ai_generated_at&&state.ai.status!=='loading')queueMicrotask(()=>maybeGenerateAI(data));
    }catch(e){if(!silent){state.error=e.message;render();}else toast('暫時未能更新雲端紀錄，會自動重試。','error');}
    finally{if(!silent)setLoading(false);}
  }
  async function refreshTeacher(silent=false){
    const s=state.session;if(!s||s.role!=='teacher')return;
    if(!silent)setLoading(true);
    try{
      const data=LIVE?await rpc('get_teacher_state',{p_join_code:s.classCode,p_pin:s.pin}):demoTeacherState(s.classCode,s.pin||'1234');
      const signature=JSON.stringify({round:data.round,students:data.students});
      state.teacherData=data;
      if(signature!==state.lastTeacherSignature){state.lastTeacherSignature=signature;render();}else updateTimer();
      state.error='';
    }catch(e){if(!silent){state.error=e.message;render();}}
    finally{if(!silent)setLoading(false);}
  }
  async function joinStudent(form){
    const classCode=form.classCode.value.trim().toUpperCase(),studentNo=form.studentNo.value.trim(),name=form.displayName.value.trim();
    if(!classCode||!studentNo||!name){state.error='請填寫班別代碼、學生編號及姓名。';render();return;}
    setLoading(true);state.error='';
    try{
      const result=LIVE?await rpc('join_class',{p_join_code:classCode,p_student_no:studentNo,p_display_name:name}):demoJoin(classCode,studentNo,name);
      state.session={role:'student',classCode,studentNo,name:result.display_name||name,token:result.token};saveSession();
      state.view='student';state.lastSignature='';state.file=null;state.preview='';restartPolling();
      await refreshStudent();toast('已恢復你的學習紀錄。');
    }catch(e){state.error=e.message;render();}finally{setLoading(false);}
  }
  async function loginTeacher(form){
    const classCode=form.classCode.value.trim().toUpperCase(),pin=form.pin.value;
    if(!classCode||!pin){state.error='請輸入班別代碼及老師 PIN。';render();return;}
    setLoading(true);state.error='';
    try{
      if(LIVE)await rpc('get_teacher_state',{p_join_code:classCode,p_pin:pin});else demoTeacherState(classCode,pin);
      state.session={role:'teacher',classCode,pin};saveSession();state.view='teacher';state.demoTeacher=false;state.lastTeacherSignature='';restartPolling();
      await refreshTeacher();toast('已進入老師控制台。');
    }catch(e){state.error=e.message;render();}finally{setLoading(false);}
  }
  async function createClass(form){
    const name=form.className.value.trim(),classCode=form.classCode.value.trim().toUpperCase(),pin=form.pin.value,duration=Number(form.duration.value||15);
    if(!name||!/^[A-Z0-9-]{4,12}$/.test(classCode)||pin.length<4){state.error='請填寫班別名稱、4–12 位英文／數字代碼，以及至少 4 位老師 PIN。';render();return;}
    setLoading(true);state.error='';
    try{
      if(LIVE)await rpc('create_class',{p_class_name:name,p_join_code:classCode,p_pin:pin,p_duration:duration});
      else{const d=demoDB();if(d.classes.some(c=>c.join_code===classCode))throw new Error('這個班別代碼已被使用。');d.classes.push({id:'demo-class-'+uid(),name,join_code:classCode,teacher_pin:pin,duration_minutes:duration,current_round_id:null});saveDemo(d);}
      state.session={role:'teacher',classCode,pin};saveSession();state.view='teacher';state.lastTeacherSignature='';restartPolling();await refreshTeacher();toast('班別已建立，現在可開始第一輪活動。');
    }catch(e){state.error=e.message;render();}finally{setLoading(false);}
  }
  async function startRound(){
    const s=state.session,duration=Number($('#round-duration')?.value||state.teacherData?.class?.duration_minutes||15);setLoading(true);
    try{
      if(LIVE)await rpc('start_round',{p_join_code:s.classCode,p_pin:s.pin,p_duration:duration});
      else{const d=demoDB(),c=d.classes.find(x=>x.join_code===s.classCode);if(!c)throw new Error('找不到班別。');const old=d.rounds.find(r=>r.id===c.current_round_id);if(old&&['collecting','reviewing'].includes(old.status))throw new Error('本輪活動尚未完結。');const r={id:'demo-round-'+uid(),class_id:c.id,round_no:d.rounds.filter(x=>x.class_id===c.id).length+1,status:'collecting',submission_starts_at:nowISO(),submission_ends_at:new Date(Date.now()+duration*60000).toISOString()};d.rounds.push(r);c.current_round_id=r.id;c.duration_minutes=duration;d.currentClassId=c.id;saveDemo(d);}
      state.lastTeacherSignature='';await refreshTeacher();toast(`已開始 ${duration} 分鐘上載時間。`);
    }catch(e){toast(e.message,'error');}finally{setLoading(false);}
  }
  async function closeRound(){
    if(!confirm('確定提前截止並隨機分配作品？未上載的學生將不會獲分配互評。'))return;
    const s=state.session;setLoading(true);
    try{
      if(LIVE)await rpc('close_submissions',{p_join_code:s.classCode,p_pin:s.pin});
      else{const d=demoDB(),c=d.classes.find(x=>x.join_code===s.classCode),r=d.rounds.find(x=>x.id===c.current_round_id);demoAssign(d,c,r);saveDemo(d);}
      state.lastTeacherSignature='';state.lastSignature='';await(state.session.role==='teacher'?refreshTeacher():refreshStudent());toast('已截止並完成隨機分配。');
    }catch(e){toast(e.message,'error');}finally{setLoading(false);}
  }
  async function completeRound(){
    if(!confirm('確定結束本輪互評？未遞交的意見將不能再修改。'))return;
    const s=state.session;setLoading(true);
    try{if(LIVE)await rpc('complete_round',{p_join_code:s.classCode,p_pin:s.pin});else{const d=demoDB(),c=d.classes.find(x=>x.join_code===s.classCode),r=d.rounds.find(x=>x.id===c.current_round_id);r.status='complete';saveDemo(d);}state.lastTeacherSignature='';await refreshTeacher();toast('本輪活動已結束。');}catch(e){toast(e.message,'error');}finally{setLoading(false);}
  }
  async function selectImage(file){
    if(!file)return;if(!file.type.startsWith('image/')){toast('請選擇 JPG、PNG、HEIC 或其他圖片格式。','error');return;}
    if(file.size>(CFG.MAX_IMAGE_MB||10)*1024*1024){toast(`圖片不可超過 ${CFG.MAX_IMAGE_MB||10}MB。`,'error');return;}
    state.file=file;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(file);state.preview=objectUrl;render();
  }
  async function compressImage(file){
    if(file.size<500*1024&&['image/jpeg','image/png','image/webp'].includes(file.type))return file;
    const bitmap=await createImageBitmap(file);const max=1800,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));if(!blob)throw new Error('圖片處理失敗，請改用 JPG 或 PNG。');return new File([blob],'artwork.jpg',{type:'image/jpeg'});
  }
  async function uploadArtwork(){
    if(!state.file){toast('請先選擇作品圖片。','error');return;}
    const title=$('#artwork-title')?.value.trim()||'我的作品';setLoading(true);
    try{
      if(LIVE){
        const file=await compressImage(state.file),s=state.data.student,c=state.data.class,r=state.data.round;
        const path=`${c.join_code}/${s.id}/${r.id}/${uid()}.jpg`;
        const{error}=await db.storage.from('artworks').upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});if(error)throw new Error(error.message);
        await rpc('submit_artwork',{p_token:state.session.token,p_title:title,p_image_path:path});
      }else{
        let imagePath=state.preview;
        try{imagePath=await compressImage(state.file).then(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);}));}catch{}
        const d=demoDB(),c=d.classes.find(x=>x.join_code===state.session.classCode),s=d.students.find(x=>x.token===state.session.token),r=d.rounds.find(x=>x.id===c.current_round_id);
        d.artworks=d.artworks.filter(a=>!(a.round_id===r.id&&a.student_id===s.id));d.artworks.push({id:uid(),round_id:r.id,student_id:s.id,title,image_path:imagePath,created_at:nowISO()});saveDemo(d);
      }
      state.file=null;state.preview='';state.replacing=false;state.lastSignature='';await refreshStudent();toast('作品已遞交，進度已保存。');
    }catch(e){toast(e.message,'error');}finally{setLoading(false);}
  }
  async function submitReview(){
    const values=Object.fromEntries(REVIEW_FIELDS.map(f=>[f.key,state.draft[f.key].trim()]));
    const missing=REVIEW_FIELDS.find(f=>values[f.key].length<2);
    if(missing){toast(`請完成「${missing.title}」的意見，可選字詞或自行填寫。`,'error');document.getElementById(missing.key)?.focus();return;}
    if(!confirm('遞交後不能修改四部分意見。確定送給這位同學？'))return;
    setLoading(true);
    try{
      if(LIVE)await rpc('submit_review_v2',{p_token:state.session.token,p_fusion:values.fusion,p_proportion:values.proportion,p_focus:values.focus,p_communication:values.communication});
      else{
        const d=demoDB(),s=d.students.find(x=>x.token===state.session.token),c=d.classes.find(x=>x.join_code===state.session.classCode),r=d.rounds.find(x=>x.id===c.current_round_id);
        const rev=d.reviews.find(x=>x.round_id===r.id&&x.reviewer_id===s.id);if(!rev)throw new Error('找不到互評作品。');Object.assign(rev,values,{submitted_at:nowISO()});
        const mine=d.artworks.find(x=>x.round_id===r.id&&x.student_id===s.id);
        if(mine){
          let incoming=d.reviews.find(x=>x.artwork_id===mine.id);
          if(!incoming){const bot=d.students.find(x=>x.id.startsWith('bot-'));incoming={id:uid(),round_id:r.id,artwork_id:mine.id,reviewer_id:bot.id};d.reviews.push(incoming);}
          Object.assign(incoming,{
            fusion:'傳統雲肩與現代短版剪裁平衡自然，古典元素沒有蓋過整體的現代感。',
            proportion:'上緊下鬆的比例鮮明，腰線位置清楚；下擺亦可嘗試更長短不對稱的變化。',
            focus:'腰封是搶眼的視覺主角，能從線條看出軟硬材質對比；袖口細節略多，可保留多一點留白。',
            communication:'整體線條清楚並附有材質標註，但背面的拼接結構尚未交代清楚。',
            ai_fusion:'下一稿可保留雲肩作為傳統識別，再把衣身簡化成乾淨的現代直線，讓兩種語言主次更清楚。',
            ai_proportion:'可先把腰線略為提高，並比較兩個下擺長度版本；用相同站姿畫出比例草圖，會更容易判斷視覺重心。',
            ai_focus:'建議只保留腰封與領口兩個焦點，把袖口一組裝飾減半。再以軟薄內搭配挺硬腰封，強化材質層次。',
            ai_communication:'可在背面增加局部放大圖，以虛線及箭嘴標示開合位置和拼接次序，並補上各裁片的布料名稱。',
            ai_generated_at:nowISO(),ai_model:'本機示範建議',submitted_at:nowISO()
          });
        }
        saveDemo(d);
      }
      clearDraft();state.lastSignature='';await refreshStudent();toast('四部分意見已遞交，原作者現在可以閱讀。');
    }catch(e){toast(e.message,'error');}finally{setLoading(false);}
  }

  // ----- 畫面 -----
  function connectionHTML(){return `<span class="${LIVE?'cloud-notice':'demo-notice'}">${LIVE?'雲端模式：作品、階段及已遞交意見會與全班同步保存。':'本機示範：資料只保存在這個瀏覽器，不會與其他學生共用。正式使用請按 README 連接 Supabase。'}</span>`;}
  function errorHTML(){return state.error?`<p class="inline-error" role="alert">${esc(state.error)}</p>`:'';}
  function homeArt(){return `<div class="entry-art" aria-hidden="true"><div class="art-frame"><svg viewBox="0 0 800 480"><rect width="800" height="480" fill="#c9d4bd"/><circle cx="260" cy="205" r="145" fill="#d9855e" opacity=".9"/><path d="M0 450 Q280 100 800 380 V480 H0Z" fill="#2e4935"/><path d="M120 0L430 480" stroke="#f0d09a" stroke-width="24" opacity=".8"/><rect x="510" y="60" width="170" height="170" fill="none" stroke="#2e4935" stroke-width="8"/></svg></div><div class="art-caption"><span>觀看，然後回應。</span><small>每一句意見，都是創作的養分。</small></div></div>`;}
  function renderHome(){
    const teacher=state.homeMode==='teacher';
    $('#main').innerHTML=`<div class="entry-shell">
      <section class="entry-copy"><p class="eyebrow">一看 · 二想 · 三回應</p><h1>讓每件作品，<br>得到<em>下一個可能。</em></h1><p class="entry-intro">在限時內分享創作，隨機遇見一位同學的視角。學會具體地欣賞，也學會善意地提出改善。</p>${homeArt()}</section>
      <section class="entry-panel" aria-label="進入系統"><div class="mode-tabs" role="tablist"><button class="mode-tab ${!teacher?'active':''}" data-action="home-student" role="tab" aria-selected="${!teacher}">學生進入</button><button class="mode-tab ${teacher?'active':''}" data-action="home-teacher" role="tab" aria-selected="${teacher}">老師入口</button></div>
      ${teacher?teacherEntryForm():studentEntryForm()}</section>
    </div>
    <section class="process-strip" aria-label="活動流程"><div class="process-item"><span>01</span><div><strong>上載自己的作品</strong><p>老師啟動倒數，截止前遞交一張圖片。</p></div></div><div class="process-item"><span>02</span><div><strong>為同學留下回應</strong><p>隨機匿名分配，以四個角度回應服裝設計。</p></div></div><div class="process-item"><span>03</span><div><strong>帶着意見再出發</strong><p>原作者收回具體回饋，階段自動保存。</p></div></div></section>`;
  }
  function studentEntryForm(){return `<h2>回到你的作品對話</h2><p class="panel-intro">使用相同資料進入，即可接回上次的進度。</p>${errorHTML()}<form id="student-login-form"><div class="field"><label for="classCode">班別代碼</label><input class="input-code" id="classCode" name="classCode" autocomplete="username" placeholder="例如 ART3A" maxlength="12" required></div><div class="form-row"><div class="field"><label for="studentNo">學生編號</label><input id="studentNo" name="studentNo" inputmode="numeric" placeholder="例如 08" maxlength="20" required></div><div class="field"><label for="displayName">姓名</label><input id="displayName" name="displayName" autocomplete="name" placeholder="你的姓名" maxlength="40" required></div></div><button class="primary-button full" type="submit">進入／恢復紀錄 <span aria-hidden="true">→</span></button><p class="form-note">系統會保存已上載的作品、互評狀態和收到的意見；未遞交草稿會保存在此裝置。</p></form>${!LIVE?`<div class="demo-strip">想快速體驗？<button data-action="fill-demo-student">填入學生示範資料</button><div class="demo-credentials">班別代碼 <strong>DEMO15</strong> · 學生編號可自訂<br>內置三份示例作品，方便測試隨機互評。</div></div>`:''}`;}
  function teacherEntryForm(){return `<h2>建立及主持互評</h2><p class="panel-intro">開始倒數、查看遞交狀態，或提前截止分配。</p>${errorHTML()}<div class="mode-tabs" style="margin-bottom:22px"><button class="mode-tab ${!state.demoTeacher?'active':''}" data-action="teacher-login-tab">管理現有班別</button><button class="mode-tab ${state.demoTeacher?'active':''}" data-action="teacher-create-tab">建立新班別</button></div>${state.demoTeacher?`<form id="create-class-form"><div class="field"><label for="className">班別名稱</label><input id="className" name="className" placeholder="例如 三甲視覺藝術" maxlength="60" required></div><div class="form-row"><div class="field"><label for="classCode">班別代碼</label><input class="input-code" id="classCode" name="classCode" value="ART${Math.floor(100+Math.random()*900)}" maxlength="12" required></div><div class="field"><label for="pin">老師 PIN <small>至少 4 位</small></label><input id="pin" name="pin" type="password" autocomplete="new-password" inputmode="numeric" minlength="4" placeholder="自行設定" required></div></div><div class="field"><label for="duration">預設上載時限（分鐘）</label><input id="duration" name="duration" type="number" min="1" max="120" value="15" required></div><button class="primary-button full" type="submit">建立班別 <span aria-hidden="true">→</span></button></form>`:`<form id="teacher-login-form"><div class="field"><label for="classCode">班別代碼</label><input class="input-code" id="classCode" name="classCode" placeholder="班別代碼" maxlength="12" required></div><div class="field"><label for="pin">老師 PIN</label><input id="pin" name="pin" type="password" autocomplete="current-password" placeholder="建立班別時設定" required></div><button class="primary-button full" type="submit">進入老師控制台 <span aria-hidden="true">→</span></button></form>`}${!LIVE?`<div class="demo-strip">老師示範班別：<button data-action="fill-demo-teacher">填入老師示範資料</button><div class="demo-credentials">代碼 <strong>DEMO15</strong> · PIN <strong>1234</strong></div></div>`:''}`;}
  function progressHTML(data){
    const uploaded=!!data.my_artwork,reviewed=!!data.assignment?.submitted_at,received=!!data.received?.submitted_at;
    const reviewing=['reviewing','complete'].includes(data.round?.status);let active=!uploaded?1:(!reviewed&&data.assignment?2:(!received?3:3));
    if(!reviewing)active=!uploaded?1:2;
    const step=(n,title,sub,done)=>`<div class="progress-step ${done?'done':active===n?'active':''}"><span class="step-dot">${done?'✓':n}</span><div><strong>${title}</strong><small>${sub}</small></div></div>`;
    return `<div class="progress-rail">${step(1,'上載作品','UPLOAD',uploaded)}${step(2,'隨機互評','RESPOND',reviewed)}${step(3,'收回意見','REFLECT',received)}</div>`;
  }
  function timerHTML(round){
    if(!round||round.status!=='collecting')return '';
    return `<div class="timer-block"><span>距離截止</span><strong class="timer" data-deadline="${esc(round.submission_ends_at)}">--:--</strong></div>`;
  }
  function waitingContent(data){
    if(!data.round)return `<div class="waiting-state"><div class="large-symbol">○</div><h2>老師還未開始本輪活動</h2><p>你的身份已保存。老師開始 ${data.class.duration_minutes} 分鐘倒數後，這裡會自動開放上載。</p></div>`;
    if(data.round.status==='collecting'&&new Date(data.round.submission_ends_at)<=new Date())return `<div class="waiting-state"><div class="large-symbol">…</div><h2>上載時間已完結</h2><p>系統正在整理作品並準備隨機分配，請稍候。</p></div>`;
    if(data.round.status==='reviewing'&&!data.assignment)return `<div class="waiting-state"><div class="large-symbol">○</div><h2>本輪沒有分配互評</h2><p>只有已上載作品的學生會參與隨機互評。你仍可等待或閱讀之後收到的內容。</p></div>`;
    return `<div class="waiting-state"><div class="large-symbol">✓</div><h2>本輪活動已完結</h2><p>謝謝你的認真觀看與回應。已遞交的內容仍可在下方查看。</p></div>`;
  }
  function uploadContent(data){
    if(state.preview)return `<div class="upload-preview"><div class="preview-canvas"><img src="${esc(state.preview)}" alt="待上載作品預覽"></div><div class="preview-meta"><span class="kicker">READY TO SUBMIT</span><strong>${esc(state.file?.name||'作品圖片')}</strong><p>${state.file?(state.file.size/1024/1024).toFixed(2):''} MB</p><p>遞交前請確認圖片方向及內容正確。</p><button class="outline-button small-button" data-action="clear-image">重新選擇</button></div></div><div class="field"><label for="artwork-title">作品名稱 <small>選填</small></label><input id="artwork-title" maxlength="100" placeholder="為作品命名"></div><div class="submit-row"><button class="primary-button" data-action="upload-artwork">確認遞交作品 <span>→</span></button><span class="save-hint">遞交後，截止前仍可重新上載。</span></div>`;
    return `<div class="upload-zone" id="upload-zone"><input id="artwork-file" type="file" accept="image/*" aria-label="選擇作品圖片"><div><svg class="upload-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 12h44v40H10z"/><circle cx="23" cy="24" r="5"/><path d="M12 46l14-14 10 10 7-7 10 11M32 4v17m-6-6l6 6 6-6"/></svg><strong>選擇或拍攝你的作品</strong><p>在 iPad 可從相片圖庫、相機或檔案選取</p><small>JPG、PNG、HEIC 等圖片 · 不超過 ${CFG.MAX_IMAGE_MB||10}MB</small></div></div><p class="form-note">請確保作品清晰、方向正確，並避免在圖片寫上不必要的個人資料。</p>${state.replacing?'<button class="text-button" data-action="cancel-replace">取消，保留原作品</button>':''}`;
  }
  function uploadSubmittedContent(data){return `<div class="waiting-state"><div class="submitted-check">✓</div><h2>作品已安全上載</h2><p>遞交時間：${fmtTime(data.my_artwork.created_at)}。你可以留在這裡等待截止，系統會自動進入隨機互評。</p><div class="control-buttons" style="justify-content:center">${data.round?.status==='collecting'?`<button class="outline-button" data-action="replace-artwork">截止前重新上載</button>`:''}${!LIVE&&data.round?.status==='collecting'?`<button class="secondary-button" data-action="demo-close-student">示範：立即截止並分配</button>`:''}</div></div>`;}
  function reviewContent(data){
    const a=data.assignment;if(!a)return waitingContent(data);
    if(a.submitted_at)return `<div class="waiting-state"><div class="submitted-check">✓</div><h2>你的意見已送達</h2><p>遞交時間：${fmtTime(a.submitted_at)}。原作者現在可以閱讀你的四部分回應；你亦可在右方查看自己收到的意見及 AI 建議。</p></div>`;
    const art=a.artwork;
    const prompts=REVIEW_FIELDS.map((f,i)=>{
      const value=state.draft[f.key]||'';
      const chips=f.chips.map(chip=>`<button type="button" class="suggestion-chip ${value.includes(chip)?'selected':''}" data-action="toggle-phrase" data-field="${f.key}" data-phrase="${esc(chip)}" aria-pressed="${value.includes(chip)}">${esc(chip)}</button>`).join('');
      return `<fieldset class="review-prompt"><legend><span class="prompt-number">${i+1}</span>${esc(f.title)}<span class="required-mark" aria-hidden="true">*</span></legend><p class="prompt-question">${esc(f.question)}</p><p class="field-help">${esc(f.help)}</p><div class="suggestion-group" aria-label="${esc(f.title)}建議字詞"><span class="suggestion-label">建議字詞 <small>按一下加入，再按可移除</small></span><div class="suggestion-chips">${chips}</div></div><label class="sr-only" for="${f.key}">${esc(f.title)}補充意見</label><textarea id="${f.key}" name="${f.key}" maxlength="2000" placeholder="${esc(f.placeholder)}" required>${esc(value)}</textarea><div class="char-count"><span data-count="${f.key}">${value.length}</span>／2000</div></fieldset>`;
    }).join('');
    return `<div class="review-artwork"><img src="${esc(imageUrl(art.image_path))}" alt="獲隨機分配的同學作品：${esc(art.title)}"><span class="artwork-label">匿名同學作品</span></div><p class="kicker">YOUR RESPONSE</p><h2 style="font-family:var(--serif);font-weight:600">${esc(art.title||'同學的作品')}</h2><p class="panel-intro">先看整體，再看細節。你可以選擇建議字詞，再補充自己的觀察；也可以全部自行填寫。</p><form id="review-form">${prompts}<div class="draft-status">${Object.values(state.draft).some(Boolean)?'已載入此裝置上的四部分草稿':''}</div><div class="submit-row"><button class="primary-button" type="submit">遞交四部分意見 <span>→</span></button><span class="save-hint">遞交後不能修改，請先檢查內容。</span></div></form>`;
  }

  function aiHTML(rec){
    if(rec.ai_generated_at)return `<div class="ai-feedback"><div class="ai-heading"><span>AI 原作評價</span><small>${esc(rec.ai_model||(LIVE?'Gemini':'示範'))} · 只供參考</small></div><p class="ai-intro">AI 直接觀察你的原作圖片，按圖中可見細節評價及提出建議，並非整理同學評語。</p>${REVIEW_FIELDS.map((f,i)=>`<div class="ai-advice"><span class="feedback-label">${String(i+1).padStart(2,'0')} · ${esc(f.title)}</span><p>${esc(rec['ai_'+f.key])}</p></div>`).join('')}<span class="side-meta">生成時間：${fmtTime(rec.ai_generated_at)}</span></div>`;
    const status=state.ai.status;
    return `<div class="ai-feedback ai-pending"><div class="ai-heading"><span>AI 原作評價</span><small>Gemini</small></div>${status==='error'?`<p role="alert">${esc(state.ai.error||'暫時未能生成建議。')}</p><button class="outline-button small-button" data-action="retry-ai">重新生成原作評價</button>`:`<p>正在直接觀察你的原作，從融合手法、剪裁比例、視覺焦點及設計圖傳意四部分提出評價……</p><span class="side-meta">完成後會自動顯示並保存，你可以留在本頁。</span>`}</div>`;
  }
  function improvementImageHTML(rec){
    if(!LIVE||!rec?.ai_generated_at)return '';
    if(rec.ai_image_generated_at&&rec.ai_image_path){
      const canDownload=!!state.data?.assignment?.submitted_at,working=state.studentExport.status==='working';
      return `<section class="improvement-result" aria-labelledby="improvement-title"><div class="ai-heading"><span id="improvement-title">AI 改善效果圖</span><small>${esc(rec.ai_image_model||'Gemini')}</small></div><p class="ai-intro">以原作為基礎，綜合同學及 AI 四部分文字意見生成；請與上方原作對照，判斷哪些修改適合你的下一稿。</p><figure><img src="${esc(imageUrl(rec.ai_image_path))}" alt="根據原作及互評意見生成的 AI 改善服裝設計效果圖" loading="lazy"><figcaption>${esc(rec.ai_image_summary||'已保存 AI 改善效果圖。')}</figcaption></figure><span class="side-meta">生成時間：${fmtTime(rec.ai_image_generated_at)}</span><p class="generation-limit">本輪改善圖已完成，不能再次生成。如需另一張，請在下一輪重新上載作品並收到新的同學評價。</p><div class="student-download-actions"><a class="outline-button small-button download-image" href="${esc(imageUrl(rec.ai_image_path))}" download target="_blank" rel="noopener">只下載改善圖</a>${canDownload?`<button class="primary-button small-button" data-action="download-student-pack" ${working?'disabled':''}>${working?'正在製作 ZIP……':'下載我的評語及改善圖'}</button>`:'<small>完成你負責的同學互評後，即可下載完整個人紀錄。</small>'}</div>${state.studentExport.status==='error'?`<p class="inline-error" role="alert">${esc(state.studentExport.error)}</p>`:''}<p class="student-pack-note">個人 ZIP 包含原作、改善圖、同學及 AI 四部分文字、HTML 報告和 CSV；同學來源保持匿名。重複下載不會重新生成。</p></section>`;
    }
    const key=rec.id||rec.submitted_at,current=state.aiImage.key===key?state.aiImage.status:(rec.ai_image_started_at?'waiting':'idle');
    const error=state.aiImage.key===key?state.aiImage.error:'';
    if(current==='loading'||current==='waiting')return `<section class="improvement-result ai-pending"><div class="ai-heading"><span>AI 改善效果圖</span><small>Gemini</small></div><p>正在綜合原作、同學及 AI 的文字意見，生成保留原設計特色的改善圖……</p><span class="side-meta">圖像生成需要較長時間。完成後會保存，重新整理不會自動重複生成。</span><button class="text-button" data-action="refresh-student">重新查看進度</button></section>`;
    return `<section class="improvement-result improvement-cta"><div class="ai-heading"><span>下一步：改善效果圖</span><small>由你決定何時生成</small></div><p>看完同學及 AI 意見後，讓 AI 以原作為基礎綜合建議，生成一張改善後的全身服裝設計效果圖。</p>${current==='error'?`<p class="inline-error" role="alert">${esc(error||'改善效果圖暫時未能生成。')}</p>`:''}<button class="primary-button full" data-action="generate-ai-image">${current==='error'?'重試生成改善效果圖':'生成改善效果圖'} <span>→</span></button><small>圖像生成會產生額外 Vertex AI 用量；按鈕後會再要求確認。姓名及學生編號不會傳給模型。</small></section>`;
  }
  function sideHTML(data){
    const art=data.my_artwork,rec=data.received;
    const peer=rec?.submitted_at?`<div class="feedback-received"><div class="peer-heading">同學的四部分觀察</div>${REVIEW_FIELDS.map((f,i)=>`<span class="feedback-label">${String(i+1).padStart(2,'0')} · ${esc(f.title)}</span><p class="feedback-quote">${esc(peerValue(rec,f.key))}</p>`).join('')}<span class="side-meta">同學已於 ${fmtTime(rec.submitted_at)} 遞交</span></div>${aiHTML(rec)}${improvementImageHTML(rec)}`:`<p class="empty-side">${art?'負責互評的同學遞交後，四部分意見及 AI 原作評價會自動出現在這裡。':'上載作品後，才有機會收到同學意見。'}</p>`;
    return `<aside class="workspace-side"><section class="side-section"><h3>我的作品</h3>${art?`<img class="side-art" src="${esc(imageUrl(art.image_path))}" alt="我的作品：${esc(art.title)}"><h4 class="side-title">${esc(art.title)}</h4><span class="side-meta">已於 ${fmtTime(art.created_at)} 遞交</span>`:`<p class="empty-side">尚未上載作品。</p>`}</section><section class="side-section"><h3>我收到的意見</h3>${peer}</section></aside>`;
  }

  function renderStudent(){
    const d=state.data,s=state.session;if(!d)return;
    const r=d.round;let title='等待活動開始',subtitle='系統會自動更新階段',content='';
    if(r?.status==='collecting'){if(d.my_artwork&&!state.replacing){title='等待隨機分配';subtitle='你的作品已保存';content=uploadSubmittedContent(d);}else{title='上載你的作品';subtitle='第一步 · 在時限內遞交一張圖片';content=uploadContent(d);}}
    else if(r?.status==='reviewing'||(r?.status==='complete'&&d.assignment?.submitted_at)){title=d.assignment?.submitted_at?'互評已經完成':'為同學留下回應';subtitle=d.assignment?.submitted_at?'你的觀察已成為同學的養分':'第二步 · 具體、善意、可行';content=reviewContent(d);}
    else{content=waitingContent(d);title=r?'本輪作品對話':'等待老師開始';subtitle=r?'已保存的內容可隨時回來查看':'請留意老師指示';}
    $('#main').innerHTML=`<div class="app-shell"><div class="app-topline"><div><p class="eyebrow">${esc(d.class.join_code)} · ${esc(d.class.name)}</p><h1>${esc(s.name)}的作品對話</h1><p>學生編號 ${esc(s.studentNo)} · 進度自動保存</p></div><div class="user-actions"><span class="avatar">${esc(initial(s.name))}</span><button class="outline-button compact" data-action="logout">離開 <span aria-hidden="true">↗</span></button></div></div>${connectionHTML()}${errorHTML()}${progressHTML(d)}<div class="workspace"><section class="workspace-main"><div class="section-heading"><div><span class="kicker">${esc(subtitle)}</span><h2>${esc(title)}</h2></div>${timerHTML(r)}</div>${content}</section>${sideHTML(d)}</div></div>`;
    updateTimer();
  }

  function openTeacherExport(){
    if(!LIVE){toast('本機示範不提供雲端紀錄匯出。','error');return;}
    state.export={status:'idle',error:'',progress:''};
    const dialog=$('#export-dialog'),current=$('#export-current'),all=$('#export-all');
    current.disabled=!state.teacherData?.round?.id;current.checked=!!state.teacherData?.round?.id;all.checked=!current.checked;
    $('#export-form').querySelectorAll('input,button').forEach(el=>el.disabled=el===current?current.disabled:false);
    $('#export-status').textContent='ZIP 會包含原作、已生成的改善圖、HTML 評語報告及 CSV 紀錄。';
    $('#export-error').textContent='';dialog.showModal();
  }
  function safeFileName(value,max=70){
    let name=String(value||'未命名').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/[. ]+$/g,'').trim();
    if(!name)name='未命名';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))name='_'+name;
    return [...name].slice(0,max).join('');
  }
  function csvCell(value){
    let text=String(value??'');if(/^[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  function fullTime(value){return value?new Intl.DateTimeFormat('zh-HK',{dateStyle:'medium',timeStyle:'medium'}).format(new Date(value)):'';}
  function exportPath(path){return String(path||'').split('/').map(encodeURIComponent).join('/');}
  async function exportImage(path,label){
    const response=await fetch(imageUrl(path));if(!response.ok)throw new Error(`${label}下載失敗（HTTP ${response.status}），ZIP 尚未產生。`);
    const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length)throw new Error(`${label}是空白檔案，ZIP 尚未產生。`);
    const declaredMime=(response.headers.get('content-type')||'').split(';')[0];
    const actualMime=bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?'image/jpeg':bytes.length>8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47?'image/png':bytes.length>12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP'?'image/webp':'';
    const mime=actualMime||declaredMime;
    const extension=mime==='image/png'?'png':mime==='image/webp'?'webp':mime==='image/jpeg'?'jpg':String(path).toLowerCase().split('.').pop().replace(/[^a-z0-9]/g,'')||'jpg';
    return {bytes,extension};
  }
  function buildExportDocuments(data,records){
    const headings=['輪次','原作者學生編號','原作者姓名','作品名稱','原作檔案','互評學生編號','互評學生姓名','互評遞交時間',
      '同學：融合手法','同學：剪裁比例','同學：視覺焦點','同學：設計圖的傳意','AI：融合手法','AI：剪裁比例','AI：視覺焦點','AI：設計圖的傳意',
      'AI 文字模型','AI 文字生成時間','改善圖檔案','改善圖說明','改善圖模型','改善圖生成時間'];
    const rows=records.map(r=>[r.round_no,r.student_no,r.display_name,r.artwork_title,r.original_file,r.reviewer_no||'',r.reviewer_name||'',fullTime(r.review_submitted_at),
      r.fusion,r.proportion,r.focus,r.communication,r.ai_fusion,r.ai_proportion,r.ai_focus,r.ai_communication,r.ai_model||'',fullTime(r.ai_generated_at),r.ai_image_file||'',r.ai_image_summary,r.ai_image_model||'',fullTime(r.ai_image_generated_at)]);
    const csv='\ufeff'+[headings,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
    const articles=records.map(r=>`<article><h2>第 ${esc(r.round_no)} 輪｜${esc(r.student_no)} ${esc(r.display_name)}</h2><p class="meta">作品：${esc(r.artwork_title||'我的作品')}　原作遞交：${esc(fullTime(r.artwork_created_at)||'—')}</p><div class="images"><figure><img src="${esc(exportPath(r.original_file))}" alt="原作"><figcaption>原作</figcaption></figure>${r.ai_image_file?`<figure><img src="${esc(exportPath(r.ai_image_file))}" alt="AI 改善效果圖"><figcaption>AI 改善效果圖</figcaption></figure>`:'<p class="empty">AI 改善效果圖：尚未生成</p>'}</div><h3>同學評語及來源</h3><p class="meta">來源：${r.reviewer_no?`${esc(r.reviewer_no)} ${esc(r.reviewer_name)}`:'尚未分配或遞交'}　遞交時間：${esc(fullTime(r.review_submitted_at)||'—')}</p>${REVIEW_FIELDS.map(f=>`<h4>${esc(f.title)}</h4><p>${esc(r[f.key]||'尚未遞交')}</p>`).join('')}<h3>AI 原作評價</h3><p class="meta">模型：${esc(r.ai_model||'—')}　生成時間：${esc(fullTime(r.ai_generated_at)||'尚未生成')}</p>${REVIEW_FIELDS.map(f=>`<h4>${esc(f.title)}</h4><p>${esc(r['ai_'+f.key]||'尚未生成')}</p>`).join('')}<h3>AI 改善效果圖紀錄</h3><p class="meta">模型：${esc(r.ai_image_model||'—')}　生成時間：${esc(fullTime(r.ai_image_generated_at)||'尚未生成')}</p><p>${esc(r.ai_image_summary||'尚未生成')}</p></article>`).join('');
    const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(data.class.name)}｜評語報告</title><style>body{max-width:1100px;margin:auto;padding:32px;font-family:-apple-system,BlinkMacSystemFont,"PingFang HK","Microsoft JhengHei",sans-serif;line-height:1.7;color:#172119;background:#f7f3eb}article{background:#fffdf8;padding:28px;margin:28px 0;border-top:4px solid #307927}h1,h2{font-family:serif}h3{margin-top:28px;color:#20591b}h4{margin:16px 0 2px;font-size:14px}p{white-space:pre-wrap}.meta{font-size:13px;color:#6d726a}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}figure{margin:0}img{width:100%;max-height:680px;object-fit:contain;background:#e9e5dc}figcaption{padding:8px 0;color:#6d726a}.empty{padding:30px;color:#6d726a}@media(max-width:600px){body{padding:16px}article{padding:18px}}</style></head><body><h1>${esc(data.class.name)}｜作品及評語報告</h1><p class="meta">班別代碼：${esc(data.class.join_code)}　範圍：${data.scope==='all'?'全部輪次':'目前一輪'}　匯出時間：${esc(fullTime(data.exported_at))}</p><p>同學評語保留互評學生編號及姓名作來源；AI 欄位記錄實際模型及生成時間。圖片以相對路徑連接，請將本報告與輪次資料夾一起保留。</p>${articles}</body></html>`;
    return {csv,html};
  }
  async function downloadStudentPack(){
    const d=state.data,rec=d?.received,art=d?.my_artwork;
    if(!d||!rec?.ai_generated_at||!rec?.ai_image_generated_at||!rec.ai_image_path||!art||!d.assignment?.submitted_at){toast('請先完成本輪所有互評及改善圖階段。','error');return;}
    if(state.studentExport.status==='working')return;
    state.studentExport={status:'working',error:''};render();
    try{
      if(!window.fflate?.zipSync)throw new Error('ZIP 元件未能載入，請重新整理後再試。');
      const original=await exportImage(art.image_path,'你的原作');
      const improved=await exportImage(rec.ai_image_path,'你的 AI 改善圖');
      const originalName=`原作.${original.extension}`,improvedName=`AI改善效果圖.${improved.extension}`;
      const headings=['輪次','學生編號','姓名','作品名稱','評語來源','互評遞交時間','同學：融合手法','同學：剪裁比例','同學：視覺焦點','同學：設計圖的傳意','AI：融合手法','AI：剪裁比例','AI：視覺焦點','AI：設計圖的傳意','AI 文字模型','AI 文字生成時間','改善圖說明','改善圖模型','改善圖生成時間'];
      const row=[d.round.round_no,d.student.student_no,d.student.display_name,art.title,'隨機互評同學（匿名）',fullTime(rec.submitted_at),peerValue(rec,'fusion'),peerValue(rec,'proportion'),peerValue(rec,'focus'),peerValue(rec,'communication'),rec.ai_fusion,rec.ai_proportion,rec.ai_focus,rec.ai_communication,rec.ai_model||'',fullTime(rec.ai_generated_at),rec.ai_image_summary,rec.ai_image_model||'',fullTime(rec.ai_image_generated_at)];
      const csv='\ufeff'+[headings,row].map(values=>values.map(csvCell).join(',')).join('\r\n');
      const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>我的作品及評語｜第 ${esc(d.round.round_no)} 輪</title><style>body{max-width:900px;margin:auto;padding:28px;font-family:-apple-system,BlinkMacSystemFont,"PingFang HK","Microsoft JhengHei",sans-serif;line-height:1.75;color:#172119;background:#f7f3eb}main{background:#fffdf8;padding:28px;border-top:4px solid #307927}h1,h2{font-family:serif}h2{margin-top:28px;color:#20591b}h3{font-size:14px;margin:16px 0 2px}p{white-space:pre-wrap}.meta{font-size:13px;color:#6d726a}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}figure{margin:0}img{width:100%;max-height:650px;object-fit:contain;background:#e9e5dc}figcaption{padding:8px 0;color:#6d726a}@media(max-width:600px){body{padding:14px}main{padding:18px}}</style></head><body><main><h1>我的作品及評語</h1><p class="meta">${esc(d.class.name)}｜第 ${esc(d.round.round_no)} 輪<br>學生：${esc(d.student.student_no)} ${esc(d.student.display_name)}<br>作品：${esc(art.title)}</p><div class="images"><figure><img src="${esc(encodeURIComponent(originalName))}" alt="我的原作"><figcaption>我的原作</figcaption></figure><figure><img src="${esc(encodeURIComponent(improvedName))}" alt="AI 改善效果圖"><figcaption>AI 改善效果圖</figcaption></figure></div><h2>同學的四部分觀察</h2><p class="meta">來源：隨機互評同學（匿名）｜遞交時間：${esc(fullTime(rec.submitted_at))}</p>${REVIEW_FIELDS.map(f=>`<h3>${esc(f.title)}</h3><p>${esc(peerValue(rec,f.key))}</p>`).join('')}<h2>AI 原作評價</h2><p class="meta">模型：${esc(rec.ai_model||'—')}｜生成時間：${esc(fullTime(rec.ai_generated_at))}</p>${REVIEW_FIELDS.map(f=>`<h3>${esc(f.title)}</h3><p>${esc(rec['ai_'+f.key])}</p>`).join('')}<h2>AI 改善效果圖紀錄</h2><p class="meta">模型：${esc(rec.ai_image_model||'—')}｜生成時間：${esc(fullTime(rec.ai_image_generated_at))}</p><p>${esc(rec.ai_image_summary||'—')}</p></main></body></html>`;
      const zipped=window.fflate.zipSync({[originalName]:original.bytes,[improvedName]:improved.bytes,'我的評語紀錄.csv':new TextEncoder().encode(csv),'我的評語報告.html':new TextEncoder().encode(html)},{level:0});
      const blob=new Blob([zipped],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`${safeFileName(d.class.join_code)}_${safeFileName(d.student.student_no)}_第${String(d.round.round_no).padStart(2,'0')}輪_我的評語.zip`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      state.studentExport={status:'done',error:''};render();toast('你的評語及改善圖 ZIP 已開始下載。');
    }catch(e){state.studentExport={status:'error',error:e.message||'下載未完成，請稍後重試。'};render();}
  }

  async function downloadTeacherExport(){
    if(state.export.status==='working')return;
    const scope=$('#export-all').checked?'all':'current',s=state.session;
    state.export={status:'working',error:'',progress:'正在向雲端讀取評語紀錄……'};
    $('#export-form').querySelectorAll('input,button').forEach(el=>el.disabled=true);
    $('#export-status').textContent=state.export.progress;$('#export-error').textContent='';
    try{
      if(!window.fflate?.Zip||!window.fflate?.ZipPassThrough)throw new Error('ZIP 元件未能載入，請重新整理後再試。');
      const data=await rpc('get_teacher_export',{p_join_code:s.classCode,p_pin:s.pin,p_round_id:scope==='current'?state.teacherData?.round?.id:null});
      const records=data.records||[];if(!records.length)throw new Error('所選範圍尚未有作品，沒有可匯出的紀錄。');
      const chunks=[];
      await new Promise((resolve,reject)=>{
        const zip=new window.fflate.Zip((error,chunk,final)=>{if(error){reject(error);return;}chunks.push(chunk);if(final)resolve();});
        const add=(path,content)=>{const entry=new window.fflate.ZipPassThrough(path);zip.add(entry);entry.push(typeof content==='string'?new TextEncoder().encode(content):content,true);};
        (async()=>{
          for(let i=0;i<records.length;i++){
            const r=records[i],folder=`第${String(r.round_no).padStart(2,'0')}輪/${safeFileName(r.student_no)}_${safeFileName(r.display_name)}`;
            $('#export-status').textContent=`正在下載 ${i+1}／${records.length}：${r.student_no} ${r.display_name} 的原作……`;
            const original=await exportImage(r.image_path,`${r.student_no} ${r.display_name} 的原作`);
            r.original_file=`${folder}/原作.${original.extension}`;add(r.original_file,original.bytes);
            if(r.ai_image_path){
              $('#export-status').textContent=`正在下載 ${i+1}／${records.length}：${r.student_no} ${r.display_name} 的改善圖……`;
              const improved=await exportImage(r.ai_image_path,`${r.student_no} ${r.display_name} 的改善圖`);
              r.ai_image_file=`${folder}/AI改善效果圖.${improved.extension}`;add(r.ai_image_file,improved.bytes);
            }else r.ai_image_file='';
          }
          $('#export-status').textContent='正在整理 HTML 評語報告及 CSV 紀錄……';
          const documents=buildExportDocuments(data,records);add('評語紀錄.csv',documents.csv);add('評語報告.html',documents.html);zip.end();
        })().catch(reject);
      });
      const blob=new Blob(chunks,{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`${safeFileName(data.class.join_code)}_${scope==='all'?'全部輪次':'目前一輪'}_${new Date().toISOString().slice(0,10)}.zip`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      state.export={status:'done',error:'',progress:''};$('#export-status').textContent=`已完成：${records.length} 份作品，ZIP 已開始下載。`;$('#export-form').querySelectorAll('input,button').forEach(el=>el.disabled=false);$('#export-current').disabled=!state.teacherData?.round?.id;toast('作品及評語 ZIP 已製作完成。');
    }catch(e){
      state.export={status:'error',error:e.message,progress:''};$('#export-status').textContent='匯出未完成；請處理錯誤後重新下載，避免使用不完整的 ZIP。';$('#export-error').textContent=e.message;
      $('#export-form').querySelectorAll('input,button').forEach(el=>el.disabled=false);$('#export-current').disabled=!state.teacherData?.round?.id;
    }
  }

  function renderTeacher(){
    const d=state.teacherData;if(!d)return;const r=d.round,students=d.students||[];
    const uploads=students.filter(s=>s.has_artwork).length,reviews=students.filter(s=>s.review_status==='submitted').length;
    const active=['collecting','reviewing'].includes(r?.status);
    const statusText=!r?'尚未開始':r.status==='collecting'?'作品上載中':r.status==='reviewing'?'同儕互評中':'本輪已完結';
    const rows=students.map(s=>`<tr><td><strong>${esc(s.student_no)}</strong></td><td>${esc(s.display_name)}${s.id.startsWith('bot-')&&!LIVE?' <span class="side-meta">（示例）</span>':''}</td><td><span class="status-tag ${s.has_artwork?'done':'waiting'}">${s.has_artwork?'已上載':'未上載'}</span></td><td><span class="status-tag ${s.review_status==='submitted'?'done':s.review_status==='assigned'?'active':'waiting'}">${s.review_status==='submitted'?'已遞交意見':s.review_status==='assigned'?'互評進行中':'尚未分配'}</span></td></tr>`).join('');
    $('#main').innerHTML=`<div class="app-shell"><div class="app-topline"><div><p class="eyebrow">TEACHER CONSOLE</p><h1>${esc(d.class.name)}</h1><p>${esc(statusText)} · 每 10 秒自動更新</p></div><div class="user-actions"><button class="outline-button compact" data-action="logout">離開 <span>↗</span></button></div></div>${connectionHTML()}${errorHTML()}<div class="class-code-box"><span class="kicker">學生班別代碼</span><strong>${esc(d.class.join_code)}</strong><button class="outline-button small-button" data-action="copy-code" data-code="${esc(d.class.join_code)}">複製代碼</button></div><div class="teacher-stats"><div class="stat timer-stat"><strong>${r?.status==='collecting'?`<span class="timer" data-deadline="${esc(r.submission_ends_at)}">--:--</span>`:esc(statusText)}</strong><span>${r?.status==='collecting'?'距離上載截止':'目前活動狀態'}</span></div><div class="stat"><strong>${students.length}</strong><span>已加入學生</span></div><div class="stat"><strong>${uploads}<small style="font-size:16px;color:var(--muted)">／${students.length}</small></strong><span>已上載作品</span></div><div class="stat"><strong>${reviews}<small style="font-size:16px;color:var(--muted)">／${uploads}</small></strong><span>已完成互評</span></div></div><div class="teacher-controls"><div>${!active?`<label class="field-label" for="round-duration">下一輪上載時限（分鐘）</label><input id="round-duration" type="number" min="1" max="120" value="${d.class.duration_minutes||15}" style="width:150px">`:`<p>${r.status==='collecting'?'倒數完結後，系統會以伺服器時間自動隨機分配，不會分到自己的作品。':'學生正在填寫四部分意見；全部完成後，本輪會自動完結。'}</p>`}</div><div class="control-buttons">${!active?`<button class="primary-button" data-action="start-round">開始 ${r?'新一輪':'第一輪'} <span>→</span></button>`:''}${r?.status==='collecting'?`<button class="secondary-button" data-action="close-round">提前截止並分配</button>`:''}${r?.status==='reviewing'?`<button class="danger-button" data-action="complete-round">結束本輪互評</button>`:''}</div></div><section><div class="section-heading"><div><span class="kicker">LIVE PROGRESS</span><h2>學生進度</h2></div><div class="teacher-table-actions"><button class="primary-button small-button" data-action="open-export">下載作品及評語</button><button class="text-button" data-action="refresh-teacher">重新整理 ↻</button></div></div><div class="student-table-wrap">${students.length?`<table class="student-table"><thead><tr><th>學生編號</th><th>姓名</th><th>作品</th><th>互評意見</th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="empty-class">學生以班別代碼及學生編號加入後，進度會顯示在這裡。</div>`}</div></section></div>`;
    updateTimer();
  }
  function render(){
    clearInterval(countdownTimer);countdownTimer=null;
    $('#connection-badge').className=`connection-badge ${LIVE?'live':'demo'}`;
    $('#connection-badge').innerHTML=`<i></i>${LIVE?'雲端已連線':'本機示範'}`;
    if(state.view==='student'&&state.data)renderStudent();else if(state.view==='teacher'&&state.teacherData)renderTeacher();else renderHome();
    countdownTimer=setInterval(updateTimer,1000);
  }
  function updateTimer(){
    $$('[data-deadline]').forEach(el=>{
      const diff=new Date(el.dataset.deadline).getTime()-Date.now();
      if(diff<=0){el.textContent='00:00';el.classList.add('expired');return;}
      const total=Math.floor(diff/1000),days=Math.floor(total/86400),h=Math.floor(total%86400/3600),m=Math.floor(total%3600/60),s=total%60;
      el.textContent=(days>0?`${days}日 `:'')+(h>0?`${String(h).padStart(2,'0')}:`:'')+`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    });
  }
  function logout(){if(!confirm('離開目前的班別頁面？已遞交的內容及草稿會保留。'))return;clearInterval(pollTimer);state.session=null;saveSession();state.data=null;state.teacherData=null;state.view='home';state.file=null;state.preview='';state.lastSignature='';state.lastTeacherSignature='';state.error='';render();window.scrollTo({top:0,behavior:'smooth'});}
  async function copyText(text){try{await navigator.clipboard.writeText(text);toast('班別代碼已複製。');}catch{prompt('請複製班別代碼：',text);}}
  function restartPolling(){clearInterval(pollTimer);pollTimer=setInterval(()=>{if(state.view==='student')refreshStudent(true);if(state.view==='teacher')refreshTeacher(true);},CFG.POLL_INTERVAL||10000);}

  // ----- 事件 -----
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
    if(action==='go-home'){if(state.session){state.view=state.session.role;render();}else{state.view='home';render();window.scrollTo({top:0,behavior:'smooth'});}}
    if(action==='show-guide')$('#guide-dialog').showModal();
    if(action==='close-guide')$('#guide-dialog').close();
    if(action==='open-export')openTeacherExport();
    if(action==='close-export'&&state.export.status!=='working')$('#export-dialog').close();
    if(action==='confirm-export')await downloadTeacherExport();
    if(action==='teacher-entry'){state.view='home';state.homeMode='teacher';state.error='';render();setTimeout(()=>$('.entry-panel')?.scrollIntoView({behavior:'smooth',block:'center'}),20);}
    if(action==='home-student'){state.homeMode='student';state.error='';render();}
    if(action==='home-teacher'){state.homeMode='teacher';state.error='';render();}
    if(action==='teacher-login-tab'){state.demoTeacher=false;state.error='';render();}
    if(action==='teacher-create-tab'){state.demoTeacher=true;state.error='';render();}
    if(action==='fill-demo-student'){state.homeMode='student';render();$('#classCode').value='DEMO15';$('#studentNo').value='08';$('#displayName').value='陳同學';}
    if(action==='fill-demo-teacher'){state.homeMode='teacher';state.demoTeacher=false;render();$('#classCode').value='DEMO15';$('#pin').value='1234';}
    if(action==='logout')logout();
    if(action==='clear-image'){state.file=null;state.preview='';render();}
    if(action==='replace-artwork'){state.replacing=true;state.file=null;state.preview='';render();}
    if(action==='cancel-replace'){state.replacing=false;state.file=null;state.preview='';render();}
    if(action==='upload-artwork')await uploadArtwork();
    if(action==='demo-close-student'){const original=state.session;state.session={role:'demo',classCode:original.classCode};await closeRound();state.session=original;state.lastSignature='';await refreshStudent();}
    if(action==='start-round')await startRound();
    if(action==='close-round')await closeRound();
    if(action==='complete-round')await completeRound();
    if(action==='refresh-teacher')await refreshTeacher();
    if(action==='copy-code')await copyText(b.dataset.code);
    if(action==='toggle-phrase'){
      const field=b.dataset.field,phrase=b.dataset.phrase,area=document.getElementById(field);if(!area||!REVIEW_FIELDS.some(f=>f.key===field))return;
      let value=area.value;
      if(value.includes(phrase)){
        value=value.split(phrase).join('').replace(/(^|[；;\n])\s*[；;]+/g,'$1').replace(/[；;]{2,}/g,'；').replace(/^\s*[；;]\s*/,'').replace(/\s*[；;]\s*$/,'');
      }else{
        const separator=value.trim()?(/[。！？；;\n]$/.test(value.trim())?'':'；'):'';
        value=value.trimEnd()+separator+phrase;
      }
      if(value.length>2000){toast('這部分不可超過 2000 字。','error');return;}
      area.value=value;state.draft[field]=value;$(`[data-count="${field}"]`).textContent=value.length;saveDraft();
      $$(`[data-field="${field}"]`).forEach(chip=>{const selected=value.includes(chip.dataset.phrase);chip.classList.toggle('selected',selected);chip.setAttribute('aria-pressed',String(selected));});
      area.focus();
    }
    if(action==='retry-ai'){const rec=state.data?.received;if(rec)generateAI(rec.id||rec.submitted_at);}
    if(action==='generate-ai-image'){const rec=state.data?.received;if(rec)await generateAIImage(rec.id||rec.submitted_at);}
    if(action==='download-student-pack')await downloadStudentPack();
    if(action==='refresh-student')await refreshStudent();
  });
  document.addEventListener('submit',async e=>{
    e.preventDefault();
    if(e.target.id==='student-login-form')await joinStudent(e.target);
    if(e.target.id==='teacher-login-form')await loginTeacher(e.target);
    if(e.target.id==='create-class-form')await createClass(e.target);
    if(e.target.id==='review-form')await submitReview();
  });
  document.addEventListener('change',e=>{if(e.target.id==='artwork-file')selectImage(e.target.files[0]);});
  document.addEventListener('input',e=>{
    if(REVIEW_FIELDS.some(f=>f.key===e.target.id)){
      state.draft[e.target.id]=e.target.value;const count=$(`[data-count="${e.target.id}"]`);if(count)count.textContent=e.target.value.length;saveDraft();
      $$(`[data-field="${e.target.id}"]`).forEach(chip=>{const selected=e.target.value.includes(chip.dataset.phrase);chip.classList.toggle('selected',selected);chip.setAttribute('aria-pressed',String(selected));});
    }
    if(e.target.name==='classCode')e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,'');
  });
  document.addEventListener('dragover',e=>{const z=e.target.closest('#upload-zone');if(z){e.preventDefault();z.classList.add('dragging');}});
  document.addEventListener('dragleave',e=>{const z=e.target.closest('#upload-zone');if(z)z.classList.remove('dragging');});
  document.addEventListener('drop',e=>{const z=e.target.closest('#upload-zone');if(z){e.preventDefault();z.classList.remove('dragging');selectImage(e.dataTransfer.files[0]);}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.view==='student')refreshStudent(true);if(state.view==='teacher')refreshTeacher(true);}});
  window.addEventListener('online',()=>{toast('網絡已恢復，正在同步紀錄。');if(state.view==='student')refreshStudent(true);if(state.view==='teacher')refreshTeacher(true);});
  window.addEventListener('offline',()=>toast('目前離線。已保存的草稿仍在此裝置，雲端同步會在恢復連線後繼續。','error'));
  window.addEventListener('beforeunload',()=>{if(Object.values(state.draft).some(Boolean))saveDraft(true);});

  async function init(){
    render();
    if(state.session){
      state.view=state.session.role;
      const cached=store.get(KEYS.cache);if(state.session.role==='student'&&cached?.session?.token===state.session.token){state.data=cached.data;state.lastSignature=JSON.stringify({round:cached.data.round,art:cached.data.my_artwork,assignment:cached.data.assignment,received:cached.data.received});loadDraft();render();}
      if(state.session.role==='student')await refreshStudent(true);else await refreshTeacher(true);
      restartPolling();
    }
    if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  init();
})();
