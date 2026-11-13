import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IdentificationCard, SealCheck, X } from '@phosphor-icons/react';
import { createDeferredFeature } from '../components/DeferredFeature';
import { IconButton } from '../components/Ui';
import type { LanyardProps } from '../components/react-bits/Lanyard';
import { t } from '../i18n';
import { brandLogoUrl, DEFAULT_BRAND } from '../lib/brand';
import type { PublicConfig } from '../lib/types';

const Lanyard = createDeferredFeature<LanyardProps>(
  () => import('../components/react-bits/Lanyard'),
  '挂绳名片',
  () => null,
);
const ReflectiveCard = lazy(() => import('../components/react-bits/ReflectiveCard'));

type Identity = { name: string; space?: string };
type LanyardIdentity = Identity & { brand?: PublicConfig['brand'] };

function cardFace(name: string, space: string, brand: string, logo: HTMLImageElement | null, back = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 900;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const paper = context.createLinearGradient(0, 0, 640, 900);
  paper.addColorStop(0, '#fcfcfb');
  paper.addColorStop(1, '#eeeeeb');
  context.fillStyle = paper;
  context.fillRect(0, 0, 640, 900);

  if (logo) {
    context.save();
    context.filter = 'grayscale(1)';
    context.globalAlpha = 0.25;
    context.drawImage(logo, 38, 38, 64, 64);
    context.globalAlpha = back ? 0.16 : 0.9;
    context.drawImage(logo, 160, 225, 320, 320);
    context.restore();
  }
  context.textAlign = 'right';
  context.fillStyle = '#515254';
  context.font = '400 28px system-ui, sans-serif';
  context.fillText(brand, 596, 83, 160);

  if (!back) {
    context.textAlign = 'center';
    context.fillStyle = '#161719';
    context.font = '600 64px system-ui, sans-serif';
    if (!logo) context.fillText(Array.from(name)[0] ?? '·', 320, 457);
  }
  context.textAlign = 'center';
  context.fillStyle = '#17181a';
  context.font = '600 48px system-ui, sans-serif';
  context.fillText(name, 320, back ? 668 : 708, 544);
  context.fillStyle = '#515254';
  context.font = '36px system-ui, sans-serif';
  context.fillText(space, 320, back ? 725 : 769, 544);
  return canvas.toDataURL();
}

function bandTexture(logo: HTMLImageElement | null) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = '#141414';
  context.fillRect(0, 0, 384, 128);
  context.fillStyle = '#ffffff12';
  for (let i = 0; i < 384; i += 3) context.fillRect(i, 0, 1, 128);
  for (let i = 0; i < 128; i += 4) context.fillRect(0, i, 384, 1);
  context.fillStyle = '#ffffff26';
  for (let i = 0; i < 384; i += 12) {
    context.fillRect(i, 7, 7, 2);
    context.fillRect(i, 119, 7, 2);
  }
  if (logo) {
    context.save();
    context.translate(192, 64);
    context.rotate(-Math.PI / 2);
    context.filter = 'grayscale(1)';
    context.drawImage(logo, -36, -36, 72, 72);
    context.restore();
  }
  return canvas.toDataURL();
}

export function AccountIdentityCard({ name, space }: Identity) {
  const workspace = space || t('暂无可用空间');
  const details = (
    <div className="account-card-details">
      <span className="account-card-label"><SealCheck size={14} aria-hidden />{t('账号')}</span>
      <div className="account-card-person">
        <h3 title={name}>{name}</h3>
        <p title={workspace}>{workspace}</p>
      </div>
    </div>
  );
  return (
    <div className="account-reference-identity">
      <Suspense fallback={<div className="account-card-fallback">{details}</div>}>
        <ReflectiveCard width="100%" height="var(--account-card-height)" radius={11}
          intro={false} tiltStrength={8} theme="dark">
          {details}
        </ReflectiveCard>
      </Suspense>
    </div>
  );
}

function AccountLanyardScene({ name, space, brand }: LanyardIdentity) {
  const placement = useRef<HTMLDivElement>(null);
  const workspace = space || t('暂无可用空间');
  const brandName = brand?.name || DEFAULT_BRAND;
  const logoSrc = brandLogoUrl(brand) || '/brand-mark.svg';
  const [loadedLogo, setLoadedLogo] = useState<HTMLImageElement | null>(null);
  const logo = loadedLogo?.getAttribute('src') === logoSrc ? loadedLogo : null;
  const workspaceLabel = t('当前空间');
  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => setLoadedLogo(image);
    image.src = logoSrc;
    return () => { image.onload = null; };
  }, [logoSrc]);
  const faces = useMemo(() => ({
    front: cardFace(name, workspace, brandName, logo),
    back: cardFace(workspace, workspaceLabel, brandName, logo, true),
  }), [name, workspace, workspaceLabel, brandName, logo]);
  const strap = useMemo(() => bandTexture(logo), [logo]);

  return (
    <div className="account-lanyard-stage">
      <div ref={placement} className="account-lanyard-placement" aria-hidden>
        <div className="account-lanyard-static">
          {faces.front ? <img src={faces.front} alt="" /> : <strong>{name}</strong>}
        </div>
      </div>
      <span className="sr-only">{name} · {workspace}</span>
      <Lanyard
        frontImage={faces.front}
        backImage={faces.back}
        strapImage={strap}
        placementRef={placement}
        flipLabel={t('翻转挂绳名片')}
        size={0.52}
        strapLength={0.5}
        anchor="right"
        cardColor="#f7f7f5"
        strapColor="#141414"
        finish="glossy"
        metal="silver"
        damping={0.82}
        elasticity={0.4}
        breeze={0}
        intro={false}
      />
    </div>
  );
}

export function AccountLanyard({ name, space, brand }: LanyardIdentity) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={t('查看挂绳卡片')} className="account-lanyard-trigger"
        popoverTarget={id} aria-controls={id} aria-expanded={open}>
        <IdentificationCard size={18} aria-hidden />
        <span>{t('名片')}</span>
      </IconButton>
      <section id={id} popover="auto" className="account-lanyard-popover" aria-label={t('挂绳名片')}
        onToggle={(event) => setOpen(event.newState === 'open')}>
        <IconButton label={t('关闭窗口')} className="account-lanyard-close"
          popoverTarget={id} popoverTargetAction="hide">
          <X size={12} weight="bold" aria-hidden />
        </IconButton>
        {open && <AccountLanyardScene name={name} space={space} brand={brand} />}
      </section>
    </>
  );
}
