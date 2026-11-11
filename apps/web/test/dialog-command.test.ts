import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { CommandMenu } from '../src/workspace/CommandMenu.tsx';
import { currentCommand, filterCommands, moveCommand } from '../src/workspace/command-model.ts';
import {
  modalMotionRoleForDialog,
  modalProfiles,
  modalProfileStyle,
  resolveModalProfile,
} from '../src/components/modal-profiles.ts';
import { motionProfile } from '../src/motion/registry.ts';
import { renderTestMarkup } from './support/render.ts';

const commands = [
  { id: 'save', label: '保存作品', description: '保存到当前项目', section: '作品', disabled: true },
  { id: 'curves', label: '曲线', description: '调整 RGB 曲线', section: '工具' },
  { id: 'export', label: '导出', description: '下载 PNG 图片', section: '作品', disabled: true },
  { id: 'help', label: '帮助', description: '查看使用说明', section: '工作台' },
] as const;

test('command keys skip unavailable endpoints, wrap and handle empty results', () => {
  assert.equal(moveCommand(commands, -1, 1), 1);
  assert.equal(moveCommand(commands, -1, -1), 3);
  assert.equal(moveCommand(commands, 1, 1), 3);
  assert.equal(moveCommand(commands, 3, 1), 1);
  assert.equal(moveCommand(commands, 1, -1), 3);
  assert.equal(moveCommand(commands, 3, -1), 1);
  assert.equal(moveCommand([], -1, 1), -1);
  assert.equal(moveCommand([commands[0], commands[2]], -1, -1), -1);
});

test('command selection follows identity across capability changes and result reorder', () => {
  assert.equal(currentCommand(commands, 'help'), 3);
  assert.equal(currentCommand([...commands].reverse(), 'help'), 0);
  assert.equal(currentCommand(commands, 'save'), 1);
  assert.equal(currentCommand([commands[0]], 'help'), -1);
  assert.equal(currentCommand(commands.slice(1, 3), 'help'), 0);
  assert.equal(
    currentCommand(
      commands.map((command) => ({ ...command, disabled: true })),
      'help',
    ),
    -1,
  );
});

test('command search combines plain Chinese and Latin terms without hiding blocked capabilities', () => {
  assert.deepEqual(
    filterCommands(commands, '  曲线 RGB ').map((command) => command.id),
    ['curves'],
  );
  assert.deepEqual(
    filterCommands(commands, 'png').map((command) => command.id),
    ['export'],
  );
  assert.deepEqual(filterCommands(commands, '没有这个工具'), []);
  assert.equal(filterCommands(commands, '  ').length, commands.length);
});

test('combobox points to a named available option and exposes a blocked action reason', () => {
  const markup = renderTestMarkup(
    createElement(CommandMenu, {
      commands: commands.map((command) => ({
        ...command,
        icon: null,
        run() {},
        disabledReason: command.disabled ? '先打开照片，再执行此操作' : undefined,
      })),
      onClose() {},
    }),
  );
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /aria-haspopup="listbox"/);
  const activeId = markup.match(/aria-activedescendant="([^"]+)"/)?.[1];
  assert.ok(activeId);
  const options = [...markup.matchAll(/<div[^>]*role="option"[^>]*>/g)].map((match) => match[0]);
  const active = options.find((option) => option.includes(`id="${activeId}"`));
  assert.ok(active);
  assert.match(active, /aria-label="曲线"/);
  assert.doesNotMatch(active, /aria-disabled="true"/);
  assert.match(markup, /先打开照片，再执行此操作/);
  assert.match(markup, /data-dialog-profile="command"/);
});

test('all unavailable results have no phantom active descendant or keyboard selection', () => {
  const markup = renderTestMarkup(
    createElement(CommandMenu, {
      commands: commands.map((command) => ({ ...command, disabled: true, icon: null, run() {} })),
      onClose() {},
    }),
  );
  assert.doesNotMatch(markup, /aria-activedescendant=/);
  assert.doesNotMatch(markup, /aria-selected="true"/);
  assert.match(markup, /这些操作当前不可用/);
});

test('dialog classification honors exact tokens and explicit intent, preserving canvas layout', () => {
  assert.equal(resolveModalProfile(undefined, 'studio-dialog auth-dialog'), 'auth');
  assert.equal(resolveModalProfile(undefined, 'not-auth-dialog'), 'form');
  assert.equal(resolveModalProfile(undefined, 'drawing-modal'), 'drawing');
  assert.equal(resolveModalProfile(undefined, 'asset-tools-dialog', true), 'media');
  assert.equal(resolveModalProfile(undefined, 'custom-detail', true), 'detail');
  assert.equal(resolveModalProfile('billing', 'account-dialog'), 'billing');
  assert.equal(modalProfiles.drawing.mobile, 'canvas');
  assert.equal(modalProfiles.danger.mobile, 'center');
});

test('dialog CSS motion and retention use the same profile while leaving photo pixels unblurred', () => {
  for (const dialog of [
    'auth',
    'account',
    'billing',
    'export',
    'commands',
    'drawing',
    'teamSettings',
  ]) {
    const role = modalMotionRoleForDialog(dialog);
    const profileName = role.slice(6) as keyof typeof modalProfiles;
    const style = modalProfileStyle(profileName);
    for (const [width, size] of [
      [1440, 'desktop'],
      [844, 'tablet'],
      [390, 'phone'],
    ] as const) {
      const selected = motionProfile(role, width);
      assert.equal(style[`--profile-${size}-entry`], `${selected.entryMs}ms`);
      assert.equal(style[`--profile-${size}-exit`], `${selected.exitMs}ms`);
      assert.equal(selected.blurPx, 0);
      assert.ok(selected.exitMs <= 170);
    }
  }
});
