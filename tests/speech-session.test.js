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
      this.startCount = (this.startCount || 0) + 1;
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
  instances[0].onstart();
  t.mock.timers.tick(20000);
  assert.equal(instances[0].stopped, true);
  t.mock.timers.tick(1500);
  assert.equal(Speech.isListening(), false);
  assert.deepEqual(calls, [['end']]);
});

test('上一輪剛結束就再按麥克風，會等一小段間隔才真正開始，避免 iOS 直接 aborted', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  Speech.start(recorder().handlers);
  instances[0].onend();
  Speech.start(recorder().handlers);
  assert.equal(Speech.isListening(), true);
  assert.equal(instances[0].startCount, 1);
  t.mock.timers.tick(400);
  assert.equal(instances[0].startCount, 2);
});

test('間隔過後（久沒用）再按麥克風會立刻開始', () => {
  const { Speech, instances } = loadSpeech();
  Speech.start(recorder().handlers);
  assert.equal(instances[0].started, true);
  instances[0].onend();
});

test('上一輪乾淨結束後，下一輪重複使用同一個辨識器而不是重新建立', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  Speech.start(recorder().handlers);
  instances[0].onend();
  Speech.start(recorder().handlers);
  t.mock.timers.tick(400);
  assert.equal(instances.length, 1);
  instances[0].onend();
});

test('上一輪出過錯，下一輪改用全新的辨識器', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  Speech.start(recorder().handlers);
  instances[0].onerror({ error: 'aborted' });
  instances[0].onend();
  Speech.start(recorder().handlers);
  t.mock.timers.tick(400);
  assert.equal(instances.length, 2);
  instances[1].onend();
});

test('上一輪是被強制收尾的，下一輪改用全新的辨識器，舊的被中止', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  Speech.start(recorder().handlers);
  Speech.stop();
  t.mock.timers.tick(1500);
  assert.equal(instances[0].aborted, true);
  Speech.start(recorder().handlers);
  t.mock.timers.tick(400);
  assert.equal(instances.length, 2);
  instances[1].onend();
});

test('啟動後 6 秒都沒有任何開始或結果的死 session，會提早判定被中斷而不是轉到 20 秒', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Speech, instances } = loadSpeech();
  const { calls, handlers } = recorder();
  Speech.start(handlers);
  t.mock.timers.tick(5999);
  assert.equal(Speech.isListening(), true);
  t.mock.timers.tick(1);
  assert.equal(Speech.isListening(), false);
  assert.equal(instances[0].aborted, true);
  assert.deepEqual(calls, [['end'], ['error', 'aborted']]);
});

test('有收到 start 或結果的 session 不會被當成死 session', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const withStart = loadSpeech();
  withStart.Speech.start(recorder().handlers);
  withStart.instances[0].onstart();
  t.mock.timers.tick(6000);
  assert.equal(withStart.Speech.isListening(), true);
  withStart.instances[0].onend();

  const withResult = loadSpeech();
  withResult.Speech.start(recorder().handlers);
  withResult.instances[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: '午餐180' }], { isFinal: false })] });
  t.mock.timers.tick(6000);
  assert.equal(withResult.Speech.isListening(), true);
  withResult.instances[0].onend();
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
