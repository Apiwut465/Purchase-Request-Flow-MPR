/* app.js — ใช้ Supabase เท่านั้น (ไม่มีโหมด demo) */
const SUPABASE_URL  = "https://mleffbtdolgxzybqbszm.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sZWZmYnRkb2xneHp5YnFic3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MDkzMzEsImV4cCI6MjA3NTQ4NTMzMX0.MRip0lGdmugYpfFvaLddwdxLNm4s5rTAdemd0QS_B3Y";

const TABLE        = "purchase_requests";
const IMG_BUCKET   = "pr-images";
const QUOTE_BUCKET = "pr-quotes";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ลงชื่อแบบ anonymous เพื่อให้ policy ฝั่ง Supabase ที่ต้องการ authenticated ทำงาน
(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) await supabase.auth.signInAnonymously();
  } catch (e) {
    console.warn("Anonymous sign-in skipped:", e?.message || e);
  }
})();

document.getElementById('mode_label')?.replaceChildren(document.createTextNode('Supabase'));

/* ---------- Helpers ---------- */
const $  = (s,ctx=document)=>ctx.querySelector(s);
const $$ = (s,ctx=document)=>Array.from(ctx.querySelectorAll(s));
function fmtDate(d){
  if(!d) return '';
  if(typeof d==='string' && /^(\d{4})-(\d{2})-(\d{2})$/.test(d)){
    const [_,y,m,day]=d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return new Date(Number(y),Number(m)-1,Number(day)).toLocaleDateString('th-TH');
  }
  return new Date(d).toLocaleDateString('th-TH');
}
function fmtDateISO(d){
  const dt = new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth()+1).padStart(2,'0');
  const da = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}
const uid = ()=> Math.random().toString(36).slice(2)+Date.now().toString(36);
function esc(s){ return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;"); }
function priorityPill(p){ const map={Urgent:'red',High:'orange',Normal:'green'}; return `<span class="pill ${map[p]||'green'}">${esc(p)}</span>`; }
function statusColor(st){ if(st==='Requested')return'orange'; if(st==='Approved')return'blue'; if(st==='PO Issued')return'blue'; if(st==='Received')return'green'; if(st==='Rejected')return'red'; return'orange'; }
function csvSafe(v){ let s=String(v??''); if(/^[=\-+@]/.test(s)) s="'"+s; return `"${s.replaceAll('"','""')}"`; }

/* ---------- Toast ---------- */
function showToast(message,type='info'){
  let container=document.querySelector('.toast-container');
  if(!container){
    container=document.createElement('div');
    container.className='toast-container';
    document.body.appendChild(container);
  }
  const icons={success:'✅',info:'ℹ️',warn:'⚠️',error:'❌'};
  const toast=document.createElement('div');
  toast.className=`toast ${type}`;
  toast.innerHTML=`<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(()=>toast.remove(),4200);
}

/* ---------- State ---------- */
const state = { rows: [], reportRows: [] };

/* ---------- Lists (combobox) ---------- */
const LIST_STORE_KEY='purchase_portal_lists_v1';
const DEFAULT_LISTS={
  depts:['Maintenance (MVR)','Maintenance (MSR)','Maintenance (Lotus)'],
  units:['pcs','set','meter','roll','box','pack'],
  machines:['Vacuum Forming','Extruder','Robot C-line','Crusher','Robot B-line','Press','Lead wire','Pipe','Gasket','Vacuum Lotus']
};
function loadLists(){ try{ return {...DEFAULT_LISTS, ...(JSON.parse(localStorage.getItem(LIST_STORE_KEY)||'{}'))}; }catch{ return {...DEFAULT_LISTS}; } }
function saveLists(l){ localStorage.setItem(LIST_STORE_KEY, JSON.stringify(l||{})); }
let LISTS = loadLists();

/* ---------- Supabase wrappers ---------- */
// กันชื่อไฟล์ชนกัน: เติม timestamp suffix ตอนอัปโหลด
async function uploadToBucket(bucket,file,objectPath){
  const parts = objectPath.split('.');
  const ts = Date.now();
  const objectPathTs = parts.length>1
    ? `${parts.slice(0,-1).join('.')}_${ts}.${parts.at(-1)}`
    : `${objectPath}_${ts}`;
  const { error } = await supabase.storage.from(bucket).upload(objectPathTs,file,{upsert:false,cacheControl:'3600'});
  if(error) throw error;
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPathTs);
  return pub.publicUrl;
}

async function apiSubmit({row,imgFile,quoteFiles}){
  let image_url='';
  if(imgFile){
    const ext=(imgFile.name.split('.').pop()||'jpg').toLowerCase();
    image_url=await uploadToBucket(IMG_BUCKET,imgFile,`${row.id}/image.${ext}`);
  }
  const quote_urls=[];
  for(let i=0;i<(quoteFiles?.length||0);i++){
    const f=quoteFiles[i];
    const url=await uploadToBucket(QUOTE_BUCKET,f,`${row.id}/quote_${i+1}.pdf`);
    quote_urls.push(url);
  }
  const toInsert={...row,image_url,quote_files:quote_urls};
  const { error } = await supabase.from(TABLE).insert([toInsert]); if(error) throw error;
  return { ok:true, id:row.id };
}
async function apiList(){ const { data,error } = await supabase.from(TABLE).select('*').order('ts',{ascending:false}); if(error) throw error; return { ok:true, rows:data }; }

// อนุญาตอัปเดตทั้งสถานะและฟิลด์รายการ (ใช้ guard ฝั่ง UI ไม่ให้แก้เมื่อ Approved)
async function apiUpdate(patch){
  const payload={};
  if('status'in patch) payload.status=patch.status;
  if('status_ts'in patch) payload.status_ts=patch.status_ts;
  if('po'in patch) payload.po=patch.po;
  if('note'in patch) payload.note=patch.note;

  ['requester','dept','part','pn','qty','unit','machine','priority','reason']
    .forEach(k=>{ if(k in patch) payload[k]=patch[k]; });

  const { error } = await supabase.from(TABLE).update(payload).eq('id',patch.id);
  if(error) throw error; return { ok:true };
}
async function apiDelete(id){
  const { error } = await supabase.from(TABLE).delete().eq('id',id);
  if(error) throw error;
  await supabase.storage.from(IMG_BUCKET).remove([`${id}/image.jpg`,`${id}/image.jpeg`,`${id}/image.png`,`${id}/image.webp`]).catch(()=>{});
  const paths=['quote_1.pdf','quote_2.pdf','quote_3.pdf'].map(n=>`${id}/${n}`);
  await supabase.storage.from(QUOTE_BUCKET).remove(paths).catch(()=>{});
  return { ok:true };
}
async function apiMonth(){
  const start=new Date(); start.setDate(1); start.setHours(0,0,0,0);
  const end=new Date(start); end.setMonth(end.getMonth()+1);
  const { data,error } = await supabase.from(TABLE).select('*').gte('ts',start.toISOString()).lt('ts',end.toISOString()).order('ts',{ascending:false});
  if(error) throw error; return { ok:true, rows:data };
}

/* ---------- Combobox ---------- */
function attachCombobox(input,sourceGetter){
  const wrap=document.createElement('div'); wrap.className='combo-wrap';
  input.parentNode.insertBefore(wrap,input); wrap.appendChild(input);
  const caret=document.createElement('div'); caret.className='combo-caret'; caret.innerHTML='▾'; wrap.appendChild(caret);
  const list=document.createElement('div'); list.className='combo-list'; list.style.display='none'; wrap.appendChild(list);

  let items=[],activeIdx=-1;
  const open =()=> list.style.display='block';
  const close=()=>{ list.style.display='none'; activeIdx=-1; };

  const render=()=>{
    const q=(input.value||'').toLowerCase().trim();
    const src=(sourceGetter()||[]).slice().sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));
    items=src.filter(s=>s.toLowerCase().includes(q));
    list.innerHTML='';
    if(items.length===0){
      const empty=document.createElement('div'); empty.className='combo-empty';
      empty.textContent=q?'ไม่พบรายการที่ตรง':'ยังไม่มีรายการ'; list.appendChild(empty); return;
    }
    items.forEach((name,i)=>{
      const it=document.createElement('div'); it.className='combo-item'; it.textContent=name;
      it.addEventListener('mousedown',(e)=>{ e.preventDefault(); input.value=name; close(); });
      list.appendChild(it);
    });
  };

  input.addEventListener('focus',()=>{render();open();});
  input.addEventListener('input',()=>{render();open();});
  input.addEventListener('blur',()=>setTimeout(close,120));
  input.addEventListener('keydown',(e)=>{
    if(list.style.display==='none') return;
    const max=items.length-1;
    if(e.key==='ArrowDown'){e.preventDefault();activeIdx=Math.min(max,activeIdx+1);highlight();}
    else if(e.key==='ArrowUp'){e.preventDefault();activeIdx=Math.max(0,activeIdx-1);highlight();}
    else if(e.key==='Enter'){ if(activeIdx>=0){ input.value=items[activeIdx]; close(); } }
    else if(e.key==='Escape'){ close(); }
  });
  function highlight(){ [...list.querySelectorAll('.combo-item')].forEach((el,i)=>{ el.classList.toggle('active',i===activeIdx); if(i===activeIdx) el.scrollIntoView({block:'nearest'}); }); }

  return { refresh:render };
}
let _combos=[];
function refreshComboboxSources(){ _combos.forEach(c=>c.refresh()); }
function initComboboxes(){
  _combos=[];
  document.querySelectorAll('input[data-combo]').forEach(inp=>{
    const kind=inp.dataset.combo;
    const getSrc=()=>LISTS[kind]||[];
    const combo=attachCombobox(inp,getSrc);
    _combos.push(combo);
  });
}

/* ---------- Settings UI ---------- */
function renderSettings(){
  const renderTags=(elId,arr,kind)=>{
    const el=document.getElementById(elId); if(!el) return; el.innerHTML='';
    (arr||[]).forEach((name,idx)=>{
      const tag=document.createElement('div'); tag.className='tag';
      tag.innerHTML=`<span>${esc(name)}</span><button title="ลบ" aria-label="remove">&times;</button>`;
      tag.querySelector('button').addEventListener('click',()=>{
        LISTS[kind].splice(idx,1); saveLists(LISTS); renderSettings(); refreshComboboxSources(); showToast('ลบรายการแล้ว','info');
      });
      el.appendChild(tag);
    });
  };
  renderTags('list_depts',LISTS.depts,'depts');
  renderTags('list_units',LISTS.units,'units');
  renderTags('list_machines',LISTS.machines,'machines');
}
function bindSettingsActions(){
  const addOne=(inpId,kind)=>{
    const v=(document.getElementById(inpId).value||'').trim(); if(!v) return;
    if(!LISTS[kind]) LISTS[kind]=[];
    if(!LISTS[kind].includes(v)) LISTS[kind].push(v);
    document.getElementById(inpId).value='';
    saveLists(LISTS); renderSettings(); refreshComboboxSources(); showToast('เพิ่มรายการแล้ว','success');
  };
  $('#btn_add_dept')?.addEventListener('click',()=>addOne('add_dept','depts'));
  $('#btn_add_unit')?.addEventListener('click',()=>addOne('add_unit','units'));
  $('#btn_add_machine')?.addEventListener('click',()=>addOne('add_machine','machines'));
  $('#btn_reset_defaults')?.addEventListener('click',()=>{
    if(confirm('คืนค่าเริ่มต้นทั้งหมดหรือไม่?')){
      LISTS={...DEFAULT_LISTS}; saveLists(LISTS); renderSettings(); refreshComboboxSources(); showToast('คืนค่าเริ่มต้นแล้ว','info');
    }
  });
}

/* ---------- Tabs ---------- */
function setActiveTab(tab){
  $('#request') .classList.toggle('hidden', tab!=='request');
  $('#dashboard').classList.toggle('hidden', tab!=='dashboard');
  $('#report')  .classList.toggle('hidden', tab!=='report');
  $('#settings').classList.toggle('hidden', tab!=='settings');

  $$('.tab').forEach(x=> x.classList.toggle('active', x.dataset.tab===tab));

  if(tab==='dashboard') reloadTable();
  if(tab==='report')    loadReport();
  if(tab==='settings'){ renderSettings(); initComboboxes(); }

  const mBtn  = document.getElementById('mobile_menu_btn');
  const mList = document.getElementById('mobile_menu_list');
  if (mList && !mList.classList.contains('hidden')) mList.classList.add('hidden');
  if (mBtn){
    mBtn.textContent = 'เมนู';
    mBtn.setAttribute('aria-expanded','false');
    mBtn.classList.remove('open');
  }
}
function bindTabs(){
  $$('.tabs .tab').forEach(t=>{
    const go = ()=> setActiveTab(t.dataset.tab);
    t.addEventListener('click', go);
    t.addEventListener('keydown', e=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); go(); }
    });
  });
}

/* ---------- Mobile menu ---------- */
function initMobileMenu(){
  const btn  = document.getElementById('mobile_menu_btn');
  const list = document.getElementById('mobile_menu_list');
  if(!btn || !list) return;

  btn.textContent = 'เมนู';
  btn.setAttribute('aria-expanded','false');

  const toggle = (force)=>{
    const show = force!==undefined ? force : list.classList.contains('hidden');
    list.classList.toggle('hidden', !show);
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    btn.classList.toggle('open', show);
  };

  const onBtn = (e)=>{ e.preventDefault(); toggle(); };
  btn.addEventListener('click', onBtn);
  btn.addEventListener('touchend', onBtn, {passive:false});

  list.querySelectorAll('.menu-item').forEach(it=>{
    const onItem = (e)=>{
      e.preventDefault();
      setActiveTab(it.dataset.tab);
      toggle(false);
    };
    it.addEventListener('click', onItem);
    it.addEventListener('touchend', onItem, {passive:false});
  });

  document.addEventListener('click', (e)=>{
    if(!list.classList.contains('hidden') && !list.contains(e.target) && e.target!==btn){
      toggle(false);
    }
  }, true);
}

/* ---------- INIT ---------- */
renderSettings(); bindSettingsActions(); initComboboxes();
bindTabs();
setActiveTab(document.querySelector('.tabs .tab.active')?.dataset.tab || 'request');
initMobileMenu();

/* ---------- Submit Form ---------- */
document.getElementById('btn_submit')?.addEventListener('click', async ()=>{
  const id=uid(); const ts=new Date().toISOString();
  const requester=$('#rq_name').value.trim();
  const dept=$('#rq_dept').value.trim();
  const part=$('#rq_part').value.trim();
  const pn=$('#rq_pn').value.trim();
  const qty=parseInt($('#rq_qty').value||'0',10);
  const unit=$('#rq_unit').value.trim();
  const machine=$('#rq_machine').value.trim();
  const priority=$('#rq_priority').value;
  const reason=$('#rq_reason').value.trim();

  if(!requester || !part || !qty){ showToast('กรุณากรอก "ชื่อผู้ขอ" / "ชื่ออะไหล่" / "จำนวน"','warn'); return; }
  if(qty<=0){ showToast('จำนวนต้องมากกว่า 0','warn'); return; }
  if(!unit){ showToast('กรุณาระบุหน่วย (Unit)','warn'); return; }
  if(!dept){ showToast('กรุณาระบุแผนก','warn'); return; }
  if(priority==='Urgent' && !reason){ showToast('กรุณากรอกเหตุผลเมื่อเป็น Urgent','warn'); return; }

  // ตรวจรูปภาพตาม MIME/ขนาด (ถ้ามี)
  const imgFile=$('#rq_image').files[0]||null;
  if (imgFile){
    const okTypes = ['image/jpeg','image/png','image/webp'];
    const MAX_IMAGE_MB = 3;
    if (!okTypes.includes(imgFile.type)) { showToast('รูปต้องเป็น JPG/PNG/WebP เท่านั้น','warn'); return; }
    if (imgFile.size > MAX_IMAGE_MB*1024*1024) { showToast(`รูปภาพเกิน ${MAX_IMAGE_MB}MB`, 'warn'); return; }
  }

  const qFilesInput=$('#rq_quotes'); const quoteFiles=[]; const MAX_FILES=3, MAX_MB=1.5;
  if(qFilesInput?.files){
    for(let i=0;i<Math.min(qFilesInput.files.length,MAX_FILES);i++){
      const f=qFilesInput.files[i];
      if(f.type!=='application/pdf'){ showToast(`ไฟล์ ${f.name} ไม่ใช่ PDF จึงข้ามไฟล์นี้`,'warn'); continue; }
      if(f.size>MAX_MB*1024*1024){ showToast(`ไฟล์ ${f.name} เกิน ${MAX_MB}MB จึงข้ามไฟล์นี้`,'warn'); continue; }
      quoteFiles.push(f);
    }
  }

  const baseRow={
    id, ts, requester, dept, part, pn, qty, unit, machine,
    priority, reason, image_url:'', status:'Requested',
    status_ts: ts,
    po:'', note:'', quote_files:[]
  };

  const btn=$('#btn_submit'); btn.disabled=true; btn.textContent='กำลังส่ง...';
  $('#req_status').innerHTML='กำลังส่งคำขอ...';
  try{
    const res=await apiSubmit({ row:baseRow, imgFile, quoteFiles });
    if(res.ok){
      $('#req_status').innerHTML='ส่งคำขอเรียบร้อย'; $('#btn_clear').click(); showToast('✅ ส่งคำขอเรียบร้อยแล้ว!','success');
      const pushUniq=(arr,v)=>{ if(v && !arr.includes(v)) arr.push(v); };
      pushUniq(LISTS.depts,dept); pushUniq(LISTS.units,unit); pushUniq(LISTS.machines,machine);
      saveLists(LISTS); refreshComboboxSources();
    }
  }catch(err){
    $('#req_status').innerHTML='ส่งไม่สำเร็จ: '+(err.message||String(err));
    showToast('❌ ส่งคำขอไม่สำเร็จ: '+(err.message||String(err)),'error');
  }finally{ btn.disabled=false; btn.textContent='ส่งคำขอ'; }
});

document.getElementById('btn_clear')?.addEventListener('click', ()=>{
  if(!confirm('ล้างฟอร์มทั้งหมดหรือไม่?')) return;
  ['rq_name','rq_dept','rq_part','rq_pn','rq_qty','rq_unit','rq_machine','rq_reason']
    .forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
  $('#rq_priority').value='Normal'; $('#rq_image').value=''; $('#rq_quotes').value='';
});

/* ---------- Dashboard table ---------- */
async function reloadTable(){
  const priority=$('#f_priority').value;
  const status=$('#f_status').value;
  const q=($('#f_search').value||'').toLowerCase();

  let rows=[];
  try{ const res=await apiList(); rows=res.rows||[]; }
  catch(e){ showToast('โหลดข้อมูลไม่สำเร็จ: '+(e.message||e),'error'); return; }
  state.rows=rows.slice();

  if(priority) rows=rows.filter(r=>r.priority===priority);
  if(status)   rows=rows.filter(r=>r.status===status);
  if (q) {
    rows = rows.filter(r =>
      [r.part, r.pn, r.machine, r.requester, r.dept]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  rows.sort((a,b)=>{
    const pr=p=>p==='Urgent'?0:p==='High'?1:2;
    const c1=pr(a.priority)-pr(b.priority); if(c1!==0) return c1;
    return new Date(b.ts)-new Date(a.ts);
  });

  const tbody=$('#tb_rows'); tbody.innerHTML='';
  for(const r of rows){
    const tr=document.createElement('tr');
    tr.className=`rec rec-${(r.priority||'Normal').toLowerCase()}`;
    const isApproved = r.status === 'Approved';
    tr.innerHTML=`
      <td>${priorityPill(r.priority)}</td>
      <td><div style="font-weight:600; letter-spacing:.2px">${esc(r.part)}</div></td>
      <td>${esc(r.pn)||'-'}</td>
      <td>${esc(r.machine)||'-'}</td>
      <td>${esc(r.qty)} ${esc(r.unit||'')}</td>
      <td>${esc(r.requester)} <div class="note">${fmtDate(r.ts)}</div></td>
      <td>
        <span class="pill ${statusColor(r.status)}">${esc(r.status||'-')}</span>
        <div class="note" style="margin-top:4px">อัปเดต: ${fmtDate(r.status_ts || r.ts)}</div>
      </td>
      <td class="col-actions">
        <div class="actions">
          <button class="btn small outline act-detail" data-id="${r.id}">รายละเอียด</button>
          <button class="btn small outline act-edit" data-id="${r.id}" ${isApproved ? 'disabled title="สถานะ Approved แล้ว ไม่สามารถแก้ไขได้"' : ''}>แก้ไข</button>
          <select class="status-select" data-id="${r.id}">
            ${['Requested','Approved','PO Issued','Received','Rejected'].map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <input class="po-input" data-id="${r.id}" placeholder="PO#/เหตุผล" value="${esc(r.po||r.note||'')}" />
          <button class="btn small outline act-save" data-id="${r.id}">บันทึก</button>
          <button class="btn small danger act-del" data-id="${r.id}">ลบ</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  $$('.act-detail').forEach(btn=>{
    btn.addEventListener('click',()=>{ const id=btn.dataset.id; const row=state.rows.find(x=>x.id===id); if(row) openDetail(row); });
  });

  // ปุ่มแก้ไข (ห้ามแก้เมื่อ Approved)
  $$('.act-edit').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id=btn.dataset.id; const row=state.rows.find(x=>x.id===id);
      if(!row) return;
      if(row.status === 'Approved'){ showToast('รายการที่อนุมัติแล้วไม่สามารถแก้ไขได้','warn'); return; }
      openEditModal(row);
    });
  });

  $$('.act-save').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id=btn.dataset.id;
      const st=$(`select.status-select[data-id="${id}"]`).value;
      const poOrNote=$(`input.po-input[data-id="${id}"]`).value.trim();

      const prev = state.rows.find(r=>r.id===id);
      const payload={ id };
      if(st==='PO Issued') payload.po = poOrNote; else payload.note = poOrNote;

      if (!prev || prev.status !== st) {
        payload.status = st;
        payload.status_ts = new Date().toISOString();
      }

      btn.textContent='กำลังบันทึก...'; btn.disabled=true;
      try{ await apiUpdate(payload); showToast('บันทึกแล้ว','success'); await reloadTable(); }
      catch(e){ showToast('บันทึกไม่สำเร็จ: '+(e.message||e),'error'); }
      finally{ btn.disabled=false; btn.textContent='บันทึก'; }
    });
  });

  $$('.act-del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id=btn.dataset.id; if(!confirm('ลบคำขอนี้หรือไม่?')) return;
      btn.textContent='กำลังลบ...'; btn.disabled=true;
      try{ await apiDelete(id); showToast('ลบรายการสำเร็จ','warn'); await reloadTable(); }
      catch(e){ showToast('ลบไม่สำเร็จ: '+(e.message||e),'error'); }
      finally{ btn.disabled=false; btn.textContent='ลบ'; }
    });
  });

  $$('.status-select').forEach(sel=>{
    const id=sel.dataset.id; const input=$(`input.po-input[data-id="${id}"]`);
    const setPH=()=> input && (input.placeholder = (sel.value==='PO Issued' ? 'PO#' : 'เหตุผล'));
    setPH(); sel.addEventListener('change',setPH);
  });

  // แสดงจำนวนรายการบนหัวข้อ
  const head = $('#heading-dashboard');
  if (head) head.innerHTML = `Dashboard จัดซื้อ <span class="note">(${rows.length} รายการ)</span>`;
}
document.getElementById('btn_reload')?.addEventListener('click', reloadTable);

/* ---------- filters debounce ---------- */
const deb=(fn,ms=180)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); } };
const debReload=deb(reloadTable,180);
document.getElementById('f_priority')?.addEventListener('change',debReload);
document.getElementById('f_status')?.addEventListener('change',debReload);
document.getElementById('f_search')?.addEventListener('input',debReload);

/* ---------- Report ---------- */
async function loadReport(){
  try{
    const res = await apiMonth();
    const rows = res.rows || [];
    state.reportRows = rows;

    const total = rows.length;
    const rq    = rows.filter(r => r.status === 'Requested').length;
    const appr  = rows.filter(r => r.status === 'Approved').length;
    const po    = rows.filter(r => r.status === 'PO Issued').length;
    const recv  = rows.filter(r => r.status === 'Received').length;
    const rej   = rows.filter(r => r.status === 'Rejected').length;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('k_total', total); set('k_requested', rq); set('k_appr', appr); set('k_po', po); set('k_recv', recv); set('k_rej', rej);

    const sumEl = document.getElementById('k_summary');
    if (sumEl) sumEl.textContent = `เดือนนี้มี ${total} รายการ • รอส่งต่อ ${rq} • อนุมัติแล้ว ${appr} • ออก PO ${po} • รับครบ ${recv} • Reject ${rej}`;

    const tbody = document.getElementById('tb_report');
    tbody.innerHTML = '';
    rows.sort((a,b) => new Date(b.ts) - new Date(a.ts));

    for (const r of rows){
      const files = Array.isArray(r.quote_files)? r.quote_files : [];
      const tr = document.createElement('tr');
      tr.className = `rec rec-${(r.priority||'Normal').toLowerCase()}`;
      tr.innerHTML = `
        <td class="rpt-date">${fmtDate(r.ts)}</td>
        <td>${esc(r.requester || '-')}</td>
        <td>${priorityPill(r.priority)}</td>
        <td>
          <b style="font-weight:600">${esc(r.part)}</b>
          <div class="note">PN: ${esc(r.pn||'-')}</div>
        </td>
        <td>${esc(r.qty)} ${esc(r.unit||'')}</td>
        <td>
          <span class="pill ${statusColor(r.status)}">${esc(r.status||'-')}</span>
          <div class="note" style="margin-top:4px">อัปเดต: ${fmtDate(r.status_ts || r.ts)}</div>
        </td>
        <td>${esc(r.po||'-')}</td>
      `;
      tbody.appendChild(tr);
    }
  }catch(e){
    showToast('โหลดรายงานไม่สำเร็จ: '+(e.message||e), 'error');
  }
}

/* ---------- Detail Modal ---------- */
const modal=$('#detail_modal'); const modalBody=$('#detail_body');
function openDetail(r){
  const files=Array.isArray(r.quote_files)? r.quote_files : [];
  const noFiles = !r.image_url && (!files || !files.length);
  modalBody.innerHTML=`
    <div class="detail-grid">
      <div class="lbl">ผู้ขอ</div><div class="val">${esc(r.requester||'-')}</div>
      <div class="lbl">แผนก</div><div class="val">${esc(r.dept||'-')}</div>
      <div class="lbl">Part Name</div><div class="val">${esc(r.part||'-')}</div>
      <div class="lbl">Part No.</div><div class="val">${esc(r.pn||'-')}</div>
      <div class="lbl">จำนวน</div><div class="val">${esc(r.qty)} ${esc(r.unit||'')}</div>
      <div class="lbl">เครื่อง/ไลน์</div><div class="val">${esc(r.machine||'-')}</div>
      <div class="lbl">Priority</div><div class="val">${priorityPill(r.priority)}</div>
      <div class="lbl">สถานะ</div><div class="val"><span class="pill ${statusColor(r.status)}">${esc(r.status||'-')}</span></div>
      <div class="lbl">อัปเดตสถานะล่าสุด</div><div class="val">${fmtDate(r.status_ts || r.ts)}</div>
      <div class="lbl">PO#/เหตุผล</div><div class="val">${esc(r.po||r.note||'-')}</div>
      <div class="lbl">เหตุผล/ความจำเป็น</div><div class="val">${esc(r.reason||'-')}</div>
    </div>

    <div class="detail-media">
      ${ r.image_url ? `<div><div class="lbl">รูปที่แนบ</div><img src="${esc(r.image_url)}" alt="แนบรูป" /></div>` : '' }
      ${
        files.length
          ? `<div class="detail-files"><div class="lbl">ไฟล์ใบเสนอราคา</div>
               <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                 ${files.map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener">ไฟล์ที่ ${i+1}</a>`).join('')}
               </div>
             </div>`
          : (noFiles ? `<div class="note" style="margin-top:6px">ไม่มีไฟล์แนบ</div>` : '')
      }
    </div>
  `;
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
}
function closeDetail(){ modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
modal?.addEventListener('click',(e)=>{ if(e.target.matches('[data-close], .modal-backdrop')) closeDetail(); });
window.addEventListener('keydown',(e)=>{ if(!modal.classList.contains('hidden') && e.key==='Escape') closeDetail(); });

/* ---------- Edit Modal (สร้างแบบไดนามิก) ---------- */
let editModalEl = null;
function ensureEditModal(){
  if (editModalEl) return editModalEl;
  const el = document.createElement('div');
  el.id = 'edit_modal';
  el.className = 'modal hidden';
  el.setAttribute('role','dialog');
  el.setAttribute('aria-modal','true');
  el.setAttribute('aria-hidden','true');
  el.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card">
      <div class="modal-head">
        <h3 id="edit_title">แก้ไขรายการสั่งซื้อ</h3>
        <button class="modal-close" aria-label="Close" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <div class="grid cols-2" id="edit_form">
          <div><label>Part Name</label><input id="ed_part"/></div>
          <div><label>Part No.</label><input id="ed_pn"/></div>
          <div><label>จำนวน</label><input id="ed_qty" type="number" min="1" step="1"/></div>
          <div><label>หน่วย</label><input id="ed_unit" data-combo="units" placeholder="เช่น pcs, set, meter"/></div>
          <div><label>เครื่อง/ไลน์</label><input id="ed_machine" data-combo="machines"/></div>
          <div><label>Priority</label>
            <select id="ed_priority">
              <option value="Urgent">🔴Urgent — ด่วน/กระทบการผลิต</option>
              <option value="High">🟡High — ใช้ใน PM รอบใกล้</option>
              <option value="Normal">🟢Normal — สำรองทั่วไป</option>
            </select>
          </div>
          <div class="full"><label>เหตุผล/ความจำเป็น</label><textarea id="ed_reason" rows="3"></textarea></div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn outline" data-close>ยกเลิก</button>
        <button class="btn" id="ed_save">บันทึกการแก้ไข</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.addEventListener('click',(e)=>{ if(e.target.matches('[data-close], .modal-backdrop')) closeEditModal(); });
  window.addEventListener('keydown',(e)=>{ if(!el.classList.contains('hidden') && e.key==='Escape') closeEditModal(); });

  editModalEl = el;
  return el;
}
function openEditModal(row){
  const el = ensureEditModal();
  $('#edit_title', el).textContent = `แก้ไขรายการ: ${row.part || row.pn || row.id}`;

  $('#ed_part', el).value     = row.part || '';
  $('#ed_pn', el).value       = row.pn || '';
  $('#ed_qty', el).value      = row.qty ?? 1;
  $('#ed_unit', el).value     = row.unit || '';
  $('#ed_machine', el).value  = row.machine || '';
  $('#ed_priority', el).value = row.priority || 'Normal';
  $('#ed_reason', el).value   = row.reason || '';

  initComboboxes(); // ให้ unit/machine มี combobox

  const btn = $('#ed_save', el);
  btn.onclick = async ()=>{
    const part     = $('#ed_part', el).value.trim();
    const pn       = $('#ed_pn', el).value.trim();
    const qty      = parseInt($('#ed_qty', el).value || '0', 10);
    const unit     = $('#ed_unit', el).value.trim();
    const machine  = $('#ed_machine', el).value.trim();
    const priority = $('#ed_priority', el).value;
    const reason   = $('#ed_reason', el).value.trim();

    if (!part || !qty || qty<=0){ showToast('กรอก Part Name และจำนวนให้ถูกต้อง','warn'); return; }
    if (!unit){ showToast('กรุณาระบุหน่วย (Unit)','warn'); return; }

    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    try{
      await apiUpdate({ id: row.id, part, pn, qty, unit, machine, priority, reason });
      showToast('อัปเดตรายการเรียบร้อย','success');
      closeEditModal();
      await reloadTable();
    }catch(e){
      showToast('บันทึกไม่สำเร็จ: '+(e.message||e), 'error');
    }finally{
      btn.disabled = false; btn.textContent = 'บันทึกการแก้ไข';
    }
  };

  el.classList.remove('hidden');
  el.setAttribute('aria-hidden','false');
}
function closeEditModal(){
  if(!editModalEl) return;
  editModalEl.classList.add('hidden');
  editModalEl.setAttribute('aria-hidden','true');
}

/* ===== Global: ปิด tooltip ดำทุกชนิดบนทั้งหน้า ===== */
(function nukeAllTooltips() {
  const STRIP_ATTRS = ['title', 'data-title', 'data-tooltip', 'data-original-title'];
  const strip = (root = document) => {
    root.querySelectorAll(STRIP_ATTRS.map(a => `[${a}]`).join(',')).forEach(el => {
      STRIP_ATTRS.forEach(a => el.removeAttribute(a));
    });
  };
  strip();
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'attributes' && STRIP_ATTRS.includes(m.attributeName)) {
        m.target.removeAttribute(m.attributeName);
      }
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1) {
          STRIP_ATTRS.forEach(a => n.removeAttribute?.(a));
          if (n.querySelectorAll) strip(n);
        }
      });
    }
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: STRIP_ATTRS
  });
  const killOn = e => {
    const el = e.target?.closest?.(STRIP_ATTRS.map(a => `[${a}]`).join(','));
    if (el) STRIP_ATTRS.forEach(a => el.removeAttribute(a));
  };
  document.addEventListener('mouseover', killOn, true);
  document.addEventListener('focusin',  killOn, true);
  const hardenInputs = () => {
    document.querySelectorAll('input, textarea, select').forEach(inp => {
      inp.setAttribute('autocomplete','off');
      inp.setAttribute('autocapitalize','off');
      inp.setAttribute('spellcheck','false');
      STRIP_ATTRS.forEach(a => inp.removeAttribute(a));
    });
  };
  hardenInputs();
  document.addEventListener('DOMNodeInserted', e => {
    if (e.target?.classList?.contains('combo-item')) {
      STRIP_ATTRS.forEach(a => e.target.removeAttribute(a));
      e.target.setAttribute('aria-label','');
    }
  }, true);
})();

/* ===== Enhance native <select> to pretty dropdown (priority only) ===== */
function enhancePrettySelect(selector){
  const sel = document.querySelector(selector);
  if(!sel) return;

  const wrap = document.createElement('div');
  wrap.className = 'ps';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ps-trigger';
  btn.setAttribute('aria-haspopup','listbox');
  btn.setAttribute('aria-expanded','false');
  btn.textContent = sel.options[sel.selectedIndex]?.text || 'เลือก';
  wrap.appendChild(btn);

  const list = document.createElement('div');
  list.className = 'ps-list hidden';
  list.setAttribute('role','listbox');
  wrap.appendChild(list);

  function render(){
    list.innerHTML = '';
    [...sel.options].forEach((op, i)=>{
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'ps-item' + (i===sel.selectedIndex?' active':'');
      it.setAttribute('role','option');
      it.dataset.value = op.value;
      it.textContent = op.textContent;
      it.addEventListener('click', ()=>{
        sel.value = op.value;
        sel.dispatchEvent(new Event('change', {bubbles:true}));
        btn.textContent = op.textContent;
        close();
      });
      list.appendChild(it);
    });
  }
  render();

  const open  = ()=>{ wrap.classList.add('open'); list.classList.remove('hidden'); btn.setAttribute('aria-expanded','true'); };
  const close = ()=>{ wrap.classList.remove('open'); list.classList.add('hidden'); btn.setAttribute('aria-expanded','false'); };
  const toggle= ()=> list.classList.contains('hidden') ? open() : close();

  btn.addEventListener('click', toggle);
  document.addEventListener('click', (e)=>{ if(!wrap.contains(e.target)) close(); }, true);

  btn.addEventListener('keydown', (e)=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); open(); list.querySelector('.ps-item')?.focus(); }
  });
  list.addEventListener('keydown', (e)=>{
    const items = [...list.querySelectorAll('.ps-item')];
    const idx = items.indexOf(document.activeElement);
    if(e.key==='Escape'){ e.preventDefault(); close(); btn.focus(); }
    if(e.key==='ArrowDown'){ e.preventDefault(); (items[idx+1]||items[0]).focus(); }
    if(e.key==='ArrowUp'){ e.preventDefault(); (items[idx-1]||items[items.length-1]).focus(); }
    if(e.key==='Enter' || e.key===' '){ e.preventDefault(); document.activeElement?.click(); }
  });

  sel.addEventListener('change', ()=>{ btn.textContent = sel.options[sel.selectedIndex]?.text || 'เลือก'; render(); });
}
enhancePrettySelect('#rq_priority');

/* ===== Pretty file upload ===== */
function prettyUpload(input, opts={}){
  if(!input) return;
  const isCompact = !!opts.compact;

  const wrap = document.createElement('label');
  wrap.className = 'uploader' + (isCompact ? ' compact' : '');
  wrap.setAttribute('role','button');
  wrap.setAttribute('aria-label', opts.aria || 'อัปโหลดไฟล์');

  const ink  = document.createElement('div'); ink.className = 'upl-ink';  ink.textContent = '↥';
  const meta = document.createElement('div'); meta.className='upl-meta';
  const ttl  = document.createElement('div'); ttl.className = 'ttl';
  const sub  = document.createElement('div'); sub.className = 'sub';
  const btn  = document.createElement('button'); btn.type='button'; btn.className='upl-btn small'; btn.textContent='เลือกไฟล์';

  ttl.textContent = opts.title || input.getAttribute('aria-label') || 'แนบไฟล์';
  sub.textContent = opts.hint  || (input.multiple ? 'ลากวางไฟล์ได้ · เลือกได้หลายไฟล์' : 'ลากวางหรือคลิกเพื่อเลือก');

  meta.append(ttl, sub);
  wrap.append(ink, meta, btn);

  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  btn.addEventListener('click', ()=> input.click());

  const filesBox = document.createElement('div'); filesBox.className='upl-files';
  wrap.appendChild(filesBox);

  function renderFiles(list){
    filesBox.innerHTML='';
    if(!list || list.length===0){ sub.textContent = opts.hint || (input.multiple ? 'ลากวางไฟล์ได้ · เลือกได้หลายไฟล์' : 'ลากวางหรือคลิกเพื่อเลือก'); return; }
    if(list.length===1){
      sub.textContent = list[0].name + (list[0].size ? ` • ${(list[0].size/1024/1024).toFixed(2)}MB` : '');
    }else{
      sub.textContent = `${list.length} ไฟล์ที่เลือก`;
      [...list].slice(0,6).forEach(f=>{
        const pill = document.createElement('div');
        pill.className='upl-pill'; pill.textContent = f.name;
        filesBox.appendChild(pill);
      });
      if(list.length>6){
        const more = document.createElement('div');
        more.className='upl-pill'; more.textContent = `+${list.length-6} ไฟล์`;
        filesBox.appendChild(more);
      }
    }
  }
  input.addEventListener('change', ()=> renderFiles(input.files));

  ;['dragenter','dragover'].forEach(ev=>{
    wrap.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); wrap.classList.add('is-dragover'); });
  });
  ;['dragleave','drop'].forEach(ev=>{
    wrap.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); wrap.classList.remove('is-dragover'); });
  });
  wrap.addEventListener('drop', e=>{
    const dt = e.dataTransfer;
    if(!dt || !dt.files?.length) return;
    if(!input.multiple && dt.files.length>1){
      const d = new DataTransfer(); d.items.add(dt.files[0]); input.files = d.files;
    }else{
      input.files = dt.files;
    }
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
}

// ปรับ hint ให้ตรงกับ accept=image/*
prettyUpload(document.getElementById('rq_image'),  {
  title:'เลือกรูปภาพ',
  hint:'รองรับ JPG/PNG/WebP (ลากวางหรือคลิกเลือก)',
  compact:true, aria:'อัปโหลดรูป'
});
prettyUpload(document.getElementById('rq_quotes'), {
  title:'แนบใบเสนอราคา (PDF)', hint:'ลากวางหรือคลิกเลือก · ได้สูงสุด 3 ไฟล์', aria:'อัปโหลดใบเสนอราคา'
});

/* ---------- Export CSV (UTF-8 BOM) ---------- */
function downloadCSV(filename, csvText){
  const blob = new Blob(["\uFEFF" + csvText], { type: "text/csv;charset=utf-8;" });
  if (window.navigator && typeof window.navigator.msSaveOrOpenBlob === "function") {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.setAttribute("download", filename);
  const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
  if (isIOS) a.setAttribute("target", "_blank");
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

document.getElementById('btn_export')?.addEventListener('click', async ()=>{
  try{
    if (!Array.isArray(state.reportRows) || state.reportRows.length === 0) {
      await loadReport();
    }
    const rows = state.reportRows || [];
    const header = ["Date","Requester","Priority","Part","PN","Qty","Unit","Status","PO","Machine"];
    const lines  = [header.join(",")];

    rows.forEach(r=>{
      const line = [
        fmtDateISO(r.ts),
        r.requester || "",
        r.priority || "",
        r.part || "",
        r.pn || "",
        r.qty ?? "",
        r.unit || "",
        r.status || "",
        r.po || "",
        r.machine || ""
      ].map(csvSafe).join(",");
      lines.push(line);
    });

    const csv = lines.join("\n");
    downloadCSV("purchase_report_month.csv", csv);
    showToast("กำลังส่งออกไฟล์ CSV…","info");
  }catch(e){
    showToast("ส่งออกไม่สำเร็จ: " + (e.message||e), "error");
  }
});

/* === ทำหัวคอลัมน์แอ็กชันเป็น sticky เฉพาะจอกว้าง === */
(function markStickyHeader(){
  const apply = () => {
    const th = document.querySelector('#dashboard thead th:last-child');
    if (!th) return;
    if (window.matchMedia('(min-width: 881px)').matches) {
      th.classList.add('sticky-actions');
    } else {
      th.classList.remove('sticky-actions');
    }
  };
  apply();
  window.addEventListener('resize', apply);
})();


/* === ปุ่มคอมแพ็ค: “ดูรูป” แทน “แก้ไข” (ยังคงไว้) === */
function attachQuickViewHandlers(){
  document.querySelectorAll('#tb_rows tr').forEach(tr=>{
    const saveBtn = tr.querySelector('.act-save');
    if(!saveBtn) return;

    const id = saveBtn.dataset.id;
    const actions = tr.querySelector('.actions');
    if(!actions) return;

    if(actions.querySelector('.act-quick')) return;

    const quickBtn = document.createElement('button');
    quickBtn.className = 'btn small outline act-quick';
    quickBtn.textContent = 'ดูรูป';
    quickBtn.addEventListener('click', ()=>{
      const row = state.rows.find(x=>x.id===id);
      if(row?.image_url){
        window.open(row.image_url, '_blank', 'noopener');
      }else{
        showToast('รายการนี้ไม่มีรูปแนบ','info');
      }
    });

    actions.prepend(quickBtn);
  });
}

/* เรียกหลังวาดตารางทุกครั้ง */
const _origReload = reloadTable;
reloadTable = async function(){
  await _origReload();
  attachQuickViewHandlers();
};
