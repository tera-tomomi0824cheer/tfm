
(() => {
  'use strict';

  const form = document.getElementById('usaSlipForm');
  const preview = document.getElementById('usaSlipPreview');
  const copyButton = document.getElementById('copyUsaSlipCalculated');
  const clearButton = document.getElementById('clearUsaSlipForm');

  if (!form || !preview || !copyButton || !clearButton) return;

  const field = name => form.elements.namedItem(name);
  const number = name => {
    const value = Number(field(name)?.value || 0);
    return Number.isFinite(value) ? value : 0;
  };
  const yenLocal = value =>
    `¥${Math.round(Number(value) || 0).toLocaleString('ja-JP')}`;

  function calculatedTaxable() {
    return Math.round(
      number('unitRate') *
      number('days') *
      number('quantity') +
      number('allowance')
    );
  }

  function values() {
    const calculated = calculatedTaxable();
    const taxable = Math.round(number('taxable'));
    const fare = Math.round(number('fare'));
    const reimbursement = Math.round(number('reimbursement'));
    const tax = Math.round(number('tax'));
    const deduction = Math.round(number('deduction'));
    const gross = taxable + fare + reimbursement;
    const net = gross - tax - deduction;

    return {
      calculated,
      taxable,
      fare,
      reimbursement,
      tax,
      deduction,
      gross,
      net
    };
  }

  function renderPreview() {
    const v = values();
    preview.innerHTML = `
      明細計算額：${yenLocal(v.calculated)}<br>
      課税支給：${yenLocal(v.taxable)} ／ 非課税：${yenLocal(v.fare + v.reimbursement)}<br>
      所得税・控除：${yenLocal(v.tax + v.deduction)}<br>
      <strong>差引支給見込み ${yenLocal(v.net)}</strong>
    `;
  }

  function resetForm() {
    form.reset();
    field('date').value = new Date().toISOString().slice(0, 10);
    field('unitRate').value = 11000;
    field('days').value = 1;
    field('quantity').value = 1;
    field('allowance').value = 0;
    field('taxable').value = 11000;
    field('fare').value = 0;
    field('reimbursement').value = 0;
    field('tax').value = 0;
    field('deduction').value = 0;
    renderPreview();
  }

  copyButton.addEventListener('click', () => {
    field('taxable').value = calculatedTaxable();
    renderPreview();
  });

  clearButton.addEventListener('click', resetForm);
  form.addEventListener('input', renderPreview);

  form.addEventListener('submit', event => {
    event.preventDefault();

    if (typeof db === 'undefined' || typeof save !== 'function' || typeof uid !== 'function') {
      alert('TFM本体の準備が完了していません。画面を再読み込みしてください。');
      return;
    }

    const date = field('date').value;
    const description = String(field('description').value || '').trim();
    const unitRate = number('unitRate');
    const days = number('days');
    const quantity = number('quantity');
    const allowance = Math.round(number('allowance'));
    const start = field('start').value || '';
    const end = field('end').value || '';
    const memo = String(field('memo').value || '').trim();
    const v = values();

    if (!date) {
      alert('業務日を入力してください。');
      return;
    }
    if (!description) {
      alert('適用・業務名を入力してください。');
      return;
    }
    if (unitRate < 0 || days < 0 || quantity < 0 || v.taxable < 0) {
      alert('金額・日数・時間数は0以上で入力してください。');
      return;
    }

    const duplicate = Array.isArray(db.usa) && db.usa.some(item =>
      item.date === date &&
      String(item.venue || item.description || '').trim() === description &&
      Number(item.gross || 0) === v.gross
    );
    if (duplicate && !confirm('同じ日付・業務名・支給額のUSA履歴が既にあります。それでも登録しますか？')) {
      return;
    }

    if (!confirm(
      `${date} ${description}\n` +
      `課税 ${yenLocal(v.taxable)}／非課税 ${yenLocal(v.fare + v.reimbursement)}\n` +
      `差引 ${yenLocal(v.net)}で登録しますか？`
    )) return;

    // Preserve the entire database immediately before registration.
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      localStorage.setItem(`tfm_db_before_usa_slip_${stamp}`, JSON.stringify(db));
    } catch (_) {}

    if (!Array.isArray(db.usa)) db.usa = [];

    db.usa.unshift({
      id: uid(),
      date,
      type: '支払明細準拠',
      venue: description,
      description,
      payMode: 'slip',
      unitRate,
      days,
      quantity,
      factor: quantity,
      allowance,
      start,
      end,
      memo,
      taxable: v.taxable,
      fare: v.fare,
      reimbursement: v.reimbursement,
      tax: v.tax,
      deduction: v.deduction,
      gross: v.gross,
      net: v.net,
      source: 'USA支払明細準拠入力'
    });

    save();
    resetForm();
    alert('USA履歴へ登録しました。');
  });

  resetForm();
})();
