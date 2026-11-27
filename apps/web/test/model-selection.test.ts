import { strict as assert } from 'node:assert';
import test from 'node:test';
import { pickAssistantModel } from '../src/ai/model-selection.js';

test('pre-admission selection respects compatible preferences, image support, and published price', () => {
  const models = [
    { id: 'text', imageInput: false, points: 1 },
    { id: 'vision', imageInput: true, points: 5 },
    { id: 'economy', imageInput: true, points: 2 },
    { id: 'unquoted', imageInput: true, points: null },
  ];
  assert.equal(pickAssistantModel(models, ['text', 'vision'], true), 'vision');
  assert.equal(pickAssistantModel(models, ['text'], true), 'economy');
  assert.equal(pickAssistantModel(models, ['unquoted'], false), 'text');
  assert.equal(pickAssistantModel(models, ['vision'], false), 'vision');
  assert.equal(pickAssistantModel([], [], true), '');
});
