/* =========================================================
   萬友展場訂購單 — 主程式
   ---------------------------------------------------------
   分成幾個區塊：
   1. 小工具（存取資料、金額格式…）
   2. 訂單資料（state）
   3. 計算：拆袋、運費、贈品、總金額
   4. 畫面一：填寫表單
   5. 畫面二：訂購明細
   6. 產生圖片／PDF、分享、上傳
   7. 啟動
   ========================================================= */

/* ---------------------------------------------------------
   1. 小工具
   --------------------------------------------------------- */

// 抓網頁元素的簡寫：$('#id')
const $ = (sel) => document.querySelector(sel);

// 金額加上千分位逗號：13500 → 13,500
const money = (n) => Math.round(n || 0).toLocaleString('en-US');

// 把使用者輸入的文字變安全（避免有人打 <script> 之類的東西破壞畫面）
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// 產生不重複的小編號，用來辨認每一行商品
const uid = () => Math.random().toString(36).slice(2, 9);

// 讀寫瀏覽器的本機儲存空間（localStorage）
// 用 try/catch 包起來：無痕模式等情況會讀不到，至少網頁不會壞掉
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 存不了就算了 */ }
  },
};

// 本機儲存用的名稱（像資料夾名稱，不同系統不會互相干擾）
const KEY = {
  draft: 'wyx_draft',      // 正在填寫中的訂單（重新整理不會不見）
  device: 'wyx_device',    // 這台裝置的代號 A、B、C…
  orders: 'wyx_orders',    // 已完成的訂單紀錄
  seq: (d) => 'wyx_seq_' + d, // 每天的流水號
};

// 今天的日期 2026-10-01
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 畫面下方跳出的小提示
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// 訂單日期預設：展期當天就選今天，否則選展期第一天
const defaultDate = () => (EXPO_DATES.includes(todayStr()) ? todayStr() : EXPO_DATES[0]);

// 日期按鈕的文字：2026-11-13 → 11/13（五）
function dateLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wk = '日一二三四五六'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${wk}）`;
}

// 用編號找商品
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);

/* ---------------------------------------------------------
   2. 訂單資料（state）
   ---------------------------------------------------------
   比喻：state 就像一張「隱形的訂購單」，畫面上看到的
   都是照著這張單畫出來的。改了單，畫面就跟著重畫。
   --------------------------------------------------------- */

function newItem() {
  // pid=選哪支豆子、kg=公斤數、bagPrice/unitPrice=手動改過的單價（null=用預設）
  return { uid: uid(), pid: '', kg: 5, bagPrice: null, unitPrice: null };
}
function newExtra() {
  return { uid: uid(), name: '', kg: '', price: '' };
}
function blankState() {
  return {
    orderNo: '',          // 訂單編號（進到第二頁才產生）
    finished: false,      // 是否已按過「完成訂單」
    customer: {
      date: defaultDate(), name: '', phone: '', tax: '',
      address: '', payment: '', payOther: '', staff: '', staffOther: '', note: '',
    },
    items: [newItem()],
    extras: [],
    extraNote: '',
    shipManual: null,     // null=自動判斷；true/false=工作人員手動指定
    island: false,        // 離島配送（運費另外報價）
    islandFee: '',        // 離島運費報價（空白＝另行報價）
    giftManual: null,     // null=自動；陣列=手動勾選的檔次
  };
}

let state = store.get(KEY.draft, null) || blankState();
// 經手人員通常整天都是同一個人，記住上次填的名字
const save = () => store.set(KEY.draft, state);

/* ---------------------------------------------------------
   3. 計算
   --------------------------------------------------------- */

/**
 * 把一行商品拆成「整袋」和「散裝 5KG」兩種明細
 * 例：ET051 40KG → [30KG/袋 ×1 @450] + [5KG/包 ×2 @460]
 */
function splitItem(item) {
  const p = findProduct(item.pid);
  if (!p) return [];
  const kg = item.kg;
  const lines = [];

  // 有整袋價（數字）或業務報價（'quote'）才拆整袋
  const hasBag = p.pBag !== null;
  const bags = hasBag ? Math.floor(kg / p.bagKg) : 0;
  const rest = kg - bags * p.bagKg;

  if (bags > 0) {
    const auto = typeof p.pBag === 'number' ? p.pBag : null;
    const price = item.bagPrice ?? auto; // 手動改過就用手動的
    lines.push({
      kind: 'bag',
      spec: `${p.bagKg}KG/${p.bagUnit} ×${bags}`,
      kg: bags * p.bagKg,
      price,
      missing: price === null || price === '' || Number(price) <= 0, // 業務報價還沒填
      edited: item.bagPrice !== null && item.bagPrice !== auto,
    });
  }
  if (rest > 0) {
    const price = item.unitPrice ?? p.p5;
    lines.push({
      kind: 'unit',
      spec: `5KG/包 ×${rest / 5}`,
      kg: rest,
      price,
      missing: price === null || price === '' || Number(price) <= 0,
      edited: item.unitPrice !== null && item.unitPrice !== p.p5,
    });
  }
  lines.forEach((l) => { l.subtotal = l.missing ? 0 : Number(l.price) * l.kg; });
  return lines;
}

/** 算整張訂單的總重、金額、運費、贈品 */
function calc(s = state) {
  let kg = 0;
  let goods = 0;

  s.items.forEach((it) => {
    splitItem(it).forEach((l) => { kg += l.kg; goods += l.subtotal; });
  });
  s.extras.forEach((x) => {
    const xkg = Number(x.kg) || 0;
    kg += xkg;
    goods += xkg * (Number(x.price) || 0);
  });

  // 運費：自動規則 = 有商品且未滿 20KG
  const shipAuto = kg > 0 && kg < SHIPPING.freeKg;
  const shipOn = s.shipManual === null ? shipAuto : s.shipManual;
  let shipping = shipOn ? SHIPPING.fee : 0;

  // 離島配送：改用填寫的報價金額（沒填＝另行報價，先不算進總額）
  const island = !!s.island;
  const islandQuote = island && !(Number(s.islandFee) > 0);
  if (island) shipping = Number(s.islandFee) > 0 ? Number(s.islandFee) : 0;

  // 滿額贈：只送達到的最高一檔
  let autoTier = -1;
  GIFT_TIERS.forEach((t, i) => { if (goods >= t.min) autoTier = i; });
  const gifts = s.giftManual === null ? (autoTier >= 0 ? [autoTier] : []) : s.giftManual;

  return { kg, goods, shipAuto, shipOn, shipping, island, islandQuote, autoTier, gifts, total: goods + shipping };
}

/* ---------------------------------------------------------
   4. 畫面一：填寫表單
   --------------------------------------------------------- */

// 客戶資料欄位對照：畫面上的 id ↔ state.customer 的名稱
const CUSTOMER_FIELDS = {
  cName: 'name', cPhone: 'phone', cTax: 'tax',
  cAddress: 'address', cNote: 'note', cPayOther: 'payOther', cStaff: 'staff', cStaffOther: 'staffOther',
};

// 經手人員選單最後一項：名單上沒有的人自己輸入
const STAFF_OTHER = '其他（自行輸入）';
const staffText = (c) => (c.staff === STAFF_OTHER ? (c.staffOther || '').trim() : c.staff);

// 付款方式最後一個「其他」：點了會出現輸入框，可以自己寫（內部當匯款用）
const PAY_OTHER = PAYMENT_METHODS[PAYMENT_METHODS.length - 1];

// 訂單上顯示的付款方式：選「其他」且有填內容 → 顯示填的內容
const paymentText = (c) => (c.payment === PAY_OTHER ? (c.payOther || '').trim() || PAY_OTHER : c.payment);

/** 付款方式按鈕的亮暗＋「其他」輸入框的顯示 */
function paintChips() {
  document.querySelectorAll('#cDate .chip').forEach((b) =>
    b.classList.toggle('on', b.dataset.v === state.customer.date));
  document.querySelectorAll('#cPayment .chip').forEach((b) =>
    b.classList.toggle('on', b.dataset.v === state.customer.payment));
  $('#cPayOther').hidden = state.customer.payment !== PAY_OTHER;
  $('#cStaffOther').hidden = state.customer.staff !== STAFF_OTHER;
}

/* ---------- 統一編號檢查（財政部規則） ----------
   8 位數字，各位數依序乘上 1,2,1,2,1,2,4,1，
   每個乘積的「十位數＋個位數」加總後，能被 5 整除就正確。
   特例：第 7 位是 7 時（7×4=28 → 2+8=10），10 可以當 1 或 0 算，兩種有一個整除就對。
   （2023 年起從「被 10 整除」放寬成「被 5 整除」，舊號碼也一定符合） */
function isValidTaxId(id) {
  if (!/^\d{8}$/.test(id)) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const p = Number(id[i]) * w[i];
    sum += Math.floor(p / 10) + (p % 10);
  }
  if (sum % 5 === 0) return true;
  return id[6] === '7' && (sum + 1) % 5 === 0;
}

/** 統編旁邊的 ✓／✗：空白不顯示 */
function paintTax() {
  const v = state.customer.tax || '';
  const mark = $('#taxMark');
  if (!v) { mark.className = 'tax-mark'; mark.textContent = ''; return; }
  const ok = isValidTaxId(v);
  mark.className = 'tax-mark ' + (ok ? 'ok' : 'bad');
  mark.textContent = ok ? '✓' : '✗';
  mark.title = ok ? '統一編號正確' : '統一編號格式不正確';
}

function bindCustomer() {
  // 經手人員下拉選單的選項
  $('#cStaff').innerHTML = '<option value="">— 請選擇 —</option>' +
    [...STAFF, STAFF_OTHER].map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

  Object.entries(CUSTOMER_FIELDS).forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.value = state.customer[key] || '';
    el.addEventListener('input', () => {
      if (key === 'tax') el.value = el.value.replace(/\D/g, '').slice(0, 8); // 統編只留數字
      state.customer[key] = el.value;
      clearErr(el);
      // 經手人員記住，下一張單自動帶入
      if (key === 'staff') {
        store.set('wyx_staff', el.value);
        paintChips();
        if (el.value === STAFF_OTHER) $('#cStaffOther').focus();
      }
      if (key === 'staffOther') store.set('wyx_staff_other', el.value);
      if (key === 'tax') paintTax();
      save();
    });
  });

  // 日期：只能選展期那幾天（一定要選一天，不能取消）
  const dbox = $('#cDate');
  dbox.innerHTML = EXPO_DATES.map((d) =>
    `<button type="button" class="chip" data-v="${d}">${dateLabel(d)}</button>`).join('');
  dbox.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.customer.date = b.dataset.v;
    paintChips(); save();
  });

  // 付款方式：做成一排可以點的小按鈕
  const box = $('#cPayment');
  box.innerHTML = PAYMENT_METHODS.map((m) =>
    `<button type="button" class="chip" data-v="${esc(m)}">${esc(m)}</button>`).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    // 再點一次同一個 = 取消
    state.customer.payment = state.customer.payment === b.dataset.v ? '' : b.dataset.v;
    paintChips(); save();
    if (state.customer.payment === PAY_OTHER) $('#cPayOther').focus();
  });
  paintChips();
  paintTax();
}

// 商品下拉選單的選項（依產區分組）
function productOptions(selected) {
  const groups = [...new Set(PRODUCTS.map((p) => p.group))];
  let html = '<option value="">— 請選擇品項 —</option>';
  groups.forEach((g) => {
    html += `<optgroup label="${esc(g)}">`;
    PRODUCTS.filter((p) => p.group === g).forEach((p) => {
      html += `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${p.id}　${esc(p.name)}</option>`;
    });
    html += '</optgroup>';
  });
  return html;
}

// 一個商品的「價格說明」小字：5KG $460／30KG袋 $450
function priceNote(p) {
  if (!p) return '';
  let s = `5KG 單價 $${money(p.p5)}`;
  if (typeof p.pBag === 'number') s += `｜${p.bagKg}KG/${p.bagUnit} 單價 $${money(p.pBag)}`;
  else if (p.pBag === 'quote') s += `｜${p.bagKg}KG/${p.bagUnit} 業務報價`;
  else s += `｜整${p.bagUnit}無優惠價`;
  return s;
}

/** 重畫全部商品列（新增、刪除、換品項時用） */
function renderItems() {
  const list = $('#itemList');
  list.innerHTML = state.items.map((it, i) => `
    <div class="item" data-uid="${it.uid}">
      <div class="item-head">
        <span class="item-no">${i + 1}</span>
        <select class="item-select" aria-label="品項">${productOptions(it.pid)}</select>
        <div class="stepper" aria-label="公斤數">
          <button type="button" class="step-btn" data-d="-5" aria-label="減 5KG">−</button>
          <input type="number" class="kg-input" inputmode="numeric" min="5" step="5" value="${it.kg}">
          <span class="kg-unit">KG</span>
          <button type="button" class="step-btn" data-d="5" aria-label="加 5KG">＋</button>
        </div>
        <button type="button" class="icon-btn del-item" aria-label="刪除這行">×</button>
      </div>
      <div class="item-note">${esc(priceNote(findProduct(it.pid)))}</div>
      <div class="lines"></div>
    </div>`).join('');
  state.items.forEach((it) => renderLines(it));
  updateTotals();
}

/** 只重畫某一行商品下面的拆袋明細 */
function renderLines(it) {
  const row = document.querySelector(`.item[data-uid="${it.uid}"]`);
  if (!row) return;
  const box = row.querySelector('.lines');
  const lines = splitItem(it);
  if (!lines.length) { box.innerHTML = ''; return; }
  box.innerHTML = lines.map((l) => `
    <div class="line${l.missing ? ' need' : ''}" data-kind="${l.kind}">
      <span class="line-spec">${l.spec}</span>
      <label class="line-price">
        <span>$</span>
        <input type="number" inputmode="numeric" class="price-input${l.edited ? ' edited' : ''}"
          value="${l.price ?? ''}" placeholder="請填單價" aria-label="每公斤單價">
        <span>/kg</span>
      </label>
      <span class="line-sub">$${money(l.subtotal)}</span>
    </div>`).join('');
}

/** 把公斤數修正成 5 的倍數、至少 5 */
function normalizeKg(v) {
  let n = Math.ceil((Number(v) || 0) / 5) * 5;
  if (n < 5) n = 5;
  if (n > 9995) n = 9995;
  return n;
}

function bindItems() {
  const list = $('#itemList');
  const itemOf = (el) => state.items.find((x) => x.uid === el.closest('.item').dataset.uid);

  // 換品項
  list.addEventListener('change', (e) => {
    const it = itemOf(e.target);
    if (e.target.classList.contains('item-select')) {
      it.pid = e.target.value;
      it.bagPrice = null; it.unitPrice = null; // 換豆子 → 單價回到預設
      const row = e.target.closest('.item');
      row.querySelector('.item-note').textContent = priceNote(findProduct(it.pid));
      renderLines(it); updateTotals(); save();
    }
    // 公斤數打完字、離開欄位時修正成 5 的倍數
    if (e.target.classList.contains('kg-input')) {
      it.kg = normalizeKg(e.target.value);
      e.target.value = it.kg;
      renderLines(it); updateTotals(); save();
    }
  });

  // 打字時即時更新（單價、公斤數）
  list.addEventListener('input', (e) => {
    if (e.target.classList.contains('price-input')) {
      clearErr(e.target);
      const it = itemOf(e.target);
      const kind = e.target.closest('.line').dataset.kind;
      const v = e.target.value === '' ? '' : Number(e.target.value);
      if (kind === 'bag') it.bagPrice = v; else it.unitPrice = v;
      // 只更新這一行的小計，不整個重畫（不然游標會跳掉）
      const line = splitItem(it).find((l) => l.kind === kind);
      const lineEl = e.target.closest('.line');
      lineEl.querySelector('.line-sub').textContent = '$' + money(line.subtotal);
      lineEl.classList.toggle('need', line.missing);
      e.target.classList.toggle('edited', line.edited);
      updateTotals(); save();
    }
  });

  // 按鈕：＋／− 公斤、刪除
  list.addEventListener('click', (e) => {
    const step = e.target.closest('.step-btn');
    if (step) {
      const it = itemOf(step);
      it.kg = normalizeKg(it.kg + Number(step.dataset.d));
      step.closest('.stepper').querySelector('.kg-input').value = it.kg;
      renderLines(it); updateTotals(); save();
      return;
    }
    if (e.target.closest('.del-item')) {
      const it = itemOf(e.target);
      if (state.items.length === 1) {
        // 只剩一行就清空，不刪掉
        Object.assign(it, newItem(), { uid: it.uid });
      } else {
        state.items = state.items.filter((x) => x !== it);
      }
      renderItems(); save();
    }
  });

  $('#addItem').addEventListener('click', () => {
    state.items.push(newItem());
    renderItems(); save();
    // 新增後自動捲到新的那一行
    const rows = list.querySelectorAll('.item');
    rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/** 商品備註：訂購單上沒有的商品 */
function renderExtras() {
  $('#extraList').innerHTML = state.extras.map((x) => `
    <div class="extra" data-uid="${x.uid}">
      <input type="text" data-f="name" placeholder="品名" value="${esc(x.name)}" aria-label="品名">
      <label class="extra-num"><input type="number" inputmode="numeric" data-f="kg" placeholder="公斤" value="${esc(x.kg)}" aria-label="公斤數"><span>KG</span></label>
      <label class="extra-num"><span>$</span><input type="number" inputmode="numeric" data-f="price" placeholder="單價" value="${esc(x.price)}" aria-label="每公斤單價"><span>/kg</span></label>
      <span class="line-sub">$${money((Number(x.kg) || 0) * (Number(x.price) || 0))}</span>
      <button type="button" class="icon-btn del-extra" aria-label="刪除">×</button>
    </div>`).join('');
}

function bindExtras() {
  const box = $('#extraList');
  const extraOf = (el) => state.extras.find((x) => x.uid === el.closest('.extra').dataset.uid);
  box.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const x = extraOf(e.target);
    x[f] = e.target.value;
    e.target.classList.remove('invalid');
    e.target.closest('.extra').querySelector('.line-sub').textContent =
      '$' + money((Number(x.kg) || 0) * (Number(x.price) || 0));
    updateTotals(); save();
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('.del-extra')) return;
    const x = extraOf(e.target);
    state.extras = state.extras.filter((y) => y !== x);
    renderExtras(); updateTotals(); save();
  });
  $('#addExtra').addEventListener('click', () => {
    state.extras.push(newExtra());
    renderExtras(); save();
    box.lastElementChild.querySelector('input').focus();
  });
  const note = $('#extraNote');
  note.value = state.extraNote || '';
  note.addEventListener('input', () => { state.extraNote = note.value; save(); });
}

/** 運費、贈品 */
function bindShipGift() {
  $('#shipOn').addEventListener('change', (e) => {
    state.shipManual = e.target.checked;
    updateTotals(); save();
  });
  $('#shipAuto').addEventListener('click', () => {
    state.shipManual = null;
    updateTotals(); save();
  });

  // 離島配送：勾選後出現報價欄
  const isl = $('#islandOn'), fee = $('#islandFee');
  isl.checked = !!state.island;
  fee.value = state.islandFee || '';
  isl.addEventListener('change', () => {
    state.island = isl.checked;
    updateTotals(); save();
    if (isl.checked) fee.focus();
  });
  fee.addEventListener('input', () => {
    state.islandFee = fee.value;
    updateTotals(); save();
  });

  $('#giftList').addEventListener('change', (e) => {
    const r = calc();
    // 第一次手動改：從目前自動勾的狀態開始
    const sel = new Set(r.gifts);
    const i = Number(e.target.value);
    if (e.target.checked) sel.add(i); else sel.delete(i);
    state.giftManual = [...sel].sort((a, b) => a - b);
    updateTotals(); save();
  });
  $('#giftAuto').addEventListener('click', () => {
    state.giftManual = null;
    updateTotals(); save();
  });
}

/** 運費的簡短文字：$120／免運／離島 $300／另行報價 */
function shipText(r) {
  if (r.island) return r.islandQuote ? '另行報價' : `$${money(r.shipping)}`;
  return r.shipping ? `$${money(r.shipping)}` : '免運';
}

/** 更新底部總計、運費、贈品區（任何數字變動都會呼叫） */
function updateTotals() {
  const r = calc();
  $('#sumKg').textContent = `${r.kg} KG`;
  $('#sumShip').textContent = shipText(r);
  $('#sumTotal').textContent = `$${money(r.total)}`;

  // 運費區（勾了離島，一般運費就變灰、不作用）
  $('#shipOn').checked = r.shipOn && !r.island;
  $('#shipOn').disabled = r.island;
  $('#shipRow').classList.toggle('off', r.island);
  $('#islandOn').checked = r.island;
  $('#islandFeeBox').hidden = !r.island;
  const why = r.kg === 0 ? '尚未選商品'
    : r.shipAuto ? `總重 ${r.kg}KG，未滿 ${SHIPPING.freeKg}KG`
      : `總重 ${r.kg}KG，已達免運`;
  $('#shipLabel').innerHTML = `<span class="ship-fee">加收運費 $${SHIPPING.fee}</span>　<small>${why}${state.shipManual === null ? '（自動）' : '（手動）'}</small>`;
  $('#shipAuto').hidden = state.shipManual === null;

  // 贈品區
  $('#giftList').innerHTML = GIFT_TIERS.map((t, i) => `
    <label class="check gift${r.autoTier === i ? ' reached' : ''}">
      <input type="checkbox" value="${i}"${r.gifts.includes(i) ? ' checked' : ''}>
      <span><b class="gift-min">滿 $${money(t.min)}</b>　${esc(t.name)}</span>
    </label>`).join('');
  const next = GIFT_TIERS.find((t) => r.goods < t.min);
  $('#giftHint').textContent = `商品金額 $${money(r.goods)}` +
    (next ? `，再 $${money(next.min - r.goods)} 可得「${next.name}」` : '，已達最高檔') +
    (state.giftManual === null ? '（自動）' : '（手動）');
  $('#giftAuto').hidden = state.giftManual === null;
}

/** 標示漏填：框變紅；有 msg 就在欄位正下方加一行紅字 */
function mark(el, msg) {
  if (!el) return;
  el.classList.add('invalid');
  if (msg && !(el.nextElementSibling && el.nextElementSibling.classList.contains('err-msg'))) {
    el.insertAdjacentHTML('afterend', `<small class="err-msg">${esc(msg)}</small>`);
  }
}
/** 清掉漏填標示（開始打字就清） */
function clearErr(el) {
  el.classList.remove('invalid');
  const next = el.nextElementSibling;
  if (next && next.classList.contains('err-msg')) next.remove();
}

/** 按「下一頁」前的檢查 */
function validate() {
  const errs = [];
  document.querySelectorAll('.invalid').forEach(clearErr);

  // 必填（標 * 的欄位）：框變紅＋欄位下方出現紅字提醒
  if (!state.customer.name.trim()) { errs.push('訂購姓名'); mark($('#cName'), '請填寫訂購姓名'); }
  if (!state.customer.phone.trim()) { errs.push('電話'); mark($('#cPhone'), '請填寫電話'); }
  if (state.customer.staff === STAFF_OTHER && !(state.customer.staffOther || '').trim()) {
    errs.push('經手人員名字'); mark($('#cStaffOther'), '請輸入經手人員名字');
  }
  // 統編選填；有填就要正確（避免發票開錯）
  if (state.customer.tax && !isValidTaxId(state.customer.tax)) {
    errs.push('統一編號不正確'); mark($('#cTax'), '統一編號不正確，請再確認');
  }

  const chosen = state.items.filter((it) => it.pid);
  const extras = state.extras.filter((x) => x.name.trim());
  if (!chosen.length && !extras.length) errs.push('至少選一項商品');

  // 業務報價或被清空的單價
  chosen.forEach((it) => {
    if (splitItem(it).some((l) => l.missing)) {
      errs.push(`${it.pid} 單價未填`);
      document.querySelectorAll(`.item[data-uid="${it.uid}"] .line.need input`).forEach(mark);
    }
  });
  // 其他商品：有品名就要有公斤和單價
  extras.forEach((x) => {
    const row = document.querySelector(`.extra[data-uid="${x.uid}"]`);
    if (!(Number(x.kg) > 0)) { errs.push(`「${x.name}」公斤數`); mark(row.querySelector('[data-f="kg"]')); }
    if (!(Number(x.price) > 0)) { errs.push(`「${x.name}」單價`); mark(row.querySelector('[data-f="price"]')); }
  });

  if (errs.length) {
    toast('請補上：' + errs.join('、'), 4000);
    const first = document.querySelector('.invalid');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

/* ---------------------------------------------------------
   5. 畫面二：訂購明細
   --------------------------------------------------------- */

/** 裝置代號（A、B、C…），用來讓不同平板的訂單編號不撞號 */
function getDevice() {
  let d = store.get(KEY.device, '');
  while (!d) {
    const v = prompt('第一次使用：請設定這台裝置的代號（例如 A、B、C）\n不同裝置請用不同代號，訂單編號才不會重複。', 'A');
    if (v === null) return 'X';
    d = v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
  }
  store.set(KEY.device, d);
  return d;
}

/** 產生訂單編號：1002-A-007（月日-裝置-當天第幾張） */
function makeOrderNo() {
  const d = new Date();
  const md = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const ymd = d.getFullYear() + md;
  const n = store.get(KEY.seq(ymd), 0) + 1;
  store.set(KEY.seq(ymd), n);
  return `${md}-${getDevice()}-${String(n).padStart(3, '0')}`;
}

/**
 * 把 state 整理成一份「定稿」的訂單資料
 * （明細頁、圖片、PDF、本機紀錄都用這份）
 */
function buildOrder() {
  const r = calc();
  const rows = [];
  state.items.filter((it) => it.pid).forEach((it) => {
    const p = findProduct(it.pid);
    splitItem(it).forEach((l, i, arr) => rows.push({
      id: p.id, name: p.name, spec: l.spec, price: Number(l.price), kg: l.kg,
      subtotal: l.subtotal, first: i === 0, span: arr.length,
    }));
  });
  const extras = state.extras.filter((x) => x.name.trim()).map((x) => ({
    name: x.name.trim(), kg: Number(x.kg), price: Number(x.price),
    subtotal: Number(x.kg) * Number(x.price),
  }));
  return {
    no: state.orderNo,
    customer: { ...state.customer },
    rows, extras,
    extraNote: state.extraNote.trim(),
    kg: r.kg, goods: r.goods, shipping: r.shipping, total: r.total,
    island: r.island, islandQuote: r.islandQuote,
    gifts: r.gifts.map((i) => GIFT_TIERS[i].name),
    createdAt: new Date().toISOString(),
  };
}

/** 訂單的 HTML（畫面、圖片、PDF 共用同一份排版） */
function sheetHTML(o) {
  const c = o.customer;
  const info = [
    ['訂購姓名', c.name], ['電話', c.phone],
    ['統一編號', c.tax], ['付款方式', paymentText(c)],
    ['收件地址', c.address, true],
  ];
  const itemRows = o.rows.map((r) => `
    <tr>
      ${r.first ? `<td class="t-id" rowspan="${r.span}">${r.id}</td><td class="t-name" rowspan="${r.span}"><span class="t-id-inline">${r.id}</span>${esc(r.name)}</td>` : ''}
      <td class="t-spec">${r.spec}</td>
      <td class="t-num">${money(r.price)}</td>
      <td class="t-num">${r.kg}</td>
      <td class="t-num">${money(r.subtotal)}</td>
    </tr>`).join('');
  const extraRows = o.extras.map((x) => `
    <tr class="t-extra">
      <td class="t-id">其他</td><td class="t-name"><span class="t-id-inline">其他</span>${esc(x.name)}</td>
      <td class="t-spec">—</td>
      <td class="t-num">${money(x.price)}</td>
      <td class="t-num">${x.kg}</td>
      <td class="t-num">${money(x.subtotal)}</td>
    </tr>`).join('');

  return `
  <div class="sh">
    <div class="sh-head">
      <img src="images/logo-256.png" alt="" class="sh-logo">
      <div class="sh-title">
        <h1>${esc(EXPO.title)}</h1>
        <div class="sh-meta"><span>訂單編號 <b>${esc(o.no)}</b></span><span>日期 ${esc(c.date)}</span></div>
      </div>
    </div>

    <table class="sh-info">
      ${info.map(([k, v, full]) => `<tr${full ? ' class="full"' : ''}><th>${k}</th><td>${esc(v) || '—'}</td></tr>`).join('')}
    </table>

    <table class="sh-items">
      <thead><tr>
        <th>編號</th><th>品名</th><th>規格</th>
        <th class="t-num">單價/kg</th><th class="t-num">數量(KG)</th><th class="t-num">小計</th>
      </tr></thead>
      <tbody>${itemRows}${extraRows}</tbody>
    </table>

    ${o.extraNote ? `<div class="sh-note"><b>商品備註</b>${esc(o.extraNote)}</div>` : ''}

    <div class="sh-sum">
      <div class="sh-sum-left">
        <div class="sh-gift"><b>滿額贈品</b>${o.gifts.length ? o.gifts.map(esc).join('<br>') : '—'}</div>
        ${c.note ? `<div class="sh-gift"><b>備註</b>${esc(c.note)}</div>` : ''}
      </div>
      <table class="sh-total">
        <tr><th>總重</th><td>${o.kg} KG</td></tr>
        <tr><th>商品金額</th><td>$${money(o.goods)}</td></tr>
        <tr><th>${o.island ? '運費（離島配送）' : '運費'}</th><td>${shipText(o)}</td></tr>
        ${o.islandQuote ? '<tr><td colspan="2" class="sh-ship-note">※ 離島運費另行報價，總金額未含運費</td></tr>' : ''}
        <tr class="grand"><th>總金額</th><td>NT$ ${money(o.total)}</td></tr>
      </table>
    </div>

    <div class="sh-terms">
      <b>訂購詳閱</b>
      <ul>${TERMS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
    <div class="sh-foot">經手人員：${esc(staffText(c)) || '—'}</div>
  </div>`;
}

let currentOrder = null; // 目前明細頁顯示的訂單

function showForm() {
  $('#viewDetail').hidden = true;
  $('#viewForm').hidden = false;
  setStep(1);
  window.scrollTo(0, 0);
}

function showDetail() {
  if (!validate()) return;
  if (!state.orderNo) { state.orderNo = makeOrderNo(); save(); }
  currentOrder = buildOrder();
  $('#sheet').innerHTML = sheetHTML(currentOrder);
  paintFinish();
  $('#viewForm').hidden = true;
  $('#viewDetail').hidden = false;
  setStep(2);
  window.scrollTo(0, 0);
}

function setStep(n) {
  document.querySelectorAll('.step').forEach((s) =>
    s.classList.toggle('on', Number(s.dataset.step) <= n));
}

/** 「完成訂單」按鈕的文字（完成後變成已完成） */
function paintFinish() {
  const b = $('#finishBtn');
  const rec = store.get(KEY.orders, []).find((o) => o.no === state.orderNo);
  if (state.finished && rec) {
    b.textContent = rec.uploaded ? '✓ 已上傳（再傳一次）' : '已存本機，重新上傳';
  } else {
    b.textContent = '完成訂單並上傳';
  }
}

/* ---------------------------------------------------------
   6. 產生圖片／PDF、分享、上傳
   --------------------------------------------------------- */

/** 把訂單畫成圖片（canvas）。固定 800px 寬排版，每台裝置產出一致 */
async function renderCanvas(order) {
  if (!window.html2canvas) throw new Error('圖片工具還沒載入，請確認網路後重新整理');
  const box = $('#renderBox');
  box.innerHTML = `<div class="sheet print">${sheetHTML(order)}</div>`;
  // 等 logo 圖片載好再拍
  await Promise.all([...box.querySelectorAll('img')].map((img) =>
    img.complete ? null : new Promise((ok) => { img.onload = img.onerror = ok; })));
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const canvas = await html2canvas(box.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  box.innerHTML = '';
  return canvas;
}

const canvasToBlob = (canvas, type = 'image/png', q) =>
  new Promise((ok) => canvas.toBlob(ok, type, q));

/** 用畫好的圖做成 A4 PDF（圖本身就是 A4 比例、已含白邊；太長會自動分頁） */
function canvasToPdf(canvas) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210, pageH = 297;
  const h = canvas.height * pageW / canvas.width;
  const img = canvas.toDataURL('image/jpeg', 0.92);
  let y = 0;
  // 一頁放不下時，用「同一張圖往上移」的方式印到下一頁
  while (true) {
    pdf.addImage(img, 'JPEG', 0, -y, pageW, h);
    y += pageH;
    if (y >= h - 1) break; // 差 1mm 以內視為剛好一頁，不多出空白頁
    pdf.addPage();
  }
  return pdf;
}

/** 檔名：1002-A-007_王小明 */
const fileBase = (o) => `${o.no}_${(o.customer.name || '客戶').replace(/[\\/:*?"<>|\s]+/g, '')}`;

/** 觸發下載 */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 按鈕執行中顯示「處理中…」，避免連按 */
async function busy(btn, fn) {
  if (btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '處理中…';
  try { await fn(); } catch (e) { console.error(e); toast('發生問題：' + e.message, 4000); }
  btn.disabled = false; btn.textContent = label;
}

async function downloadPng() {
  const canvas = await renderCanvas(currentOrder);
  downloadBlob(await canvasToBlob(canvas), fileBase(currentOrder) + '.png');
}

async function downloadPdf() {
  const canvas = await renderCanvas(currentOrder);
  canvasToPdf(canvas).save(fileBase(currentOrder) + '.pdf');
}

/** 分享：手機／平板會叫出分享選單（可選 LINE）；電腦不支援就改成下載 */
async function shareImage() {
  const canvas = await renderCanvas(currentOrder);
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], fileBase(currentOrder) + '.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `萬友咖啡訂單 ${currentOrder.no}` });
    } catch (e) {
      if (e.name !== 'AbortError') throw e; // 使用者自己按取消不算錯
    }
  } else {
    downloadBlob(blob, file.name);
    toast('這台裝置不支援直接分享，已改成下載圖片', 3500);
  }
}

/* ---------- 本機訂單紀錄 & 上傳雲端 ---------- */

/** 存（或更新）一筆訂單到本機紀錄 */
function saveRecord(order, uploaded) {
  const list = store.get(KEY.orders, []);
  const i = list.findIndex((o) => o.no === order.no);
  const rec = { no: order.no, uploaded, order };
  if (i >= 0) list[i] = rec; else list.push(rec);
  store.set(KEY.orders, list);
  paintPending();
}

/** 把一筆訂單做成 PDF 傳到 Google 雲端（成功回傳 true） */
async function uploadOrder(order) {
  if (!UPLOAD.url) return false;
  const canvas = await renderCanvas(order);
  const pdf = canvasToPdf(canvas);
  const base64 = pdf.output('datauristring').split(',')[1];
  // 用 text/plain 送出，Google Apps Script 才不會擋
  const res = await fetch(UPLOAD.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key: UPLOAD.key, filename: fileBase(order) + '.pdf', pdf: base64 }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '雲端回應失敗');
  return true;
}

/** 完成訂單：先存本機，再試著上傳 */
async function finishOrder() {
  currentOrder = buildOrder();
  state.finished = true; save();
  saveRecord(currentOrder, false);
  if (!UPLOAD.url) {
    toast('已存在本機（雲端上傳還沒設定）', 3500);
    paintFinish();
    return;
  }
  try {
    await uploadOrder(currentOrder);
    saveRecord(currentOrder, true);
    toast('✓ 訂單已上傳到雲端資料夾');
  } catch (e) {
    console.error(e);
    toast('網路不穩，訂單先存在本機，稍後會自動補傳', 4000);
  }
  paintFinish();
}

/** 待上傳的訂單：顯示數量、可以一鍵補傳 */
function paintPending() {
  const n = store.get(KEY.orders, []).filter((o) => !o.uploaded).length;
  const b = $('#pendingBtn');
  b.hidden = !(n && UPLOAD.url);
  b.textContent = `⚠ 待上傳 ${n} 筆`;
}

let retrying = false;
async function retryPending(silent) {
  if (retrying || !UPLOAD.url) return;
  const pending = store.get(KEY.orders, []).filter((o) => !o.uploaded);
  if (!pending.length) return;
  retrying = true;
  let ok = 0;
  for (const rec of pending) {
    try { await uploadOrder(rec.order); saveRecord(rec.order, true); ok++; } catch (e) { console.error(e); }
  }
  retrying = false;
  paintFinish();
  if (!silent || ok) toast(ok === pending.length ? `✓ 已補傳 ${ok} 筆` : `補傳 ${ok}/${pending.length} 筆，其餘稍後再試`, 3500);
}

/** 開新訂單 */
function newOrder(ask = true) {
  if (ask && !state.finished && !confirm('這張訂單還沒按「完成訂單」，確定要清空開新的嗎？')) return;
  const { staff, staffOther } = state.customer; // 經手人員保留
  state = blankState();
  Object.assign(state.customer, { staff, staffOther });
  save();
  initForm();
  showForm();
}

/* ---------------------------------------------------------
   7. 啟動
   --------------------------------------------------------- */

function initForm() {
  Object.entries(CUSTOMER_FIELDS).forEach(([id, key]) => {
    document.getElementById(id).value = state.customer[key] || '';
  });
  document.querySelectorAll('.invalid').forEach(clearErr); // 開新單時清掉上一張的紅字
  paintChips();
  paintTax();
  $('#islandFee').value = state.islandFee || '';
  $('#extraNote').value = state.extraNote || '';
  renderItems();
  renderExtras();
  updateTotals();
}

function paintDevice() {
  const d = store.get(KEY.device, '');
  $('#deviceBtn').textContent = d ? `裝置 ${d}` : '設定裝置';
}

function init() {
  $('#expoName').textContent = EXPO.shortName;
  if (!state.customer.staff) {
    state.customer.staff = store.get('wyx_staff', '');
    state.customer.staffOther = store.get('wyx_staff_other', '');
  }
  // 舊版是手打的名字；不在名單裡（或舊的「匯款」等選項）就清掉，避免印出沒有按鈕亮起的值
  if (![...STAFF, STAFF_OTHER].includes(state.customer.staff)) state.customer.staff = '';
  // 舊草稿的日期不在展期內 → 改成預設日期
  if (!EXPO_DATES.includes(state.customer.date)) state.customer.date = defaultDate();
  if (!PAYMENT_METHODS.includes(state.customer.payment)) state.customer.payment = '';

  bindCustomer();
  bindItems();
  bindExtras();
  bindShipGift();
  initForm();

  $('#nextBtn').addEventListener('click', showDetail);
  $('#backBtn').addEventListener('click', showForm);
  $('#resetBtn').addEventListener('click', () => newOrder(true));
  $('#newBtn').addEventListener('click', () => newOrder(true));
  $('#dlPng').addEventListener('click', (e) => busy(e.currentTarget, downloadPng));
  $('#dlPdf').addEventListener('click', (e) => busy(e.currentTarget, downloadPdf));
  $('#shareBtn').addEventListener('click', (e) => busy(e.currentTarget, shareImage));
  $('#finishBtn').addEventListener('click', (e) => busy(e.currentTarget, finishOrder));
  $('#pendingBtn').addEventListener('click', (e) => busy(e.currentTarget, () => retryPending(false)));
  $('#deviceBtn').addEventListener('click', () => {
    store.set(KEY.device, '');
    getDevice(); paintDevice();
  });

  paintDevice();
  paintPending();
  setStep(1);

  // 網路恢復時自動補傳
  window.addEventListener('online', () => retryPending(true));
  if (navigator.onLine) setTimeout(() => retryPending(true), 3000);

  // 離線用：註冊 service worker（本機用 file:// 開時會略過）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ---------------------------------------------------------
   密碼門鎖（簡單門鎖）
   ---------------------------------------------------------
   程式裡不放密碼本身，只放密碼的 SHA-256「指紋」。
   比喻：像比對指紋，不用把鑰匙本體放在門口。
   ⚠ 只能擋住一般點連結的人，懂技術的人仍可到 GitHub 看原始檔。
   要換密碼：算出新密碼的 SHA-256 填到下面這行。
   --------------------------------------------------------- */
const PASS_HASH = 'd1c5d939a3ecb9bc8264a99209ee73d8ea171eaa2b3b24553762ae2571fd0430';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function unlock() {
  document.body.classList.remove('locked');
}

function initLock() {
  // 這台裝置之前輸入過正確密碼 → 直接進入
  if (store.get('wyx_unlock', '') === PASS_HASH) { unlock(); return; }

  const form = $('#lock'), input = $('#lockPass'), err = $('#lockErr');
  setTimeout(() => input.focus(), 100);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.crypto || !crypto.subtle) {
      // 只有 https 網址才能用瀏覽器的加密功能
      err.textContent = '請用 https 開頭的正式網址開啟';
      err.hidden = false;
      return;
    }
    if (await sha256(input.value.trim()) === PASS_HASH) {
      store.set('wyx_unlock', PASS_HASH);
      input.value = '';
      unlock();
    } else {
      err.textContent = '密碼錯誤，請再試一次';
      err.hidden = false;
      input.select();
    }
  });
}

initLock();
init();
