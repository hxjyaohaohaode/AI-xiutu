import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/lib/api.ts';
import {
  AuthCooldowns,
  AuthOperations,
  AuthRequestTimeoutError,
  AUTH_REQUEST_TIMEOUT_MS,
  authFieldForFailure,
  authFailureConsumedCode,
  authPayload,
  authResultUncertain,
  cooldownLabel,
  emptyAuthFields,
  normalizedAuthPhone,
  isAuthSession,
  isAuthOtpReceipt,
  retryAfterSeconds,
  validateAuthFields,
  withAuthDeadline,
} from '../src/account/auth-model.ts';

function manualDeadline() {
  let expire: () => void = () => assert.fail('deadline was not scheduled');
  let cancelled = false;
  return {
    schedule(callback: () => void, delay: number) {
      assert.equal(delay, AUTH_REQUEST_TIMEOUT_MS);
      expire = callback;
      return () => {
        cancelled = true;
      };
    },
    fire: () => expire(),
    get cancelled() {
      return cancelled;
    },
  };
}

test('phone guidance accepts the same domestic and E.164 formats while rejecting ambiguous numbers', () => {
  assert.equal(normalizedAuthPhone('13800138000'), '+8613800138000');
  assert.equal(normalizedAuthPhone('+86 138-0013-8000'), '+8613800138000');
  assert.equal(normalizedAuthPhone(' +1 (415) 555-0123 '), '+14155550123');
  assert.equal(normalizedAuthPhone('+442071234567'), '+442071234567');
  for (const invalid of [
    '4155550123',
    '+01234567890',
    '12800138000',
    '+1234567',
    '+1234567890123456',
    '13800138000 ext 1',
    '１３８００１３８０００',
  ])
    assert.equal(normalizedAuthPhone(invalid), null, invalid);
});

test('registration validates required invitation and whitespace; login retains its distinct password contract', () => {
  const fields = {
    ...emptyAuthFields(),
    phone: '13800138000',
    code: '123456',
    password: '1234567890',
    displayName: '  Lin  ',
  };
  assert.deepEqual(validateAuthFields(fields, 'register'), {});
  assert.equal(validateAuthFields(fields, 'register', true).inviteCode, '当前注册需要邀请码。');
  assert.ok(validateAuthFields({ ...fields, displayName: '   ' }, 'register').displayName);
  assert.ok(validateAuthFields({ ...fields, inviteCode: 'short' }, 'register').inviteCode);
  assert.ok(validateAuthFields({ ...fields, code: '12345a' }, 'otp').code);
  assert.ok(validateAuthFields({ ...fields, password: '123456789' }, 'reset').password);
  assert.deepEqual(validateAuthFields({ ...fields, password: 'x' }, 'password'), {});
  assert.deepEqual(validateAuthFields({ ...fields, password: '', displayName: '' }, 'otp'), {});
  assert.ok(validateAuthFields({ ...fields, password: 'a'.repeat(129) }, 'password').password);
});

test('each mode produces only its strict server payload and does not trim a password', () => {
  const fields = {
    phone: '13800138000',
    code: ' 123456 ',
    password: '  passphrase  ',
    displayName: ' Lin ',
    inviteCode: ' invitation-123 ',
  };
  assert.deepEqual(authPayload(fields, 'password'), {
    phone: '+8613800138000',
    password: '  passphrase  ',
  });
  assert.deepEqual(authPayload(fields, 'otp'), { phone: '+8613800138000', code: '123456' });
  assert.deepEqual(authPayload(fields, 'reset'), {
    phone: '+8613800138000',
    code: '123456',
    newPassword: '  passphrase  ',
  });
  assert.deepEqual(authPayload(fields, 'register'), {
    phone: '+8613800138000',
    code: '123456',
    password: '  passphrase  ',
    displayName: 'Lin',
    inviteCode: 'invitation-123',
  });
  assert.equal('inviteCode' in authPayload({ ...fields, inviteCode: '  ' }, 'register'), false);
  assert.throws(() => authPayload({ ...fields, phone: 'wrong' }, 'register'));
});

test('SMS cooldown uses an absolute deadline across purpose switches and equivalent phone formats', () => {
  const book = new AuthCooldowns();
  const time = 1_000_000;
  book.set('13800138000', 60, time);
  assert.equal(book.remaining('+86 138-0013-8000', time + 1001), 59);
  assert.equal(book.remaining('13900139000', time + 1001), 0);
  // A later, shorter response cannot release an earlier long rate limit.
  book.set('+8613800138000', 3600, time + 2000);
  book.set('13800138000', 60, time + 3000);
  assert.equal(book.remaining('13800138000', time + 3000), 3599);
  // A background tab waking much later must expire immediately, not tick down 3599 times.
  assert.equal(book.remaining('13800138000', time + 3_602_000), 0);
  assert.equal(book.remaining('13800138000', time + 3_602_001), 0);
});

test('authentication rate limits do not prevent entering an already delivered SMS code', () => {
  const book = new AuthCooldowns();
  book.set('13800138000', 60, 1000, 'sms');
  assert.equal(book.remaining('13800138000', 1000, 'submit'), 0);
  book.set('13800138000', 600, 1000, 'submit');
  assert.equal(book.remaining('13800138000', 61_000, 'sms'), 0);
  assert.equal(book.remaining('13800138000', 61_000, 'submit'), 540);
  book.set('13800138000', Number.NaN, 1000);
  book.set('13800138000', -1, 1000);
  assert.equal(book.remaining('13800138000', 61_000), 0);
});

test('a page-owned cooldown survives closing and reopening independent form owners without storing secrets', () => {
  const pageCooldowns = new AuthCooldowns();
  const firstForm = new AuthOperations();
  firstForm.mount();
  const send = firstForm.begin('sms')!;
  pageCooldowns.set('13800138000', 60, 1_000);
  firstForm.finish(send);
  firstForm.unmount();
  const reopenedForm = new AuthOperations();
  reopenedForm.mount();
  assert.equal(pageCooldowns.remaining('+8613800138000', 21_000), 40);
  assert.equal(reopenedForm.busy, false, 'cooldown survives, not a stale request lock');
  assert.equal(pageCooldowns.remaining('13800138000', 61_000), 0);
  assert.equal(
    new AuthCooldowns().remaining('13800138000', 21_000),
    0,
    'a new page has no persisted deadline',
  );
});

test('server retry metadata preserves long limits and untrusted malformed values do not become a timer', () => {
  assert.equal(
    retryAfterSeconds(new ApiError('RATE_LIMITED', 'wait', 429, { retryAfterSeconds: 86400 })),
    86400,
  );
  assert.equal(retryAfterSeconds(new ApiError('OTP_COOLDOWN', 'wait', 429)), 60);
  assert.equal(retryAfterSeconds({ details: { retryAfterSeconds: 1.2 } }), 2);
  for (const value of [undefined, null, '600', -1, Number.NaN, Infinity])
    assert.equal(retryAfterSeconds({ details: { retryAfterSeconds: value } }), null);
  assert.equal(cooldownLabel(59), '59 秒后重试');
  assert.equal(cooldownLabel(600), '10 分钟后重试');
  assert.equal(cooldownLabel(86400), '24 小时后重试');
});

test('lost success receipts remain unknown while definitive field failures stay actionable', () => {
  assert.equal(authResultUncertain(new ApiError('NETWORK_UNAVAILABLE', 'network', 0)), true);
  assert.equal(authResultUncertain(new ApiError('INTERNAL', 'server', 500)), true);
  assert.equal(authResultUncertain(new SyntaxError('invalid JSON')), true);
  assert.equal(authResultUncertain(new ApiError('INVALID_CREDENTIALS', 'invalid', 401)), false);
  assert.equal(
    authResultUncertain(new ApiError('REGISTRATION_UNAVAILABLE', 'existing', 409)),
    false,
  );
  assert.equal(authFieldForFailure(new ApiError('OTP_INVALID', 'invalid', 400)), 'code');
  assert.equal(authFieldForFailure(new ApiError('INVITE_REQUIRED', 'invite', 400)), 'inviteCode');
  assert.equal(authFieldForFailure(new ApiError('INVALID_CREDENTIALS', 'invalid', 401)), null);
});

test('unmount aborts an in-flight request; its late finally cannot release a newer operation', () => {
  const owner = new AuthOperations();
  assert.equal(owner.begin('sms'), null);
  owner.mount();
  const previous = owner.begin('sms')!;
  assert.equal(owner.begin('submit'), null, 'only one authenticated form operation at a time');
  assert.equal(owner.owns(previous), true);
  owner.unmount();
  assert.equal(previous.controller.signal.aborted, true);
  assert.equal(owner.owns(previous), false);
  owner.mount();
  const current = owner.begin('submit')!;
  assert.notEqual(previous.generation, current.generation);
  assert.equal(owner.finish(previous), false);
  assert.equal(owner.busy, true);
  assert.equal(owner.owns(current), true);
  assert.equal(owner.finish(current), true);
  assert.equal(owner.finish(current), false, 'success cannot be accepted twice');
  assert.equal(owner.busy, false);
});

test('a stalled auth request times out as unknown without aborting the owner that must release the form', async () => {
  const owner = new AuthOperations();
  owner.mount();
  const operation = owner.begin('submit')!;
  const deadline = manualDeadline();
  let requestSignal!: AbortSignal;
  let resolveLate!: (value: string) => void;
  const waiting = withAuthDeadline(
    operation,
    (signal) => {
      requestSignal = signal;
      // Deliberately ignore abort: the deadline must still release the waiter.
      return new Promise<string>((resolve) => {
        resolveLate = resolve;
      });
    },
    deadline.schedule,
  );
  await Promise.resolve();
  deadline.fire();
  await assert.rejects(waiting, (error) => {
    assert.ok(error instanceof AuthRequestTimeoutError);
    assert.equal(authResultUncertain(error), true);
    return true;
  });
  assert.equal(requestSignal.aborted, true);
  assert.equal(operation.controller.signal.aborted, false);
  assert.equal(owner.owns(operation), true, 'catch and finally still own the form');
  assert.equal(owner.finish(operation), true);
  assert.equal(owner.busy, false);
  assert.equal(deadline.cancelled, true);
  const current = owner.begin('session')!;
  resolveLate('late receipt');
  await Promise.resolve();
  deadline.fire();
  assert.equal(owner.owns(current), true, 'a late response cannot complete a new request');
  assert.equal(owner.finish(operation), false);
  owner.finish(current);
});

test('owner cancellation aborts only its request and an expired old timer cannot touch a remounted form', async () => {
  const owner = new AuthOperations();
  owner.mount();
  const previous = owner.begin('sms')!;
  const deadline = manualDeadline();
  let requestSignal!: AbortSignal;
  const waiting = withAuthDeadline(
    previous,
    (signal) => {
      requestSignal = signal;
      return new Promise<never>(() => {});
    },
    deadline.schedule,
  );
  await Promise.resolve();
  owner.unmount();
  owner.mount();
  const current = owner.begin('submit')!;
  await assert.rejects(
    waiting,
    (error) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(requestSignal.aborted, true);
  assert.equal(deadline.cancelled, true);
  deadline.fire();
  assert.equal(owner.finish(previous), false);
  assert.equal(owner.owns(current), true);
  assert.equal(current.controller.signal.aborted, false);
  owner.finish(current);
});

test('completed auth requests remove their deadline and owner listener while preserving definitive server errors', async () => {
  for (const failure of [null, new ApiError('RATE_LIMITED', 'wait', 429)]) {
    const owner = new AuthOperations();
    owner.mount();
    const operation = owner.begin('session')!;
    const deadline = manualDeadline();
    let requestSignal!: AbortSignal;
    let requests = 0;
    const waiting = withAuthDeadline(
      operation,
      async (signal) => {
        requests++;
        requestSignal = signal;
        if (failure) throw failure;
        return 'observed session';
      },
      deadline.schedule,
    );
    if (failure) await assert.rejects(waiting, (error) => error === failure);
    else assert.equal(await waiting, 'observed session');
    assert.equal(requests, 1, 'the deadline never retries a request');
    assert.equal(deadline.cancelled, true);
    deadline.fire();
    operation.controller.abort();
    assert.equal(
      requestSignal.aborted,
      false,
      'finished requests retain no active cancellation listener',
    );
    owner.unmount();
  }
});

test('malformed success receipts cannot become a signed-in or SMS-sent state', () => {
  const user = {
    id: '10000000-0000-4000-8000-000000000001',
    displayName: 'Lin',
    phoneMasked: '+86••••8000',
    isOperator: false,
    status: 'active',
  };
  const space = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Lin 的空间',
    kind: 'personal',
    role: 'owner',
  };
  assert.equal(isAuthSession({ user, spaces: [space], additiveServerField: true }), true);
  assert.equal(isAuthSession({ user: null, spaces: [] }), true);
  for (const response of [
    null,
    'ok',
    {},
    { user: true, spaces: [] },
    { user: null, spaces: [space] },
    { user: { ...user, id: 'invalid' }, spaces: [] },
    { user: { ...user, isOperator: 'true' }, spaces: [] },
    { user: { ...user, status: 'banned' }, spaces: [] },
    { user, spaces: [{ ...space, role: 'superuser' }] },
    { user, spaces: [space, space] },
  ])
    assert.equal(isAuthSession(response), false);
  assert.equal(isAuthOtpReceipt({ ok: true, message: 'submitted', expiresIn: 600 }), true);
  for (const response of [
    null,
    {},
    { ok: false, message: 'failed', expiresIn: 600 },
    { ok: true, expiresIn: 600 },
    { ok: true, message: 'submitted', expiresIn: -1 },
    { ok: true, message: 'submitted', expiresIn: '600' },
  ])
    assert.equal(isAuthOtpReceipt(response), false);
});

test('only definitive post-verification business failures explain a consumed OTP', () => {
  const failure = (code: string) => new ApiError(code, 'test', 400);
  assert.equal(authFailureConsumedCode('register', failure('INVITE_REQUIRED')), true);
  assert.equal(authFailureConsumedCode('register', failure('REGISTRATION_UNAVAILABLE')), true);
  assert.equal(authFailureConsumedCode('otp', failure('INVALID_CREDENTIALS')), true);
  assert.equal(authFailureConsumedCode('password', failure('INVALID_CREDENTIALS')), false);
  assert.equal(authFailureConsumedCode('reset', failure('RESET_UNAVAILABLE')), true);
  for (const mode of ['password', 'otp', 'register', 'reset'] as const) {
    assert.equal(authFailureConsumedCode(mode, failure('OTP_INVALID')), false);
    assert.equal(
      authFailureConsumedCode(mode, new ApiError('NETWORK_UNAVAILABLE', 'unknown', 0)),
      false,
    );
  }
});
