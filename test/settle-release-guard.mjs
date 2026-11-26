/**
 * 取消后额度归还时机守卫（core 侧）
 *
 * 背景：abort 只让调用方及时拿到 E_CANCELLED，pg.close() 并不中断已发出的
 * CDP 打印——Chrome 里的打印与关页还在吃内存。旧实现在 abort 后立刻归还额度，
 * 下一批就会在旧打印仍在占用时被准入放行（账面早于实际 = 超卖）；Pro 侧曾用
 * 「固定延迟 2 秒」估，但 2 秒与实际无关。现在由核心把在途打印的 settle 暴露
 * 出来，归还等到打印真正结束，另有上限兜底。
 *
 * 断言：
 *  ① 在途打印未结束前不归还（即使已经过了一段时间）
 *  ② 打印成功或失败（settle 两个方向）都归还
 *  ③ 打印挂死时到上限兜底归还（额度不会永久挂账）
 *  ④ release 只被调用一次（settle 与兜底竞态安全）
 *
 * 用法：node test/settle-release-guard.mjs
 */
import assert from 'node:assert';
import { releaseAfterSettle } from '../src/pdf.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 记账用的 release 闭包（同时验证幂等语义由调用方负责） */
function counter() {
  const fn = () => { fn.calls += 1; };
  fn.calls = 0;
  return fn;
}

// ---------- ① 未 settle 不归还 ----------
{
  let settle;
  const settled = new Promise((resolve) => { settle = resolve; });
  const release = counter();
  releaseAfterSettle(settled, release, 5000);
  await delay(120);
  assert.strictEqual(release.calls, 0, '在途打印未结束前不得归还额度');
  settle();
  await delay(20);
  assert.strictEqual(release.calls, 1, '打印 settle 后应归还');
}

// ---------- ② 两条 settle 路径都归还 ----------
{
  let settle;
  const settled = new Promise((_resolve, reject) => { settle = reject; });
  settled.catch(() => { });
  const release = counter();
  releaseAfterSettle(settled, release, 5000);
  await delay(20);
  assert.strictEqual(release.calls, 0, '前置：未 settle');
  settle(new Error('Target closed'));   // 打印以失败收尾同样是结束
  await delay(20);
  assert.strictEqual(release.calls, 1, '打印失败（页面被关/CDP 报错）也应归还');
}

// ---------- ③ 挂死时上限兜底 ----------
{
  const settled = new Promise(() => { });   // 永不 settle：模拟 CDP 打印挂到超时
  const release = counter();
  releaseAfterSettle(settled, release, 150);
  await delay(80);
  assert.strictEqual(release.calls, 0, '上限未到不得归还');
  await delay(160);
  assert.strictEqual(release.calls, 1, '到上限必须兜底归还，额度不得永久挂账');
}

// ---------- ④ 竞态下只归还一次 ----------
{
  let settle;
  const settled = new Promise((resolve) => { settle = resolve; });
  const release = counter();
  releaseAfterSettle(settled, release, 120);
  settle();
  await delay(200);   // settle 已归还；兜底计时器随后到期，不得再调一次
  assert.strictEqual(release.calls, 1, 'settle 与超时兜底竞态下不得重复归还');
}

console.log('[settle-release] 未 settle 不归还 / 两个方向都归还 / 超时兜底 / 不重复归还 全部断言通过');
