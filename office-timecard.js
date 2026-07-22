
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const monthInput = $('timecardMonth');
  const imageInput = $('timecardImages');
  const fileList = $('timecardFileList');
  const runButton = $('runTimecardOcr');
  const clearButton = $('clearTimecard');
  const status = $('timecardStatus');
  const raw = $('timecardRaw');
  const parseButton = $('parseTimecard');
  const addButton = $('addBlankTimecardRow');
  const candidatesBox = $('timecardCandidates');
  const batchBar = $('timecardBatchBar');
  const registerButton = $('registerTimecardRows');

  if (!monthInput || !imageInput || !candidatesBox) return;

  monthInput.value = new Date().toISOString().slice(0, 7);
  let files = [];
  let candidates = [];
  let tesseractPromise = null;

  function escLocal(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;

    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.async = true;
      script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCRを読み込めませんでした'));
      script.onerror = () => reject(new Error('OCRライブラリの通信に失敗しました'));
      document.head.appendChild(script);
    });
    return tesseractPromise;
  }

  function preprocessImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const maxWidth = 1800;
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            const contrast = gray < 175 ? Math.max(0, gray * 0.65) : Math.min(255, gray * 1.12);
            data[i] = data[i + 1] = data[i + 2] = contrast;
          }
          ctx.putImageData(imageData, 0, 0);
          canvas.toBlob(blob => {
            URL.revokeObjectURL(url);
            blob ? resolve(blob) : reject(new Error('画像処理に失敗しました'));
          }, 'image/jpeg', 0.92);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('写真を開けませんでした'));
      };
      img.src = url;
    });
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/[：;]/g, ':')
      .replace(/[〜～―–—]/g, '-')
      .replace(/[OoＯ]/g, '0')
      .replace(/[Il|｜]/g, '1')
      .replace(/\r/g, '\n');
  }

  function validTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return '';
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function makeDate(day) {
    const month = monthInput.value || new Date().toISOString().slice(0, 7);
    const maxDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    const d = Number(day);
    if (!Number.isInteger(d) || d < 1 || d > maxDay) return '';
    return `${month}-${String(d).padStart(2, '0')}`;
  }

  function parseRows(text) {
    const normalized = normalizeText(text);
    const result = [];
    const seen = new Set();

    // Line-based recognition is most reliable for the fixed Japanese timecard format.
    for (const originalLine of normalized.split(/\n+/)) {
      const line = originalLine.replace(/\s+/g, ' ').trim();
      if (!line) continue;

      const times = [...line.matchAll(/(?:^|[^\d])(\d{1,2}):(\d{2})(?=$|[^\d])/g)]
        .map(m => validTime(`${m[1]}:${m[2]}`))
        .filter(Boolean);
      if (times.length < 2) continue;

      // Prefer a number immediately before the first time. Falls back to the first 1–31 number.
      const firstTimePos = line.indexOf(times[0].replace(/^0/, ''));
      const before = firstTimePos >= 0 ? line.slice(0, firstTimePos) : line;
      const dayMatches = [...before.matchAll(/(?:^|[^\d])(\d{1,2})(?:日|[月火水木金土日]?)(?=$|[^\d])/g)];
      let day = dayMatches.length ? Number(dayMatches[dayMatches.length - 1][1]) : 0;
      if (!day) {
        const anyDay = line.match(/(?:^|[^\d])([1-9]|[12]\d|3[01])(?:日|[月火水木金土日]?)(?=[^\d]|$)/);
        day = anyDay ? Number(anyDay[1]) : 0;
      }

      const date = makeDate(day);
      if (!date) continue;

      const start = times[0];
      const end = times[1];
      const key = `${date}_${start}_${end}`;
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        selected: true,
        date,
        start,
        end,
        breakH: 1,
        reimbursement: 0,
        reimbursementMemo: '',
        memo: '',
        source: originalLine.trim()
      });
    }

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }

  function addBlankRow() {
    candidates.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      selected: true,
      date: `${monthInput.value || new Date().toISOString().slice(0, 7)}-01`,
      start: '09:00',
      end: '18:00',
      breakH: 1,
      reimbursement: 0,
      reimbursementMemo: '',
      memo: '',
      source: '手動追加'
    });
    renderCandidates();
  }

  function renderCandidates() {
    batchBar.classList.toggle('hidden', candidates.length === 0);
    if (!candidates.length) {
      candidatesBox.innerHTML = '<div class="note">登録候補はまだありません。</div>';
      return;
    }

    const existing = Array.isArray(db.office) ? db.office : [];
    candidatesBox.innerHTML = candidates.map((row, index) => {
      const duplicate = existing.some(x =>
        x.date === row.date && x.start === row.start && x.end === row.end
      );
      return `<div class="timecard-row">
        <div class="timecard-row-head">
          <label><input data-index="${index}" data-key="selected" type="checkbox" ${row.selected && !duplicate ? 'checked' : ''} ${duplicate ? 'disabled' : ''}> 登録対象</label>
          <button class="danger" data-remove="${index}" type="button">削除</button>
        </div>
        <div class="timecard-row-grid">
          <div class="field"><label>勤務日</label><input data-index="${index}" data-key="date" type="date" value="${escLocal(row.date)}"></div>
          <div class="field"><label>休憩(h)</label><input data-index="${index}" data-key="breakH" type="number" step="0.25" min="0" value="${row.breakH}"></div>
          <div class="field"><label>開始</label><input data-index="${index}" data-key="start" type="time" value="${escLocal(row.start)}"></div>
          <div class="field"><label>終了</label><input data-index="${index}" data-key="end" type="time" value="${escLocal(row.end)}"></div>
          <div class="field"><label>立替精算額</label><input data-index="${index}" data-key="reimbursement" type="number" min="0" value="${row.reimbursement}"></div>
          <div class="field"><label>立替内容</label><input data-index="${index}" data-key="reimbursementMemo" value="${escLocal(row.reimbursementMemo)}" placeholder="交通費・備品など"></div>
        </div>
        <div class="field"><label>メモ</label><input data-index="${index}" data-key="memo" value="${escLocal(row.memo)}" placeholder="直帰・行先など"></div>
        <div class="timecard-row-note">${duplicate ? '⚠️ 同じ日付・開始・終了の勤務が登録済みのため除外します。' : `読み取り元：${escLocal(row.source)}`}</div>
      </div>`;
    }).join('');

    candidatesBox.querySelectorAll('input[data-index]').forEach(input => {
      input.addEventListener('input', () => {
        const row = candidates[Number(input.dataset.index)];
        if (!row) return;
        const key = input.dataset.key;
        if (key === 'selected') row.selected = input.checked;
        else if (key === 'breakH' || key === 'reimbursement') row[key] = Number(input.value) || 0;
        else row[key] = input.value;
      });
    });

    candidatesBox.querySelectorAll('button[data-remove]').forEach(button => {
      button.addEventListener('click', () => {
        candidates.splice(Number(button.dataset.remove), 1);
        renderCandidates();
      });
    });
  }

  imageInput.addEventListener('change', () => {
    files = [...(imageInput.files || [])];
    runButton.disabled = files.length === 0;
    fileList.textContent = files.length
      ? files.map((f, i) => `${i + 1}. ${f.name}`).join(' ／ ')
      : 'まだ写真は選択されていません。';
  });

  runButton.addEventListener('click', async () => {
    if (!files.length) return;
    runButton.disabled = true;
    status.textContent = 'OCRを準備しています。初回は通信に少し時間がかかります…';

    try {
      const Tesseract = await loadTesseract();
      const texts = [];

      for (let i = 0; i < files.length; i++) {
        status.textContent = `${files.length}枚中 ${i + 1}枚目を画像処理しています…`;
        const image = await preprocessImage(files[i]);
        const result = await Tesseract.recognize(image, 'jpn+eng', {
          logger(message) {
            if (message.status === 'recognizing text') {
              status.textContent = `${files.length}枚中 ${i + 1}枚目を読み取り中… ${Math.round((message.progress || 0) * 100)}%`;
            }
          }
        });
        texts.push(result.data.text || '');
      }

      raw.value = texts.join('\n\n--- 次の写真 ---\n\n');
      candidates = parseRows(raw.value);
      renderCandidates();
      status.textContent = candidates.length
        ? `${candidates.length}件の勤務候補を作成しました。日付と時刻を確認してください。`
        : '文字は読み取りましたが勤務行を自動判定できませんでした。文字欄を修正して「登録候補を作成」を押してください。';
    } catch (error) {
      status.textContent = `写真の読み取りに失敗しました：${error.message}。文字欄へ「1 8:51 18:00」の形式で入力すれば一括登録できます。`;
    } finally {
      runButton.disabled = files.length === 0;
    }
  });

  parseButton.addEventListener('click', () => {
    candidates = parseRows(raw.value);
    renderCandidates();
    status.textContent = candidates.length
      ? `${candidates.length}件の候補を作成しました。`
      : '候補を作れませんでした。「日付 開始 終了」の順で1日1行にしてください。';
  });

  addButton.addEventListener('click', addBlankRow);

  clearButton.addEventListener('click', () => {
    files = [];
    candidates = [];
    imageInput.value = '';
    raw.value = '';
    fileList.textContent = 'まだ写真は選択されていません。';
    runButton.disabled = true;
    status.textContent = 'OCRはこの機能を開いて実行したときだけ読み込みます。';
    renderCandidates();
  });

  registerButton.addEventListener('click', () => {
    const selected = candidates.filter(row => row.selected);
    if (!selected.length) {
      alert('登録対象がありません。');
      return;
    }

    const validRows = [];
    const invalidRows = [];
    const duplicates = [];

    for (const row of selected) {
      const start = validTime(row.start);
      const end = validTime(row.end);
      const exists = db.office.some(x => x.date === row.date && x.start === start && x.end === end);
      if (exists) {
        duplicates.push(row);
        continue;
      }
      if (!row.date || !start || !end) {
        invalidRows.push(row);
        continue;
      }

      const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
      let endMinutes = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
      if (endMinutes < startMinutes) endMinutes += 24 * 60;
      const worked = Math.max(0, (endMinutes - startMinutes) / 60 - (Number(row.breakH) || 0));
      if (worked <= 0 || worked > 18) {
        invalidRows.push(row);
        continue;
      }

      const base = Math.min(8, worked);
      const ot = Math.max(0, worked - 8);
      const pay = Math.round(
        base * db.settings.officeHourly +
        ot * db.settings.officeHourly * db.settings.otRate
      );

      validRows.push({
        id: uid(),
        date: row.date,
        start,
        end,
        breakH: Number(row.breakH) || 0,
        worked,
        base,
        ot,
        pay,
        reimbursement: Number(row.reimbursement) || 0,
        reimbursementMemo: row.reimbursementMemo || '',
        memo: row.memo || '',
        source: 'タイムカード一括登録'
      });
    }

    if (!validRows.length) {
      alert(`登録できる勤務がありません。重複 ${duplicates.length}件／要確認 ${invalidRows.length}件`);
      return;
    }

    if (!confirm(`${validRows.length}件を事務所勤務へ登録しますか？\n重複 ${duplicates.length}件、要確認 ${invalidRows.length}件は登録しません。`)) return;

    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      localStorage.setItem(`tfm_db_before_timecard_${stamp}`, JSON.stringify(db));
    } catch (_) {}

    db.office.push(...validRows);
    db.office.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    save();

    const registeredKeys = new Set(validRows.map(x => `${x.date}_${x.start}_${x.end}`));
    candidates = candidates.filter(row => !registeredKeys.has(`${row.date}_${row.start}_${row.end}`));
    renderCandidates();
    alert(`${validRows.length}件を登録しました。登録前データも端末内へ退避しています。`);
  });

  renderCandidates();
})();
