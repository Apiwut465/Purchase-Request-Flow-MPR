const SUPABASE_URL = "https://mleffbtdolgxzybqbszm.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sZWZmYnRkb2xneHp5YnFic3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MDkzMzEsImV4cCI6MjA3NTQ4NTMzMX0.MRip0lGdmugYpfFvaLddwdxLNm4s5rTAdemd0QS_B3Y";

const TABLE = "purchase_requests";
const BUCKET_IMG = "pr-images";
const BUCKET_PDF = "pr-quotes";
const LIST_KEY = "pr_custom_lists";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/* --- UTILS --- */
const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => Array.from(p.querySelectorAll(s));
const esc = (t) => String(t??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmtDate = (d) => new Date(d).toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'2-digit' });

function showToast(msg, type='info') {
  const c = $('.toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icon = type==='success' ? '<i class="ph-fill ph-check-circle"></i>' : type==='error' ? '<i class="ph-fill ph-warning-octagon"></i>' : '<i class="ph-fill ph-info"></i>';
  t.innerHTML = `${icon} <span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(()=> { t.style.opacity='0'; setTimeout(()=>t.remove(), 300); }, 3000);
}

/* --- STATE --- */
let state = { rows: [], lists: loadLists() };

/* --- AUTH --- */
async function initAuth() {
  const { data } = await supabase.auth.getSession();
  if(!data.session) await supabase.auth.signInAnonymously();
}
initAuth();

/* --- 1. SUBMIT --- */
$('#btn_submit')?.addEventListener('click', async () => {
  const req = {
    requester: $('#rq_name').value.trim(),
    dept: $('#rq_dept').value.trim(),
    part: $('#rq_part').value.trim(),
    pn: $('#rq_pn').value.trim(),
    qty: parseInt($('#rq_qty').value||'0'),
    unit: $('#rq_unit').value.trim(),
    machine: $('#rq_machine').value.trim(),
    priority: $('#rq_priority').value,
    reason: $('#rq_reason').value.trim()
  };

  if(!req.requester || !req.part || req.qty <= 0 || !req.dept || !req.unit) {
    return showToast('กรุณากรอกข้อมูลสำคัญให้ครบถ้วน', 'error');
  }

  const btn = $('#btn_submit');
  btn.disabled = true; btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> กำลังส่ง...';

  try {
    const id = uid();
    // Image
    const imgFile = $('#rq_image').files[0];
    let imageUrl = null;
    if(imgFile) {
      const path = `${id}/image_${Date.now()}.${imgFile.name.split('.').pop()}`;
      const { error } = await supabase.storage.from(BUCKET_IMG).upload(path, imgFile);
      if(!error) imageUrl = supabase.storage.from(BUCKET_IMG).getPublicUrl(path).data.publicUrl;
    }
    // PDF
    const pdfFiles = $('#rq_quotes').files;
    let pdfUrls = [];
    if(pdfFiles.length) {
      for(let i=0; i<pdfFiles.length; i++){
        const path = `${id}/quote_${i+1}_${Date.now()}.pdf`;
        const { error } = await supabase.storage.from(BUCKET_PDF).upload(path, pdfFiles[i]);
        if(!error) pdfUrls.push(supabase.storage.from(BUCKET_PDF).getPublicUrl(path).data.publicUrl);
      }
    }

    const payload = { ...req, id, ts: new Date().toISOString(), status: 'Requested', status_ts: new Date().toISOString(), image_url: imageUrl, quote_files: pdfUrls };
    const { error } = await supabase.from(TABLE).insert([payload]);
    if(error) throw error;

    showToast('ส่งคำขอสำเร็จ!', 'success');
    $('#btn_clear').click();
    saveCustomList(req.dept, req.unit, req.machine);
    loadData(); 
  } catch(e) {
    showToast('เกิดข้อผิดพลาด: '+e.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="ph-bold ph-paper-plane-right"></i> ส่งคำขอ';
  }
});

$('#btn_clear')?.addEventListener('click', () => {
  $$('#request input, #request textarea').forEach(el => el.value = '');
  $('#rq_priority').value = 'Normal';
});

/* --- 2. DASHBOARD --- */
async function loadData() {
  const tbody = $('#tb_rows');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:60px; color:#a78bfa"><i class="ph-duotone ph-spinner ph-spin" style="font-size:32px"></i><div style="margin-top:10px; font-weight:500;">กำลังโหลดข้อมูล...</div></td></tr>';
  
  try {
    const { data, error } = await supabase.from(TABLE).select('*').order('ts', { ascending: false });
    if(error) throw error;
    state.rows = data || [];
    renderTable();
    renderReport();
  } catch(e) {
    showToast('โหลดข้อมูลไม่สำเร็จ', 'error');
  }
}

function renderTable() {
  const q = ($('#f_search').value||'').toLowerCase();
  const pri = $('#f_priority').value;
  const stat = $('#f_status').value;

  const filtered = state.rows.filter(r => {
    const textMatch = [r.part, r.pn, r.requester, r.po].some(v => String(v||'').toLowerCase().includes(q));
    return textMatch && (!pri || r.priority===pri) && (!stat || r.status===stat);
  });

  $('#dash_count').textContent = `${filtered.length}`;
  $('#empty_state').classList.toggle('hidden', filtered.length > 0);
  
  const tbody = $('#tb_rows');
  tbody.innerHTML = '';

  filtered.forEach(r => {
    const pCls = r.priority;
    const sCls = r.status.replace(' ', '_');
    const isReq = r.status === 'Requested';
    const isApp = r.status === 'Approved';
    const isPO = r.status === 'PO Issued';

    let actionsHtml = '';
    if(isReq) {
        actionsHtml = `
            <button class="btn-action approve act-update" data-id="${r.id}" data-status="Approved" title="อนุมัติ"><i class="ph-bold ph-check"></i> อนุมัติ</button>
            <button class="btn-action reject act-update" data-id="${r.id}" data-status="Rejected" title="ไม่อนุมัติ"><i class="ph-bold ph-x"></i> Reject</button>
        `;
    } else if(isApp) {
        actionsHtml = `
            <button class="btn-action po act-update-po" data-id="${r.id}" title="เปิด PO"><i class="ph-bold ph-file-text"></i> เปิด PO</button>
        `;
    } else if(isPO) {
        actionsHtml = `
             <button class="btn-action receive act-update" data-id="${r.id}" data-status="Received" title="รับของแล้ว"><i class="ph-bold ph-package"></i> รับของ</button>
        `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="pill ${pCls}">${r.priority}</span></td>
      <td>
        <div class="part-title">${esc(r.part)}</div>
        <div class="note"><span>PN: ${esc(r.pn||'-')}</span> ${r.machine ? `• <span style="color:#6366f1">${esc(r.machine)}</span>` : ''}</div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:8px; font-weight:500;"><i class="ph-duotone ph-user-circle" style="font-size:18px; color:#818cf8;"></i> ${esc(r.requester)}</div>
        <div class="note" style="margin-left:26px;">${esc(r.dept)} • ${fmtDate(r.ts)}</div>
      </td>
      <td>
        <span class="status-badge ${sCls}">${esc(r.status)}</span>
        <div class="note" style="margin-top:4px;">${fmtDate(r.status_ts)}</div>
      </td>
      <td class="text-right">
        <div class="action-group">
          <button class="act-btn view act-view" data-id="${r.id}" title="ดูรายละเอียด"><i class="ph-bold ph-eye"></i></button>
          ${isReq ? `<button class="act-btn edit act-edit" data-id="${r.id}" title="แก้ไข"><i class="ph-bold ph-pencil-simple"></i></button>` : ''}
          <button class="act-btn delete act-del" data-id="${r.id}" title="ลบรายการ"><i class="ph-bold ph-trash"></i></button>
          ${actionsHtml ? `<div style="width:1px; height:24px; background:#e5e7eb; margin:0 8px;"></div>` : ''}
          ${actionsHtml}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  bindTableEvents();
}

function bindTableEvents() {
  $$('.act-view').forEach(b => b.onclick = () => openDetail(b.dataset.id));
  $$('.act-edit').forEach(b => b.onclick = () => openEdit(b.dataset.id));
  
  $$('.act-del').forEach(b => b.onclick = async () => {
      const id = b.dataset.id;
      if(!confirm('⚠️ ยืนยันการลบรายการนี้? (ไม่สามารถกู้คืนได้)')) return;
      try {
          const { error } = await supabase.from(TABLE).delete().eq('id', id);
          if(error) throw error;
          showToast('ลบรายการเรียบร้อย', 'success');
          loadData();
      } catch(e) { showToast('ลบไม่สำเร็จ: ' + e.message, 'error'); }
  });

  $$('.act-update').forEach(b => b.onclick = async (e) => {
      const id = b.dataset.id;
      const newStat = b.dataset.status;
      let noteVal = '';
      if(newStat === 'Rejected'){
          noteVal = prompt('กรุณาระบุเหตุผลที่ไม่อนุมัติ (Reject Reason):');
          if(noteVal === null) return;
          if(noteVal.trim() === '') return showToast('กรุณาระบุเหตุผล', 'error');
      } else if(!confirm(`ยืนยันเปลี่ยนสถานะเป็น "${newStat}" ?`)) { return; }
      await updateStatus(id, newStat, noteVal);
  });

  $$('.act-update-po').forEach(b => b.onclick = async (e) => {
      const id = b.dataset.id;
      const poVal = prompt('กรุณาระบุเลข PO (PO Number):');
      if(poVal === null) return;
      if(poVal.trim() === '') return showToast('กรุณาระบุเลข PO', 'error');
      await updateStatus(id, 'PO Issued', null, poVal);
  });
}

async function updateStatus(id, newStat, note=null, po=null) {
    try {
      const payload = { status: newStat, status_ts: new Date().toISOString() };
      if(po) payload.po = po;
      if(note) payload.note = note;
      await supabase.from(TABLE).update(payload).eq('id', id);
      showToast(`เปลี่ยนสถานะเป็น ${newStat} เรียบร้อย`, 'success');
      loadData();
    } catch(err) { showToast('อัปเดตสถานะไม่สำเร็จ: ' + err.message, 'error'); }
}

/* --- 3. REPORT LOGIC --- */
function initReportControls() {
    const picker = $('#r_month_picker');
    const mode = $('#r_mode');
    
    const now = new Date();
    if(picker) picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if(mode) {
        mode.addEventListener('change', () => {
            const isAll = mode.value === 'all';
            if($('#month_picker_wrapper')) {
                $('#month_picker_wrapper').style.display = isAll ? 'none' : 'flex';
            }
            renderReport();
        });
    }
    
    if(picker) picker.addEventListener('change', renderReport);
}

function renderReport() {
  const mode = $('#r_mode') ? $('#r_mode').value : 'month';
  const pickerVal = $('#r_month_picker') ? $('#r_month_picker').value : '';
  
  let rData = state.rows.filter(r => {
    if (mode === 'all') return true;
    const d = new Date(r.ts);
    const rYM = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return rYM === pickerVal;
  });

  $('#k_total').textContent = rData.length;
  $('#k_requested').textContent = rData.filter(r=>r.status==='Requested').length;
  $('#k_appr').textContent = rData.filter(r=>r.status==='Approved').length;
  $('#k_po').textContent = rData.filter(r=>r.status==='PO Issued').length;
  $('#k_recv').textContent = rData.filter(r=>r.status==='Received').length;
  $('#k_rej').textContent = rData.filter(r=>r.status==='Rejected').length;

  const tbody = $('#tb_report');
  tbody.innerHTML = '';
  if(rData.length === 0) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#9ca3af;">ไม่พบข้อมูลในช่วงเวลานี้</td></tr>`; return; }

  rData.forEach(r => {
    tbody.innerHTML += `
      <tr>
        <td>${fmtDate(r.ts)}</td>
        <td>${esc(r.requester)}</td>
        <td><span class="pill ${r.priority}">${r.priority}</span></td>
        <td>${esc(r.part)}</td>
        <td>${r.qty}</td>
        <td><span class="status-badge ${r.status.replace(' ','_')}">${r.status}</span></td>
        <td>${esc(r.po||'-')}</td>
      </tr>`;
  });
}

$('#btn_export')?.addEventListener('click', () => {
  const rows = $$('#tb_report tr');
  if(!rows.length || rows[0].innerText.includes('ไม่พบข้อมูล')) return showToast('ไม่มีข้อมูลให้ Export', 'error');
  
  let csv = "Date,Requester,Priority,Part,Qty,Status,PO\n";
  rows.forEach(r => {
    const cols = $$('td', r).map(c => `"${c.innerText}"`);
    csv += cols.join(",") + "\n";
  });
  
  const blob = new Blob(["\uFEFF"+csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const mode = $('#r_mode') ? $('#r_mode').value : 'month';
  const rangeName = mode === 'all' ? 'All_Time' : ($('#r_month_picker')?.value || 'Report');
  
  a.href = url; a.download = `Report_${rangeName}_${Date.now()}.csv`;
  a.click();
});

/* --- SETTINGS & COMBO --- */
function loadLists() {
  const def = { depts:['Maintenance','Production'], units:['pcs','set'], machines:['Machine A'] };
  return JSON.parse(localStorage.getItem(LIST_KEY)) || def;
}
function saveCustomList(d, u, m) {
  let changed = false;
  if(d && !state.lists.depts.includes(d)) { state.lists.depts.push(d); changed=true; }
  if(u && !state.lists.units.includes(u)) { state.lists.units.push(u); changed=true; }
  if(m && !state.lists.machines.includes(m)) { state.lists.machines.push(m); changed=true; }
  if(changed) { localStorage.setItem(LIST_KEY, JSON.stringify(state.lists)); renderSettings(); }
}
function renderSettings() {
  const renderGroup = (id, key) => {
    $(id).innerHTML = state.lists[key].map((v, i) => `<span class="tag">${esc(v)} <button onclick="window.delList('${key}',${i})"><i class="ph-bold ph-x"></i></button></span>`).join('');
  };
  renderGroup('#list_depts', 'depts'); renderGroup('#list_units', 'units'); renderGroup('#list_machines', 'machines');
}
window.delList = (key, idx) => { state.lists[key].splice(idx, 1); localStorage.setItem(LIST_KEY, JSON.stringify(state.lists)); renderSettings(); };
['dept','unit','machine'].forEach(k => {
  $(`#btn_add_${k}`).onclick = () => { const v = $(`#add_${k}`).value.trim(); if(v) { saveCustomList(k==='dept'?v:null, k==='unit'?v:null, k==='machine'?v:null); $(`#add_${k}`).value=''; } }
});
$('#btn_reset_defaults').onclick = () => { if(confirm('รีเซ็ตค่าทั้งหมด?')) { localStorage.removeItem(LIST_KEY); state.lists=loadLists(); renderSettings(); } };

function attachCombo() {
  $$('input[data-combo]').forEach(inp => {
    const type = inp.dataset.combo;
    const wrap = document.createElement('div'); wrap.className='combo-wrap';
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    const list = document.createElement('div'); list.className='combo-list hidden';
    wrap.appendChild(list);
    inp.onfocus = inp.oninput = () => {
      const v = inp.value.toLowerCase();
      const items = state.lists[type].filter(x => x.toLowerCase().includes(v));
      list.innerHTML = items.map(x => `<div class="combo-item">${x}</div>`).join('') || '<div style="padding:10px;color:#999;font-size:12px;">กด Enter เพื่อเพิ่มใหม่</div>';
      list.classList.remove('hidden');
    };
    list.onclick = (e) => { if(e.target.classList.contains('combo-item')) { inp.value = e.target.innerText; list.classList.add('hidden'); } };
    document.addEventListener('click', (e) => { if(!wrap.contains(e.target)) list.classList.add('hidden'); });
  });
}

/* --- INIT --- */
$$('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.add('hidden'));
$$('.nav-item').forEach(t => t.onclick = () => {
  $$('.nav-item').forEach(x => x.classList.remove('active')); t.classList.add('active');
  $$('main > section').forEach(s => s.classList.add('hidden'));
  $(`#${t.dataset.tab}`).classList.remove('hidden');
  if(t.dataset.tab === 'dashboard') loadData();
});
$$('#f_search, #f_priority, #f_status').forEach(el => el.addEventListener('input', renderTable));

function openDetail(id) {
  const r = state.rows.find(x => x.id === id); if(!r) return;
  const files = r.quote_files || [];
  $('#detail_body').innerHTML = `
    <div style="display:grid; grid-template-columns: 110px 1fr; gap:16px; margin-bottom:20px;">
      <div class="note">Part Name</div> <div style="font-weight:600; font-size:16px;">${esc(r.part)}</div>
      <div class="note">Part No.</div> <div>${esc(r.pn||'-')}</div>
      <div class="note">จำนวน/หน่วย</div> <div><span style="background:#f3f4f6; padding:2px 8px; border-radius:6px;">${esc(r.qty)} ${esc(r.unit)}</span></div>
      <div class="note">ผู้ขอ/แผนก</div> <div>${esc(r.requester)} (${esc(r.dept)})</div>
      <div class="note">เครื่องจักร</div> <div>${esc(r.machine||'-')}</div>
      <div class="note">ระดับความด่วน</div> <div><span class="pill ${r.priority}">${esc(r.priority)}</span></div>
      <div class="note">เหตุผล</div> <div style="color:#4b5563;">${esc(r.reason||'-')}</div>
      <div class="note">สถานะปัจจุบัน</div> <div><span class="status-badge ${r.status.replace(' ','_')}">${esc(r.status)}</span></div>
      ${r.po ? `<div class="note">เลข PO</div> <div style="color:#0ea5e9; font-weight:600;">${esc(r.po)}</div>` : ''}
      ${r.note ? `<div class="note">หมายเหตุ</div> <div style="color:#ef4444;">${esc(r.note)}</div>` : ''}
    </div>
    <div style="display:flex; gap:16px; flex-wrap:wrap;">
      ${r.image_url ? `<div><p class="note">รูปอ้างอิง:</p><a href="${r.image_url}" target="_blank"><img src="${r.image_url}" style="height:120px; border-radius:12px; border:2px solid #e5e7eb;"></a></div>` : ''}
      ${files.length ? `<div><p class="note">เอกสารแนบ:</p><div style="display:flex; gap:8px;">${files.map((f,i)=>`<a href="${f}" target="_blank" class="btn small outline"><i class="ph-bold ph-file-pdf"></i> ไฟล์ ${i+1}</a>`).join('')}</div></div>` : ''}
    </div>
  `;
  $('#detail_modal').classList.remove('hidden');
}

let editingId = null;
function openEdit(id) {
  const r = state.rows.find(x => x.id === id); if(!r) return;
  editingId = id; $('#ed_part').value = r.part; $('#ed_pn').value = r.pn; $('#ed_qty').value = r.qty; $('#ed_unit').value = r.unit; $('#ed_reason').value = r.reason;
  $('#edit_modal').classList.remove('hidden');
}
$('#ed_save')?.addEventListener('click', async () => {
  if(!editingId) return;
  const payload = { part: $('#ed_part').value, pn: $('#ed_pn').value, qty: $('#ed_qty').value, unit: $('#ed_unit').value, reason: $('#ed_reason').value };
  try { await supabase.from(TABLE).update(payload).eq('id', editingId); showToast('บันทึกการแก้ไขแล้ว', 'success'); $('#edit_modal').classList.add('hidden'); loadData(); } catch(e) { showToast('แก้ไขไม่สำเร็จ', 'error'); }
});

renderSettings();
attachCombo();
loadData();
initReportControls();
