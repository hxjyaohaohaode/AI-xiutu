type CoverContext = {
  project: string | null;
  artwork: { id: string; projectId: string; assetId: string; headVersion: number } | null;
  base: { id: string; projectId: string } | undefined;
  actor: string | null;
  epoch: number;
  navigation: number;
  source: number;
  recipe: object;
};

export type CaptureProjectCover = () => Promise<{ imageDataUrl: string; assertCurrent: () => void }>;

export function projectCover(
  project: string | undefined,
  read: () => CoverContext,
  capture: () => Promise<string>,
): CaptureProjectCover | undefined {
  const initial = read();
  const { artwork, base } = initial;
  if (!project || !initial.actor || initial.project !== project || !artwork || !base ||
      artwork.projectId !== project || base.projectId !== project || artwork.assetId !== base.id)
    return undefined;

  const assertCurrent = () => {
    const next = read();
    if (next.actor !== initial.actor || next.epoch !== initial.epoch ||
        next.navigation !== initial.navigation || next.project !== project ||
        next.source !== initial.source || next.recipe !== initial.recipe ||
        next.artwork?.id !== artwork.id || next.artwork.headVersion !== artwork.headVersion ||
        next.artwork.assetId !== base.id || next.artwork.projectId !== project ||
        next.base?.id !== base.id || next.base.projectId !== project)
      throw new Error('共享期间画面已变化，请重新获取上下文。');
  };
  return async () => {
    assertCurrent();
    const imageDataUrl = await capture();
    assertCurrent();
    return { imageDataUrl, assertCurrent };
  };
}
