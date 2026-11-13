/** Dialogs share native focus/close semantics, not a single visual treatment. */
type Track = {
  family: 'settle' | 'slide';
  entryMs: number;
  exitMs: number;
  delayMs: number;
  blurPx: 0;
  x: number;
  y: number;
  scale: number;
  interactiveMs: number;
  pixelSafe: true;
};

function track(
  entryMs: number,
  exitMs: number,
  y: number,
  scale: number,
  interactiveMs: number,
  x = 0,
): Track {
  return {
    family: scale === 1 ? 'slide' : 'settle',
    entryMs,
    exitMs,
    delayMs: 0,
    blurPx: 0,
    x,
    y,
    scale,
    interactiveMs,
    pixelSafe: true,
  };
}

function motion(desktop: Track, tablet: Track, phone: Track) {
  return { ...desktop, tablet, phone };
}

/** Each size is the intended reading/work width, bounded again by the real viewport. */
export const modalProfiles = {
  form: {
    width: 420,
    tabletWidth: 400,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 14,
    mobile: 'center',
    backdropBlur: 1.5,
    motion: motion(
      track(220, 130, 8, 0.992, 100),
      track(205, 120, 6, 0.996, 90),
      track(195, 125, 14, 1, 75),
    ),
  },
  auth: {
    width: 420,
    tabletWidth: 400,
    padding: 22,
    tabletPadding: 18,
    phonePadding: 16,
    mobile: 'sheet',
    backdropBlur: 2,
    motion: motion(
      track(250, 155, 10, 0.994, 110),
      track(235, 145, 8, 0.997, 100),
      track(210, 140, 18, 1, 80),
    ),
  },
  account: {
    width: 800,
    tabletWidth: 720,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 14,
    mobile: 'sheet',
    backdropBlur: 1.5,
    motion: motion(
      track(260, 160, 9, 0.996, 105),
      track(240, 150, 7, 0.998, 95),
      track(220, 145, 20, 1, 80),
    ),
  },
  billing: {
    width: 880,
    tabletWidth: 740,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 1,
    motion: motion(
      track(245, 150, 7, 0.997, 100),
      track(230, 140, 6, 0.998, 90),
      track(205, 135, 16, 1, 75),
    ),
  },
  danger: {
    width: 380,
    tabletWidth: 360,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 14,
    mobile: 'center',
    backdropBlur: 2,
    motion: motion(
      track(180, 110, 3, 0.985, 90),
      track(170, 105, 2, 0.99, 80),
      track(165, 105, 3, 0.995, 70),
    ),
  },
  export: {
    width: 480,
    tabletWidth: 460,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 1,
    motion: motion(
      track(235, 145, 10, 0.995, 100),
      track(220, 135, 8, 0.997, 90),
      track(200, 130, 15, 1, 75),
    ),
  },
  drawing: {
    width: 1100,
    tabletWidth: 980,
    padding: 0,
    tabletPadding: 0,
    phonePadding: 0,
    mobile: 'canvas',
    backdropBlur: 0,
    motion: motion(
      track(240, 155, 6, 0.998, 0),
      track(225, 145, 4, 1, 0),
      track(200, 130, 8, 1, 0),
    ),
  },
  command: {
    width: 560,
    tabletWidth: 520,
    padding: 16,
    tabletPadding: 14,
    phonePadding: 10,
    mobile: 'sheet',
    backdropBlur: 2,
    motion: motion(
      track(175, 100, -5, 0.994, 75),
      track(165, 95, -4, 0.997, 70),
      track(180, 115, 12, 1, 65),
    ),
  },
  detail: {
    width: 680,
    tabletWidth: 640,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 1,
    motion: motion(
      track(230, 140, 6, 0.998, 95),
      track(215, 130, 5, 1, 85),
      track(195, 125, 13, 1, 75),
    ),
  },
  collaboration: {
    width: 720,
    tabletWidth: 660,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 1.5,
    motion: motion(
      track(255, 155, 8, 0.995, 105),
      track(235, 145, 7, 0.998, 95),
      track(215, 140, 17, 1, 80),
    ),
  },
  media: {
    width: 960,
    tabletWidth: 840,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 0,
    motion: motion(
      track(225, 135, 5, 1, 90),
      track(210, 125, 4, 1, 80),
      track(190, 120, 11, 1, 70),
    ),
  },
  navigation: {
    width: 420,
    tabletWidth: 400,
    padding: 18,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 1,
    motion: motion(
      track(195, 115, 4, 0.99, 85),
      track(185, 110, 3, 0.995, 75),
      track(185, 120, 14, 1, 70),
    ),
  },
  settings: {
    width: 480,
    tabletWidth: 460,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 1.5,
    motion: motion(
      track(215, 125, 6, 0.994, 95),
      track(200, 120, 5, 0.997, 85),
      track(195, 125, 15, 1, 75),
    ),
  },
  ai: {
    width: 560,
    tabletWidth: 520,
    padding: 20,
    tabletPadding: 16,
    phonePadding: 12,
    mobile: 'sheet',
    backdropBlur: 1,
    motion: motion(
      track(205, 120, 5, 0.996, 85),
      track(190, 115, 4, 0.998, 80),
      track(190, 120, 12, 1, 70),
    ),
  },
} as const;

export type ModalProfileName = keyof typeof modalProfiles;

/** Class matching is token-based: a class containing "auth" is not an auth dialog. */
export function resolveModalProfile(
  explicit: ModalProfileName | undefined,
  className: string,
  wide = false,
): ModalProfileName {
  if (explicit) return explicit;
  const classes = new Set(className.split(/\s+/));
  const matches: readonly [string, ModalProfileName][] = [
    ['drawing-modal', 'drawing'],
    ['auth-dialog', 'auth'],
    ['account-dialog', 'account'],
    ['billing-dialog', 'billing'],
    ['confirmation-dialog', 'danger'],
    ['export-dialog', 'export'],
    ['studio-command-modal', 'command'],
    ['usage-job-modal', 'billing'],
    ['team-dialog', 'collaboration'],
    ['share-dialog', 'collaboration'],
    ['asset-tools-dialog', 'media'],
    ['media-import-dialog', 'media'],
    ['media-source-dialog', 'media'],
    ['restoration-dialog', 'media'],
    ['workspace-settings-dialog', 'settings'],
    ['import-dialog', 'settings'],
    ['ai-options-dialog', 'ai'],
  ];
  return matches.find(([token]) => classes.has(token))?.[1] ?? (wide ? 'detail' : 'form');
}

export function modalMotionRole(profile: ModalProfileName): `modal-${ModalProfileName}` {
  return `modal-${profile}`;
}

/** App retains its outgoing dialog using exactly the same semantic profile. */
export function modalMotionRoleForDialog(dialog: string | null): `modal-${ModalProfileName}` {
  const profiles: Record<string, ModalProfileName> = {
    auth: 'auth',
    account: 'account',
    billing: 'billing',
    quota: 'billing',
    export: 'export',
    drawing: 'drawing',
    commands: 'command',
    settings: 'settings',
    importSettings: 'settings',
    teamSettings: 'collaboration',
    share: 'collaboration',
    mediaImport: 'media',
    conflict: 'danger',
    help: 'detail',
    photoTrash: 'detail',
  };
  return modalMotionRole(profiles[dialog ?? ''] ?? 'form');
}

export const modalMotionRegistry = {
  'modal-form': modalProfiles.form.motion,
  'modal-auth': modalProfiles.auth.motion,
  'modal-account': modalProfiles.account.motion,
  'modal-billing': modalProfiles.billing.motion,
  'modal-danger': modalProfiles.danger.motion,
  'modal-export': modalProfiles.export.motion,
  'modal-drawing': modalProfiles.drawing.motion,
  'modal-command': modalProfiles.command.motion,
  'modal-detail': modalProfiles.detail.motion,
  'modal-collaboration': modalProfiles.collaboration.motion,
  'modal-media': modalProfiles.media.motion,
  'modal-navigation': modalProfiles.navigation.motion,
  'modal-settings': modalProfiles.settings.motion,
  'modal-ai': modalProfiles.ai.motion,
} as const;

/** CSS and retained presence timers consume one definition, avoiding drift. */
export function modalProfileStyle(name: ModalProfileName): Record<string, string | number> {
  const profile = modalProfiles[name];
  const style: Record<string, string | number> = {
    '--profile-width': `${profile.width}px`,
    '--profile-tablet-width': `${profile.tabletWidth}px`,
    '--profile-padding': `${profile.padding}px`,
    '--profile-tablet-padding': `${profile.tabletPadding}px`,
    '--profile-phone-padding': `${profile.phonePadding}px`,
    '--profile-backdrop-blur': `${profile.backdropBlur}px`,
  };
  for (const [size, value] of [
    ['desktop', profile.motion],
    ['tablet', profile.motion.tablet],
    ['phone', profile.motion.phone],
  ] as const) {
    style[`--profile-${size}-entry`] = `${value.entryMs}ms`;
    style[`--profile-${size}-exit`] = `${value.exitMs}ms`;
    style[`--profile-${size}-x`] = `${value.x}px`;
    style[`--profile-${size}-y`] = `${value.y}px`;
    style[`--profile-${size}-scale`] = value.scale;
    style[`--profile-${size}-interact`] = `${value.interactiveMs}ms`;
  }
  return style;
}
