// Runs in the page (all frames) when the toolbar icon is clicked.
async function runActivities(minMs, maxMs) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = () => sleep(minMs + Math.random() * (maxMs - minMs));
  const log = (...a) => console.log('[auto_participation_activity]', ...a);

  // Collect matches, including ones inside open shadow roots.
  const findAll = (selector) => {
    const found = [];
    const walk = (root) => {
      root.querySelectorAll(selector).forEach((el) => found.push(el));
      root.querySelectorAll('*').forEach((el) => el.shadowRoot && walk(el.shadowRoot));
    };
    walk(document);
    return found;
  };

  // Same, but skipping anything inside an activity already marked completed.
  const isActivityDone = (el) => !!el.closest('.interactive-activity-container')
    ?.querySelector('.title-bar-chevron[aria-label="Activity completed"]');
  const findTodo = (selector) => findAll(selector).filter((el) => !isActivityDone(el));
  const isQuestionDone = (question) =>
    !!question.querySelector('.question-chevron[aria-label="Question completed"]');

  // Wait until `fn` returns something truthy, or give up after `timeoutMs`.
  const waitFor = async (fn, timeoutMs = 5000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  };

  // Set an input's value so the page's framework notices the change.
  const typeInto = (input, value) => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let actions = 0;

  log('starting radio buttons');
  // 1. Radio buttons, grouped by question. Stop on a question once it's correct.
  const radioGroups = new Map();
  for (const radio of findTodo('input[type="radio"]')) {
    const question = radio.closest('.question-set-question');
    if (!radioGroups.has(question)) radioGroups.set(question, []);
    radioGroups.get(question).push(radio);
  }
  for (const [question, radios] of radioGroups) {
    if (question && isQuestionDone(question)) continue;
    for (const radio of radios) {
      if (radio.disabled) continue;
      radio.scrollIntoView({ block: 'center' });
      radio.click(); // fires click/input/change like a real user click
      actions++;
      await pause();
      if (question?.querySelector('.zb-explanation.correct')) break;
    }
  }

  log('starting short answers');
  // 2. Short-answer questions: show answer twice, then copy it into the input.
  for (const question of findTodo('.short-answer-question')) {
    if (isQuestionDone(question)) continue;
    const button = question.querySelector('.show-answer-button');
    const input = question.querySelector('input.zb-input');
    if (!button || !input) continue;

    button.scrollIntoView({ block: 'center' });
    button.click();
    await pause();
    button.click();
    await pause();

    const answer = await waitFor(() => question.querySelector('.forfeit-answer'));
    if (!answer) continue;

    typeInto(input, answer.textContent.trim());
    actions++;
    await pause();

    const check = question.querySelector('.check-button');
    if (check) {
      check.click();
      await pause();
    }
  }

  log('starting animations');
  // 3. Animations: enable 2x speed, start, keep pressing play until finished.
  //    No random pauses here, only short polling while the animation runs.
  for (const controls of findTodo('.animation-controls')) {
    // The controls re-render after Start, so always re-query from the parent.
    const area = controls.parentElement;
    const q = (sel) => area.querySelector(sel);
    const ensure2x = () => {
      const box = q('.speed-control input.zb-checkbox-input');
      if (box && !box.checked) box.click();
    };

    ensure2x();
    const start = q('.start-button');
    if (!start) continue;
    start.scrollIntoView({ block: 'center' });
    start.click();

    const end = Date.now() + 5 * 60 * 1000; // safety cap per animation
    while (Date.now() < end) {
      ensure2x();
      const play = q('.play-button');
      if (play && play.classList.contains('rotate-180')) break; // finished
      if (play && play.classList.contains('bounce')) {
        play.closest('button').click();
        // Wait for this click to register so we don't double-press it.
        await waitFor(() => !q('.play-button.bounce'), 2000);
      }
      await sleep(100);
    }
    actions++;
  }

  // 4. Definition matching: try terms in each slot until every slot is correct.
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const fire = (el, type, { x, y }, Ctor = MouseEvent, extra = {}) =>
    el.dispatchEvent(new Ctor(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: type.endsWith('up') ? 0 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra
    }));

  const key = (el, k) => {
    const code = { ' ': 'Space', Enter: 'Enter' }[k] || k;
    const keyCode = { ' ': 32, Enter: 13, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[k];
    for (const type of ['keydown', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: k, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true
      }));
    }
  };

  // Tries a mouse drag, then HTML5 drag-and-drop, then the keyboard controls
  // (Space to grab, arrows to move, Space to drop). Returns the method that worked.
  const drag = async (item, target, moved, containers) => {
    const from = center(item);
    const to = center(target);
    fire(item, 'pointerdown', from, PointerEvent);
    fire(item, 'mousedown', from);
    for (let i = 1; i <= 15; i++) {
      const p = { x: from.x + (to.x - from.x) * i / 15, y: from.y + (to.y - from.y) * i / 15 };
      const over = document.elementFromPoint(p.x, p.y) || document;
      fire(over, 'pointermove', p, PointerEvent);
      fire(over, 'mousemove', p);
      await sleep(16);
    }
    const drop = document.elementFromPoint(to.x, to.y) || target;
    fire(drop, 'pointerup', to, PointerEvent);
    fire(drop, 'mouseup', to);
    if (await waitFor(moved, 1000)) return 'mouse';

    const dataTransfer = new DataTransfer();
    fire(item, 'dragstart', from, DragEvent, { dataTransfer });
    fire(target, 'dragenter', to, DragEvent, { dataTransfer });
    fire(target, 'dragover', to, DragEvent, { dataTransfer });
    fire(target, 'drop', to, DragEvent, { dataTransfer });
    fire(item, 'dragend', to, DragEvent, { dataTransfer });
    if (await waitFor(moved, 1000)) return 'html5';

    // Keyboard: assume each arrow press moves one container in page order.
    const steps = containers.indexOf(target) - containers.indexOf(item.closest('.zb-sortable-container'));
    for (const [fwd, back] of [['ArrowDown', 'ArrowUp'], ['ArrowRight', 'ArrowLeft']]) {
      item.focus();
      key(item, ' ');
      await sleep(100);
      for (let i = 0; i < Math.abs(steps); i++) {
        key(document.activeElement || item, steps > 0 ? fwd : back);
        await sleep(100);
      }
      key(document.activeElement || item, ' ');
      if (await waitFor(moved, 1000)) return 'keyboard ' + fwd;
    }
    return null;
  };

  const payloads = findTodo('.definition-match-payload');
  log(`matching: found ${payloads.length} activity(s) in ${location.href}`);
  for (const payload of payloads) {
    const bankTerm = () => payload.querySelector('.term-bank .definition-match-term');
    const termById = (id) => payload.querySelector(`.definition-match-term[data-id="${id}"]`);
    const isIn = (id, container) => () => termById(id)?.closest('.zb-sortable-container') === container;
    const result = (row) => row.querySelector('.definition-match-explanation');
    const isCorrect = (row) => result(row).classList.contains('correct');
    const rows = [...payload.querySelectorAll('.definition-row')];
    const containers = () => [...payload.querySelectorAll('.zb-sortable-container')];

    payload.scrollIntoView({ block: 'center' });
    // Take the first term in the bank and try it in each open slot until it's
    // correct, then do the same with the next term.
    let term;
    while ((term = bankTerm())) {
      const id = term.dataset.id;
      for (const row of rows.filter((r) => !isCorrect(r))) {
        // It may have landed correctly somewhere else (e.g. keyboard overshoot).
        if (rows.some((r) => isCorrect(r) && r.contains(termById(id)))) break;
        const bucket = row.querySelector('.term-bucket');
        const method = await drag(termById(id), bucket, isIn(id, bucket), containers());
        await waitFor(() => /\b(in)?correct\b/.test(result(row).className), 3000);
        log(`term "${termById(id)?.textContent.trim()}" -> "${row.querySelector('.definition').textContent.trim()}":`,
          method ? `moved via ${method}, ${isCorrect(row) ? 'correct' : 'not correct'}` : 'could not move it');
        await pause();
        if (isCorrect(row)) break;
      }
      // Stop if the term never left the bank, so we don't loop forever.
      if (termById(id)?.closest('.term-bank')) {
        log('giving up: term could not be moved out of the bank');
        break;
      }
    }
    actions++;
  }

  return actions;
}

// Service workers can't play audio, so use a short-lived offscreen page.
async function playDoneSound() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Say "task completed" when the run finishes'
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg === 'sound-done') chrome.offscreen.closeDocument();
});

chrome.action.onClicked.addListener(async (tab) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: runActivities,
    args: [500, 1500]
  });
  const total = results.reduce((n, r) => n + (r.result || 0), 0);
  chrome.action.setBadgeText({ tabId: tab.id, text: String(total) });
  await playDoneSound();
});
