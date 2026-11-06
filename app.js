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
  // 高單價小包裝不用公斤數：pack=選第幾種包裝、qty=幾包
  return { uid: uid(), pid: '', kg: 5, pack: 0, qty: 1, bagPrice: null, unitPrice: null };
}
function newExtra() {
  return { uid: uid(), name: '', kg: '', price: '' };
}
function blankState() {
  return {
    orderNo: '',          // 訂單編號（進到第二頁才產生）
    sent: null,           // 已送到雲端：{ version 版本, hash 送出時的內容 }
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
  if (p.packs) return splitPack(item, p);
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

/** 高單價小包裝：一種包裝一行，價格是「每包／每盒」 */
function splitPack(item, p) {
  const pk = p.packs[item.pack] || p.packs[0];
  const qty = item.qty || 1;
  const price = item.unitPrice ?? pk.price;
  const missing = price === null || price === '' || Number(price) <= 0;
  return [{
    kind: 'unit',
    spec: `${pk.label} ×${qty}`,
    kg: Math.round(pk.kg * qty * 100) / 100, // 算總重、免運用
    qty, per: pk.unit,                       // 單價單位：包／盒
    price, missing,
    edited: item.unitPrice !== null && item.unitPrice !== pk.price,
    subtotal: missing ? 0 : Number(price) * qty,
  }];
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

/* ---------- 水果特調雲端庫存 ----------
   比喻：櫃台在雲端放一塊「剩幾公斤」的看板，大家看同一塊。
   可訂量 ＝ 總庫存 − 已被訂單佔用；正在改的這張單自己佔的不算。 */
let fruitStock = null;                    // { 品號: { total, reserved } }；null＝還沒讀到（沒網路）
const isFruit = (p) => p && p.group === '水果特調';
const HOLDING = ['pending', 'returned', 'paid'];

function fruitAvailable(pid) {
  if (!fruitStock) return null;           // 不知道就不擋，送單時雲端會再檢查
  const it = fruitStock[pid] || { total: 0, reserved: 0 };
  const rec = liveOf(state.orderNo);
  // 這張單自己佔的要加回來（不然修改時會被自己擋住）。
  // 只算有 fruit 標記的列，跟雲端的算法一致（超賣檢查上線前的舊單沒有標記，雲端也沒算它）
  const own = rec && HOLDING.includes(rec.status)
    ? rec.order.rows.filter((r) => r.id === pid && r.fruit).reduce((t, r) => t + r.kg, 0) : 0;
  return Math.max(0, it.total - it.reserved + own);
}

/** 這張單裡某支水果特調一共訂了幾 KG（同一支可能分好幾行） */
const kgInOrder = (pid) => state.items.filter((it) => it.pid === pid)
  .reduce((t, it) => t + splitItem(it).reduce((a, l) => a + l.kg, 0), 0);

/** 超過可訂量的水果特調 [{ name, want, left }] */
function fruitShortage() {
  return [...new Set(state.items.map((it) => it.pid))]
    .map(findProduct).filter(isFruit)
    .map((p) => ({ name: p.name, want: kgInOrder(p.id), left: fruitAvailable(p.id) }))
    .filter((x) => x.left !== null && x.want > x.left);
}

const stockText = (p) => {
  const left = fruitAvailable(p.id);
  return left === null ? '' : `可訂 ${left} KG`;
};

/** 庫存有變化時，只更新提示文字，不重畫輸入欄（不然打字會被打斷） */
function paintStock() {
  state.items.forEach((it) => {
    const row = document.querySelector(`.item[data-uid="${it.uid}"]`);
    if (row) row.querySelector('.item-note').innerHTML = itemNoteHTML(it);
  });
}

function itemNoteHTML(it) {
  const p = findProduct(it.pid);
  if (!p) return '';
  let html = esc(priceNote(p));
  if (isFruit(p)) {
    const left = fruitAvailable(p.id);
    if (left !== null) {
      const over = kgInOrder(p.id) > left;
      html += `｜<b class="${over ? 'stock-over' : 'stock-ok'}">${over ? `庫存不足，只剩 ${left} KG` : `可訂 ${left} KG`}</b>`;
    }
  }
  return html;
}

/* ---------- 品項選單：按國家折疊，點了才展開 ----------
   比喻：像抽屜櫃，一個國家一格抽屜，拉開才看到裡面的豆子。
   高單價、水果特調各自一格。代碼（ET037…）沒有時才顯示品號。 */
const codeOf = (p) => p.code || p.id;
const pickGroupOf = (p) => (['高單價（小包裝）', '水果特調'].includes(p.group) ? p.group : p.name.split(' ')[0]);

function pickLabel(pid) {
  const p = findProduct(pid);
  return p ? `${codeOf(p)}　${p.name}` : '— 請選擇品項 —';
}

let pickingUid = null; // 正在幫哪一行選品項

function openPicker(uid) {
  pickingUid = uid;
  const cur = findProduct(state.items.find((x) => x.uid === uid).pid);
  const groups = [...new Set(PRODUCTS.map(pickGroupOf))];
  $('#pickerList').innerHTML = groups.map((g) => {
    const list = PRODUCTS.filter((p) => pickGroupOf(p) === g);
    const open = cur && pickGroupOf(cur) === g; // 已選的品項所在國家先打開
    return `
    <details class="pk-group"${open ? ' open' : ''}>
      <summary><span>${esc(g)}</span><small>${list.length} 支</small></summary>
      ${list.map((p) => `
        <button type="button" class="pk-item${cur === p ? ' on' : ''}" data-pick="${p.id}">
          <b>${esc(codeOf(p))}</b><span>${esc(p.name)}<small>${esc(priceNote(p))}${isFruit(p) && stockText(p) ? `｜${stockText(p)}` : ''}</small></span>
        </button>`).join('')}
    </details>`;
  }).join('');
  $('#picker').hidden = false;
  document.body.classList.add('picking');
}

function closePicker() {
  $('#picker').hidden = true;
  document.body.classList.remove('picking');
  pickingUid = null;
}

function bindPicker() {
  $('#pickerClose').addEventListener('click', closePicker);
  $('#picker').addEventListener('click', (e) => {
    if (e.target.id === 'picker') return closePicker(); // 點外面關閉
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const it = state.items.find((x) => x.uid === pickingUid);
    it.pid = btn.dataset.pick;
    it.bagPrice = null; it.unitPrice = null; // 換豆子 → 單價回到預設
    it.pack = 0; it.qty = 1;
    closePicker();
    renderItems(); save(); // 一般豆子／小包裝的數量欄不一樣，整列重畫
  });
}

// 一個商品的「價格說明」小字：5KG $460／30KG袋 $450
function priceNote(p) {
  if (!p) return '';
  if (p.packs) return p.packs.map((k) => `${k.label} $${money(k.price)}/${k.unit}`).join('｜');
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
        <button type="button" class="item-pick${it.pid ? '' : ' empty'}" aria-label="選擇品項">${esc(pickLabel(it.pid))}</button>
        ${qtyControl(it)}
        <button type="button" class="icon-btn del-item" aria-label="刪除這行">×</button>
      </div>
      <div class="item-note">${itemNoteHTML(it)}</div>
      <div class="lines"></div>
    </div>`).join('');
  state.items.forEach((it) => renderLines(it));
  updateTotals();
}

/** 數量控制：一般豆子用公斤（每次 5KG），小包裝用「包裝＋幾包」 */
function qtyControl(it) {
  const p = findProduct(it.pid);
  if (p && p.packs) {
    const pk = p.packs[it.pack] || p.packs[0];
    const options = p.packs.map((k, i) =>
      `<option value="${i}"${k === pk ? ' selected' : ''}>${k.label}</option>`).join('');
    return `
        <select class="pack-select" aria-label="包裝"${p.packs.length < 2 ? ' disabled' : ''}>${options}</select>
        <div class="stepper" aria-label="數量">
          <button type="button" class="step-btn" data-d="-1" aria-label="減 1">−</button>
          <input type="number" class="qty-input" inputmode="numeric" min="1" step="1" value="${it.qty || 1}">
          <span class="kg-unit">${pk.unit}</span>
          <button type="button" class="step-btn" data-d="1" aria-label="加 1">＋</button>
        </div>`;
  }
  return `
        <div class="stepper" aria-label="公斤數">
          <button type="button" class="step-btn" data-d="-5" aria-label="減 5KG">−</button>
          <input type="number" class="kg-input" inputmode="numeric" min="5" step="5" value="${it.kg}">
          <span class="kg-unit">KG</span>
          <button type="button" class="step-btn" data-d="5" aria-label="加 5KG">＋</button>
        </div>`;
}

/** 只重畫某一行商品下面的拆袋明細 */
function renderLines(it) {
  const row = document.querySelector(`.item[data-uid="${it.uid}"]`);
  if (!row) return;
  if (isFruit(findProduct(it.pid))) paintStock();
  const box = row.querySelector('.lines');
  const lines = splitItem(it);
  if (!lines.length) { box.innerHTML = ''; return; }
  box.innerHTML = lines.map((l) => `
    <div class="line${l.missing ? ' need' : ''}" data-kind="${l.kind}">
      <span class="line-spec">${l.spec}</span>
      <label class="line-price">
        <span>$</span>
        <input type="number" inputmode="numeric" class="price-input${l.edited ? ' edited' : ''}"
          value="${l.price ?? ''}" placeholder="請填單價" aria-label="單價">
        <span>/${l.per || 'kg'}</span>
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

  // 點品項 → 打開國家折疊選單
  list.addEventListener('click', (e) => {
    const pick = e.target.closest('.item-pick');
    if (pick) openPicker(pick.closest('.item').dataset.uid);
  });

  list.addEventListener('change', (e) => {
    const it = itemOf(e.target);
    // 換包裝（500公克 ↔ 1KG）→ 單價回到該包裝的預設
    if (e.target.classList.contains('pack-select')) {
      it.pack = Number(e.target.value);
      it.unitPrice = null;
      renderItems(); save();
    }
    if (e.target.classList.contains('qty-input')) {
      it.qty = Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1)));
      e.target.value = it.qty;
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
      const qtyInput = step.closest('.stepper').querySelector('.qty-input');
      if (qtyInput) {
        it.qty = Math.max(1, (it.qty || 1) + Number(step.dataset.d));
        qtyInput.value = it.qty;
      } else {
        it.kg = normalizeKg(it.kg + Number(step.dataset.d));
        step.closest('.stepper').querySelector('.kg-input').value = it.kg;
      }
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
  // 水果特調超過可訂量
  fruitShortage().forEach((x) => errs.push(`${x.name} 庫存不足（訂 ${x.want} KG，只剩 ${x.left} KG）`));
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
      id: p.id, code: codeOf(p), name: p.name, spec: l.spec, price: Number(l.price), kg: l.kg,
      per: l.per || '', qty: l.qty || 0, fruit: isFruit(p),
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
/** 訂單上的付款方式：付款後以櫃台為準，「匯款」不給客人看，顯示成「其他」 */
function paidMethodText(o) {
  const c = o.customer;
  const rec = liveOf(o.no);
  const paid = rec && rec.paid;
  if (!paid) return paymentText(c);
  if (paid.method === '付現') return '現金';
  if (paid.method === '匯款') return (c.payOther || '').trim() || PAY_OTHER;
  return paid.method;
}

/** 訂單右上角的印章（比喻：櫃台蓋的「已付款」章） */
function stampHTML(o) {
  const rec = liveOf(o.no);
  if (!rec) return '';
  if (rec.status === 'pending' || rec.status === 'returned') {
    return `<div class="sh-tag">${STATUS_LABEL[rec.status]}</div>`;
  }
  const at = rec.status === 'paid' ? timeText(rec.paid.at) : timeText(rec.updatedAt);
  return `<div class="sh-stamp ${rec.status}">${STATUS_LABEL[rec.status]}<small>${at}</small></div>`;
}

/** 時間顯示：11/14 14:30 */
function timeText(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sheetHTML(o) {
  const c = o.customer;
  const info = [
    ['訂購姓名', c.name], ['電話', c.phone],
    ['統一編號', c.tax], ['付款方式', paidMethodText(o)],
    ['收件地址', c.address, true],
  ];
  const itemRows = o.rows.map((r) => `
    <tr>
      ${r.first ? `<td class="t-id" rowspan="${r.span}">${esc(r.code || r.id)}</td><td class="t-name" rowspan="${r.span}"><span class="t-id-inline">${esc(r.code || r.id)}</span>${esc(r.name)}</td>` : ''}
      <td class="t-spec">${r.spec}</td>
      <td class="t-num">${money(r.price)}${r.per ? `/${r.per}` : ''}</td>
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
      ${stampHTML(o)}
    </div>

    <table class="sh-info">
      ${info.map(([k, v, full]) => `<tr${full ? ' class="full"' : ''}><th>${k}</th><td>${esc(v) || '—'}</td></tr>`).join('')}
    </table>

    <table class="sh-items">
      <thead><tr>
        <th>編號</th><th>品名</th><th>規格</th>
        <th class="t-num">單價</th><th class="t-num">數量(KG)</th><th class="t-num">小計</th>
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

/** 切換畫面：form 填寫／detail 明細／list 訂單列表 */
function showView(name) {
  $('#viewForm').hidden = name !== 'form';
  $('#viewDetail').hidden = name !== 'detail';
  $('#viewList').hidden = name !== 'list';
  document.querySelector('.steps').hidden = name === 'list';
  if (name !== 'list') setStep(name === 'form' ? 1 : 2);
  window.scrollTo(0, 0);
}

const showForm = () => showView('form');

function showDetail() {
  if (!validate()) return;
  if (!state.orderNo) { state.orderNo = makeOrderNo(); save(); }
  renderDetail(buildOrder());
}

function renderDetail(order) {
  currentOrder = order;
  $('#sheet').innerHTML = sheetHTML(order);
  paintFinish();
  showView('detail');
}

function setStep(n) {
  document.querySelectorAll('.step').forEach((s) =>
    s.classList.toggle('on', Number(s.dataset.step) <= n));
}

/** 比對內容有沒有改過（編號、時間不算） */
const orderHash = (o) => JSON.stringify({ ...o, no: '', createdAt: '' });

/** 明細頁的狀態說明與按鈕，依訂單狀態變化 */
function paintFinish() {
  const rec = liveOf(state.orderNo);
  const status = rec ? rec.status : '';
  const locked = ['paid', 'void', 'cancelled', 'deleted'].includes(status);
  const changed = !!state.sent && currentOrder && orderHash(currentOrder) !== state.sent.hash;
  const b = $('#finishBtn');

  const notes = {
    pending: '已送到櫃台，等待客人結帳',
    returned: `櫃台退回的原因：${(rec && rec.returnReason) || '請確認訂單'}`,
    paid: '這張單不能再修改。要改單請櫃台作廢後重開',
    void: `${rec && rec.voidReason ? `${rec.voidReason}。` : ''}可以複製成新單`,
    cancelled: '可以複製成新單',
    deleted: '櫃台已刪除這張單，可以複製成新單',
  };
  const banner = $('#statusBanner');
  banner.hidden = !status;
  banner.className = `status-banner ${status}`;
  banner.textContent = status ? `${STATUS_LABEL[status]}｜${notes[status]}` : '';

  b.hidden = locked;
  b.disabled = status === 'pending' && !changed;
  b.textContent = !state.sent ? '送單到櫃台'
    : status === 'pending' ? (changed ? '更新送單' : '✓ 已送單')
      : '修改後重新送單';
  $('#backBtn').hidden = locked;
  $('#cancelBtn').hidden = !['pending', 'returned'].includes(status);
  $('#copyBtn').hidden = !['void', 'cancelled', 'deleted'].includes(status);
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
  if (!$('#viewDetail').hidden) paintFinish(); // 按鈕文字與狀態依最新訂單重畫
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

/* ---------- 送單到櫃台 ----------
   本機留一份紀錄（KEY.orders）：uploaded=false 代表還沒送到雲端，
   斷線時排隊，網路恢復自動補送。 */

let live = {}; // 雲端全部訂單，用編號查

// 只有自己送出過的單才讀雲端狀態；還沒送出的單就算編號撞到別人，也不會被當成對方那張
const liveOf = (no) => (state.sent && state.orderNo === no ? live[no] : null);

function saveRecord(rec) {
  const list = store.get(KEY.orders, []);
  const i = list.findIndex((o) => o.no === rec.no);
  if (i >= 0) list[i] = rec; else list.push(rec);
  store.set(KEY.orders, list);
  paintPending();
}

/** 把本機紀錄送進雲端，回傳實際的編號與版本 */
async function pushRecord(r) {
  const c = r.order.customer;
  const body = () => ({
    order: r.order, draft: r.draft, total: r.order.total,
    name: c.name, phone: c.phone, staff: staffText(c),
  });
  if (r.sent) {
    const res = await Sync.update(r.no, r.sent.version, body());
    return { no: r.no, version: res.version };
  }
  // 新單：編號被別台用走就換下一號，不會蓋掉別人的單
  for (let i = 0; i < 30; i++) {
    const now = Date.now();
    const created = await Sync.create({
      ...body(), no: r.no, status: 'pending', version: 1, returnReason: '',
      device: store.get(KEY.device, ''), createdAt: now, updatedAt: now,
    });
    if (created) return { no: r.no, version: 1 };
    const seen = r.no;
    r.no = makeOrderNo();
    r.order = { ...r.order, no: r.no };
    r.draft = { ...r.draft, orderNo: r.no };
    removeRecord(seen);
  }
  throw new Error('訂單編號重複太多次');
}

function removeRecord(no) {
  store.set(KEY.orders, store.get(KEY.orders, []).filter((o) => o.no !== no));
}

/** 送單成功後，讓目前畫面的單跟上實際編號與版本 */
function afterPush(r, res) {
  saveRecord({ ...r, no: res.no, uploaded: true });
  if (state.orderNo !== r.previousNo) return;
  state.orderNo = res.no;
  state.sent = { version: res.version, hash: orderHash(r.order) };
  save();
  if (!$('#viewDetail').hidden) renderDetail(r.order);
}

/** 按下「送單到櫃台」 */
async function sendOrder() {
  currentOrder = buildOrder();
  const r = {
    no: currentOrder.no, previousNo: currentOrder.no, uploaded: false, order: currentOrder,
    sent: state.sent, draft: { ...state, sent: null },
  };
  saveRecord(r);
  try {
    afterPush(r, await pushRecord(r));
    toast('✓ 已送到櫃台');
  } catch (e) {
    console.error(e);
    if (e.syncCode) {
      removeRecord(r.no);
      toast(syncErrorText(e), 4500);
    } else {
      toast('網路不穩，訂單先排隊，有網路會自動送出', 4500);
    }
  }
  paintFinish();
}

/** 取消訂單（還沒付款才可以） */
async function cancelOrder() {
  if (!confirm('確定要取消這張訂單嗎？')) return;
  try { await Sync.cancel(state.orderNo, live[state.orderNo].version); toast('已取消訂單'); }
  catch (e) { toast(syncErrorText(e), 4500); }
}

/** 把已作廢／取消的單複製成新單（內容帶回填單頁，客人不用重填） */
function copyOrder() {
  const { customer } = state;
  state = {
    ...state, orderNo: '', sent: null,
    customer: { ...customer, date: defaultDate() },
  };
  save();
  initForm();
  showForm();
  toast('已複製內容，修改後請重新送單');
}

/** 目前有沒有填到一半、還沒送出的單 */
function hasUnsentDraft() {
  return !state.sent && (state.customer.name.trim() || state.items.some((it) => it.pid));
}

/** 從列表打開一張單：待付款／已退回可以修改，其他只能看 */
function openOrder(no) {
  const rec = live[no];
  if (hasUnsentDraft() && !confirm('目前填寫中的訂單還沒送出，確定要離開嗎？')) return;
  state = { ...blankState(), ...rec.draft, orderNo: no, sent: { version: rec.version, hash: orderHash(rec.order) } };
  save();
  initForm();
  renderDetail(rec.order);
}

/* ---------- 訂單列表 ---------- */

function renderList() {
  const staff = $('#listStaff').value;
  const q = $('#listSearch').value.trim();
  const all = Object.values(live).filter((o) => o.status !== 'deleted').sort((a, b) => b.createdAt - a.createdAt);

  // 經手人員篩選：只列出有訂單的人，選過的保留
  const names = [...new Set(all.map((o) => o.staff).filter(Boolean))];
  $('#listStaff').innerHTML = '<option value="">全部人員</option>' +
    names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('#listStaff').value = names.includes(staff) ? staff : '';

  const shown = all.filter((o) => (!$('#listStaff').value || o.staff === staff)
    && (!q || [o.no, o.name, o.phone].some((v) => String(v).includes(q))));
  $('#orderList').innerHTML = shown.map((o) => `
    <button type="button" class="order-row" data-no="${esc(o.no)}">
      <span class="order-badge ${o.status}">${STATUS_LABEL[o.status]}</span>
      <span class="order-main"><b>${esc(o.name)}</b><small>${esc(o.no)}｜${esc(o.staff) || '—'}</small></span>
      <span class="order-total">$${money(o.total)}</span>
    </button>`).join('') || '<p class="hint">目前沒有訂單</p>';
}

function paintListBtn() {
  const n = Object.values(live).filter((o) => o.status === 'returned').length;
  $('#listBtn').textContent = n ? `訂單列表（${n} 筆退回）` : '訂單列表';
  $('#listBtn').classList.toggle('alert', n > 0);
}

/** 收到雲端最新資料 */
function onOrders(list) {
  live = Object.fromEntries(list.map((o) => [o.no, o]));
  paintListBtn();
  if (!$('#viewList').hidden) renderList();
  const rec = live[state.orderNo];
  if (rec && state.sent) {
    // 櫃台退回會讓版本 +1，跟上才能重新送單
    if (rec.status === 'returned') state.sent.version = rec.version;
    // 只換內容、不跳頁，別人更新時畫面不會捲回頂端
    if (!$('#viewDetail').hidden) {
      if (rec.status !== 'pending') currentOrder = rec.order;
      $('#sheet').innerHTML = sheetHTML(currentOrder);
      paintFinish();
    }
  }
}

/** 把一筆訂單做成 PDF 傳到 Google 雲端（Code.gs 部署後，改在付款後呼叫） */
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

/** 排隊中的訂單：顯示數量、可以一鍵補送 */
function paintPending() {
  const n = store.get(KEY.orders, []).filter((o) => !o.uploaded).length;
  const b = $('#pendingBtn');
  b.hidden = !n;
  b.textContent = `⚠ 待送出 ${n} 筆`;
}

let retrying = false;
async function retryPending(silent) {
  if (retrying) return;
  const pending = store.get(KEY.orders, []).filter((o) => !o.uploaded);
  if (!pending.length) return;
  retrying = true;
  let ok = 0;
  for (const rec of pending) {
    try {
      rec.previousNo = rec.no;
      afterPush(rec, await pushRecord(rec));
      ok++;
    } catch (e) {
      console.error(e);
      if (e.syncCode) { removeRecord(rec.no); toast(syncErrorText(e), 4500); }
    }
  }
  retrying = false;
  paintPending();
  if (!$('#viewDetail').hidden) paintFinish();
  if (!silent || ok) toast(ok === pending.length ? `✓ 已補送 ${ok} 筆` : `補送 ${ok}/${pending.length} 筆，其餘稍後再試`, 3500);
}

/** 開新訂單 */
function newOrder(ask = true) {
  if (ask && hasUnsentDraft() && !confirm('這張訂單還沒送到櫃台，確定要清空開新的嗎？')) return;
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
  bindPicker();
  initForm();

  $('#nextBtn').addEventListener('click', showDetail);
  $('#backBtn').addEventListener('click', showForm);
  $('#resetBtn').addEventListener('click', () => newOrder(true));
  $('#newBtn').addEventListener('click', () => newOrder(true));
  $('#dlPng').addEventListener('click', (e) => busy(e.currentTarget, downloadPng));
  $('#dlPdf').addEventListener('click', (e) => busy(e.currentTarget, downloadPdf));
  $('#shareBtn').addEventListener('click', (e) => busy(e.currentTarget, shareImage));
  $('#finishBtn').addEventListener('click', (e) => busy(e.currentTarget, sendOrder));
  $('#cancelBtn').addEventListener('click', (e) => busy(e.currentTarget, cancelOrder));
  $('#copyBtn').addEventListener('click', copyOrder);
  $('#pendingBtn').addEventListener('click', (e) => busy(e.currentTarget, () => retryPending(false)));
  $('#listBtn').addEventListener('click', () => { renderList(); showView('list'); });
  $('#listBack').addEventListener('click', showForm);
  $('#listStaff').addEventListener('change', renderList);
  $('#listSearch').addEventListener('input', renderList);
  $('#orderList').addEventListener('click', (e) => {
    const row = e.target.closest('.order-row');
    if (row) openOrder(row.dataset.no);
  });
  $('#deviceBtn').addEventListener('click', () => {
    store.set(KEY.device, '');
    getDevice(); paintDevice();
  });

  paintDevice();
  paintPending();
  setStep(1);

  // 網路恢復時自動補送，並顯示連線狀態
  const paintNet = () => { $('#netDot').hidden = navigator.onLine; };
  window.addEventListener('online', () => { paintNet(); retryPending(true); });
  window.addEventListener('offline', paintNet);
  paintNet();

  // 離線用：註冊 service worker（本機用 file:// 開時會略過）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ---------------------------------------------------------
   登入門鎖
   ---------------------------------------------------------
   密碼是真正登入雲端用的，程式裡沒有存密碼。
   沒登入就讀不到客戶資料；每台裝置輸入一次後會記住。
   要換密碼：到 Firebase 的 Authentication 改使用者密碼。
   --------------------------------------------------------- */
let watching = false;

function unlock() {
  document.body.classList.remove('locked');
  if (watching) return;
  watching = true;
  Sync.watch(onOrders, (e) => { console.error(e); watching = false; }).catch(console.error);
  Sync.watchStock((items) => { fruitStock = items; paintStock(); }, console.error).catch(console.error);
  retryPending(true);
}

function initLock() {
  const form = $('#lock'), input = $('#lockPass'), err = $('#lockErr');
  const showErr = (text) => { err.textContent = text; err.hidden = false; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await Sync.login(input.value.trim());
      store.set('wyx_signed', true);
      input.value = '';
    } catch (ex) {
      console.error(ex);
      const wrong = String(ex.code || '').includes('invalid') || String(ex.code || '').includes('wrong-password');
      showErr(wrong ? '密碼錯誤，請再試一次' : '連線失敗，請檢查網路');
      input.select();
    }
  });

  Sync.onUser((user) => {
    if (user) unlock();
    else setTimeout(() => input.focus(), 100);
  }).catch((e) => {
    // 沒網路下載不到 Firebase：登入過的裝置仍可先填單，訂單會排隊
    console.error(e);
    if (store.get('wyx_signed', false)) document.body.classList.remove('locked');
    else showErr('連線失敗，請檢查網路');
  });
}

initLock();
init();
