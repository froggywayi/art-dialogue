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
  const state = { view:'home', homeMode:'student', session:store.get(KEYS.session), data:null, teacherData:null,
    loading:false, error:'', file:null, preview:'', draft:{appreciation:'',improvement:''}, draftKey:'', lastSignature:'', lastTeacherSignature:'', demoTeacher:false, replacing:false };
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
    state.draft=all[state.draftKey]||{appreciation:'',improvement:''};
  }
  function saveDraft(immediate=false){
    clearTimeout(draftTimer);
    const write=()=>{if(!state.draftKey)return;const all=store.get(KEYS.draft,{});all[state.draftKey]={...state.draft,updatedAt:nowISO()};store.set(KEYS.draft,all);const e=$('.draft-status');if(e)e.textContent='草稿已保存在此裝置 · '+new Date().toLocaleTimeString('zh-HK',{hour:'2-digit',minute:'2-digit'});};
    if(immediate)write();else draftTimer=setTimeout(write,450);
  }
  function clearDraft(){const all=store.get(KEYS.draft,{});delete all[state.draftKey];store.set(KEYS.draft,all);state.draft={appreciation:'',improvement:''};}

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
      d.reviews.push({id:uid(),round_id:r.id,artwork_id:a.id,reviewer_id:reviewer,appreciation:'',improvement:'',submitted_at:null});
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
  async function refreshStudent(silent=false){
    if(!state.session||state.session.role!=='student')return;
    if(!silent)setLoading(true);
    try{
      const data=LIVE?await rpc('get_student_state',{p_token:state.session.token}):demoStudentState(state.session);
      const signature=JSON.stringify({round:data.round,art:data.my_artwork,assignment:data.assignment,received:data.received});
      state.data=data;store.set(KEYS.cache,{session:state.session,data});
      if(signature!==state.lastSignature){state.lastSignature=signature;loadDraft();render();}
      else updateTimer();
      state.error='';
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
    const a=state.draft.appreciation.trim(),i=state.draft.improvement.trim();
    if(a.length<2||i.length<2){toast('請完成兩部分意見，每部分至少輸入 2 個字。','error');return;}
    if(!confirm('遞交後不能修改意見。確定送給這位同學？'))return;
    setLoading(true);
    try{
      if(LIVE)await rpc('submit_review',{p_token:state.session.token,p_appreciation:a,p_improvement:i});
      else{
        const d=demoDB(),s=d.students.find(x=>x.token===state.session.token),c=d.classes.find(x=>x.join_code===state.session.classCode),r=d.rounds.find(x=>x.id===c.current_round_id);
        const rev=d.reviews.find(x=>x.round_id===r.id&&x.reviewer_id===s.id);if(!rev)throw new Error('找不到互評作品。');rev.appreciation=a;rev.improvement=i;rev.submitted_at=nowISO();
        const mine=d.artworks.find(x=>x.round_id===r.id&&x.student_id===s.id);
        if(mine){let incoming=d.reviews.find(x=>x.artwork_id===mine.id);if(!incoming){const bot=d.students.find(x=>x.id.startsWith('bot-'));incoming={id:uid(),round_id:r.id,artwork_id:mine.id,reviewer_id:bot.id};d.reviews.push(incoming);}incoming.appreciation='你很大膽地安排畫面的主次，色彩之間有清楚的呼應，讓人的目光自然落在最重要的部分。';incoming.improvement='背景部分略為搶眼，可以試着降低背景的對比度，並在主體邊緣保留多一點留白，令層次更清楚。';incoming.submitted_at=nowISO();}
        saveDemo(d);
      }
      clearDraft();state.lastSignature='';await refreshStudent();toast('意見已遞交，原作者現在可以閱讀。');
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
    <section class="process-strip" aria-label="活動流程"><div class="process-item"><span>01</span><div><strong>上載自己的作品</strong><p>老師啟動倒數，截止前遞交一張圖片。</p></div></div><div class="process-item"><span>02</span><div><strong>為同學留下回應</strong><p>隨機匿名分配，填寫欣賞與改善方案。</p></div></div><div class="process-item"><span>03</span><div><strong>帶着意見再出發</strong><p>原作者收回具體回饋，階段自動保存。</p></div></div></section>`;
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
    if(a.submitted_at)return `<div class="waiting-state"><div class="submitted-check">✓</div><h2>你的意見已送達</h2><p>遞交時間：${fmtTime(a.submitted_at)}。原作者現在可以閱讀你的回應；你亦可在右方查看自己收到的意見。</p></div>`;
    const art=a.artwork;
    return `<div class="review-artwork"><img src="${esc(imageUrl(art.image_path))}" alt="獲隨機分配的同學作品：${esc(art.title)}"><span class="artwork-label">匿名同學作品</span></div><p class="kicker">YOUR RESPONSE</p><h2 style="font-family:var(--serif);font-weight:600">${esc(art.title||'同學的作品')}</h2><p class="panel-intro">先看整體，再看細節。寫出具體觀察，讓同學知道下一步可以怎樣做。</p><form id="review-form"><div class="review-prompt"><label for="appreciation"><span class="prompt-number">1</span>欣賞的地方</label><p class="field-help">哪一個色彩、構圖、技巧或想法值得保留？為甚麼？</p><textarea id="appreciation" name="appreciation" maxlength="2000" placeholder="我欣賞……因為……" required>${esc(state.draft.appreciation)}</textarea><div class="char-count"><span data-count="appreciation">${state.draft.appreciation.length}</span>／2000</div></div><div class="review-prompt"><label for="improvement"><span class="prompt-number">2</span>不足及改善方案</label><p class="field-help">指出一個可改善之處，同時提出具體、可行的修改方法。</p><textarea id="improvement" name="improvement" maxlength="2000" placeholder="我覺得……可以試着……令……" required>${esc(state.draft.improvement)}</textarea><div class="char-count"><span data-count="improvement">${state.draft.improvement.length}</span>／2000</div></div><div class="draft-status">${state.draft.appreciation||state.draft.improvement?'已載入此裝置上的草稿':''}</div><div class="submit-row"><button class="primary-button" type="submit">遞交意見給同學 <span>→</span></button><span class="save-hint">遞交後不能修改，請先檢查內容。</span></div></form>`;
  }
  function sideHTML(data){
    const art=data.my_artwork,rec=data.received;
    return `<aside class="workspace-side"><section class="side-section"><h3>我的作品</h3>${art?`<img class="side-art" src="${esc(imageUrl(art.image_path))}" alt="我的作品：${esc(art.title)}"><h4 class="side-title">${esc(art.title)}</h4><span class="side-meta">已於 ${fmtTime(art.created_at)} 遞交</span>`:`<p class="empty-side">尚未上載作品。</p>`}</section><section class="side-section"><h3>我收到的意見</h3>${rec?.submitted_at?`<div class="feedback-received"><span class="feedback-label">01 · 欣賞的地方</span><p class="feedback-quote">${esc(rec.appreciation)}</p><span class="feedback-label">02 · 不足及改善方案</span><p class="feedback-quote">${esc(rec.improvement)}</p><span class="side-meta">同學已於 ${fmtTime(rec.submitted_at)} 遞交</span></div>`:`<p class="empty-side">${art?'負責互評的同學遞交後，意見會自動出現在這裡。':'上載作品後，才有機會收到同學意見。'}</p>`}</section></aside>`;
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

  function renderTeacher(){
    const d=state.teacherData;if(!d)return;const r=d.round,students=d.students||[];
    const uploads=students.filter(s=>s.has_artwork).length,reviews=students.filter(s=>s.review_status==='submitted').length;
    const active=['collecting','reviewing'].includes(r?.status);
    const statusText=!r?'尚未開始':r.status==='collecting'?'作品上載中':r.status==='reviewing'?'同儕互評中':'本輪已完結';
    const rows=students.map(s=>`<tr><td><strong>${esc(s.student_no)}</strong></td><td>${esc(s.display_name)}${s.id.startsWith('bot-')&&!LIVE?' <span class="side-meta">（示例）</span>':''}</td><td><span class="status-tag ${s.has_artwork?'done':'waiting'}">${s.has_artwork?'已上載':'未上載'}</span></td><td><span class="status-tag ${s.review_status==='submitted'?'done':s.review_status==='assigned'?'active':'waiting'}">${s.review_status==='submitted'?'已遞交意見':s.review_status==='assigned'?'互評進行中':'尚未分配'}</span></td></tr>`).join('');
    $('#main').innerHTML=`<div class="app-shell"><div class="app-topline"><div><p class="eyebrow">TEACHER CONSOLE</p><h1>${esc(d.class.name)}</h1><p>${esc(statusText)} · 每 10 秒自動更新</p></div><div class="user-actions"><button class="outline-button compact" data-action="logout">離開 <span>↗</span></button></div></div>${connectionHTML()}${errorHTML()}<div class="class-code-box"><span class="kicker">學生班別代碼</span><strong>${esc(d.class.join_code)}</strong><button class="outline-button small-button" data-action="copy-code" data-code="${esc(d.class.join_code)}">複製代碼</button></div><div class="teacher-stats"><div class="stat timer-stat"><strong>${r?.status==='collecting'?`<span class="timer" data-deadline="${esc(r.submission_ends_at)}">--:--</span>`:esc(statusText)}</strong><span>${r?.status==='collecting'?'距離上載截止':'目前活動狀態'}</span></div><div class="stat"><strong>${students.length}</strong><span>已加入學生</span></div><div class="stat"><strong>${uploads}<small style="font-size:16px;color:var(--muted)">／${students.length}</small></strong><span>已上載作品</span></div><div class="stat"><strong>${reviews}<small style="font-size:16px;color:var(--muted)">／${uploads}</small></strong><span>已完成互評</span></div></div><div class="teacher-controls"><div>${!active?`<label class="field-label" for="round-duration">下一輪上載時限（分鐘）</label><input id="round-duration" type="number" min="1" max="120" value="${d.class.duration_minutes||15}" style="width:150px">`:`<p>${r.status==='collecting'?'倒數完結後，系統會以伺服器時間自動隨機分配，不會分到自己的作品。':'學生正在填寫兩部分意見；全部完成後，本輪會自動完結。'}</p>`}</div><div class="control-buttons">${!active?`<button class="primary-button" data-action="start-round">開始 ${r?'新一輪':'第一輪'} <span>→</span></button>`:''}${r?.status==='collecting'?`<button class="secondary-button" data-action="close-round">提前截止並分配</button>`:''}${r?.status==='reviewing'?`<button class="danger-button" data-action="complete-round">結束本輪互評</button>`:''}</div></div><section><div class="section-heading"><div><span class="kicker">LIVE PROGRESS</span><h2>學生進度</h2></div><button class="text-button" data-action="refresh-teacher">重新整理 ↻</button></div><div class="student-table-wrap">${students.length?`<table class="student-table"><thead><tr><th>學生編號</th><th>姓名</th><th>作品</th><th>互評意見</th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="empty-class">學生以班別代碼及學生編號加入後，進度會顯示在這裡。</div>`}</div></section></div>`;
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
    if(['appreciation','improvement'].includes(e.target.id)){state.draft[e.target.id]=e.target.value;const count=$(`[data-count="${e.target.id}"]`);if(count)count.textContent=e.target.value.length;saveDraft();}
    if(e.target.name==='classCode')e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,'');
  });
  document.addEventListener('dragover',e=>{const z=e.target.closest('#upload-zone');if(z){e.preventDefault();z.classList.add('dragging');}});
  document.addEventListener('dragleave',e=>{const z=e.target.closest('#upload-zone');if(z)z.classList.remove('dragging');});
  document.addEventListener('drop',e=>{const z=e.target.closest('#upload-zone');if(z){e.preventDefault();z.classList.remove('dragging');selectImage(e.dataTransfer.files[0]);}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.view==='student')refreshStudent(true);if(state.view==='teacher')refreshTeacher(true);}});
  window.addEventListener('online',()=>{toast('網絡已恢復，正在同步紀錄。');if(state.view==='student')refreshStudent(true);if(state.view==='teacher')refreshTeacher(true);});
  window.addEventListener('offline',()=>toast('目前離線。已保存的草稿仍在此裝置，雲端同步會在恢復連線後繼續。','error'));
  window.addEventListener('beforeunload',()=>{if(state.draft.appreciation||state.draft.improvement)saveDraft(true);});

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
