const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const speechSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'speech.js'), 'utf8');

// 假的瀏覽器語音辨識：由測試決定它送不送 onend、start 會不會丟例外
function loadSpeech(behavior = {}) {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); this.aborted = false; this.stopped = false; }
    start() {
      if (behavior.startThrows) throw new Error('InvalidStateError');
      this.started = true;
    }
    stop() {
      this.stopped = true;
      if (behavior.endOnStop) setTimeout(() => this.onend && this.onend(), 0);
    }
    abort() { this.aborted = true; }
  }
  const context = {
    URLSearchParams,
    window: { SpeechRecognition: FakeRecognition },
    DB: {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args)
  };
  vm.createContext(context);
  vm.runInContext(`${speechSource}\nthis.Speech = Speech;`, context);
  return { Speech: context.Speech, instances };
}

function recorder() {
  const calls = [];
  return {
    calls,
    handlers: {
      onResult: (r) => calls.push(['result', r.finalText || r.interimText]),
      onEnd: () => calls.push(['end']),
      onError: (e) => calls.push(['error', e.message])
    }
  };
}

test('瀏覽器正常送出 onend 時照常收尾', () => {
  const { Speech, instances } = loadSpeech();
  const { calls, handlers } = recorder();
  Speech.start(handlers);
  assert.equal(Speech.isListening(), true);
  instances[0].onend();
  assert.equal(Speech.isListening(), false);
  assert.deepEqual(calls.map(c => c[0]), ['end']);
});

test('start() 丟例外時不會卡在聆聽中，下一次可以重新開始', () => {
  const { Speech } = loadSpeech({ startThrows: true });
  const { calls, handlers } = recorder();
  Speech.start(handlers);
  assert.equal(Speech.isListening(), false);
  assert.equal(calls[0][0], 'error');
});

test('出錯後瀏覽器沒送 onend，也會自行收尾並回報錯誤', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  const { calls, handlers } = recorder();
  Speech.start(handlers);
  instances[0].onerror({ error: 'no-speech' });
  assert.equal(Speech.isListening(), true);
  t.mock.timers.tick(1500);
  assert.equal(Speech.isListening(), false);
  assert.deepEqual(calls, [['end'], ['error', 'no-speech']]);
});

test('按停止後瀏覽器一直不送 onend，保底計時會強制收尾', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  const { calls, handlers } = recorder();
  Speech.start(handlers);
  Speech.stop();
  assert.equal(instances[0].stopped, true);
  assert.equal(Speech.isListening(), true);
  t.mock.timers.tick(1500);
  assert.equal(Speech.isListening(), false);
  assert.deepEqual(calls, [['end']]);
});

test('聽太久沒有結束時會自動停止，不會一直空轉', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  const { calls, handlers } = recorder();
  Speech.start(handlers);
  t.mock.timers.tick(20000);
  assert.equal(instances[0].stopped, true);
  t.mock.timers.tick(1500);
  assert.equal(Speech.isListening(), false);
  assert.deepEqual(calls, [['end']]);
});

test('上一輪還沒收乾淨就開始新一輪：舊的被中止，且舊的遲到事件不影響新的一輪', () => {
  const { Speech, instances } = loadSpeech();
  const first = recorder();
  const second = recorder();
  Speech.start(first.handlers);
  Speech.start(second.handlers);
  assert.equal(instances[0].aborted, true);
  instances[0].onend();
  assert.equal(Speech.isListening(), true);
  assert.deepEqual(first.calls, []);
  instances[1].onend();
  assert.equal(Speech.isListening(), false);
  assert.deepEqual(second.calls.map(c => c[0]), ['end']);
});
