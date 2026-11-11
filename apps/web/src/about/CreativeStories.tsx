import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  ArrowUpRight,
  ChatCircleDots,
  Check,
  Cursor,
  Desktop,
  DeviceMobile,
  DeviceTablet,
  Microphone,
  Pause,
  Play,
  SlidersHorizontal,
  UsersThree,
  LockSimple,
  GitBranch,
  CaretDown,
} from '@phosphor-icons/react';
import { ProductImage } from './AboutArt';
import { ScrollReveal } from './effects';
import type { EditorialCopy } from './editorial-copy';
import { useLocale } from '../i18n';
import { teamDeviceCopy, type TeamDemoRole } from './team-device-copy';
import './team-device-product.css';

function segmentKey(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  select: (index: number) => void,
) {
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  const next =
    event.key === 'ArrowRight'
      ? (index + 1) % count
      : event.key === 'ArrowLeft'
        ? (index + count - 1) % count
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? count - 1
            : null;
  if (next === null) return;
  event.preventDefault();
  select(next);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLButtonElement>(':scope > button')
    [next]?.focus({ preventScroll: true });
}

export function VoiceStory({ copy: c }: { copy: EditorialCopy }) {
  const [mode, setMode] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = root.current;
    if (!target || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(target);
    const hide = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  return (
    <section className="about-voice" aria-labelledby="voice-title" ref={root}>
      <ScrollReveal className="voice-copy">
        <span className="about-eyebrow">{c.voiceLabel}</span>
        <h2 id="voice-title">{c.voiceTitle}</h2>
        <p>{c.voiceBody}</p>
      </ScrollReveal>
      <div className="voice-illustration" data-mode={mode} data-playing={playing && visible}>
        <div className="voice-orbit" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>
            <Microphone size={30} weight="light" />
          </span>
        </div>
        <div
          className="voice-pill"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPlaying(false);
          }}
        >
          <button
            type="button"
            aria-pressed={playing}
            aria-label={playing ? c.voicePause : c.voicePlay}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
          </button>
          <div className="voice-wave" aria-hidden="true">
            {Array.from({ length: 32 }, (_, index) => (
              <i
                key={index}
                style={
                  {
                    '--bar-height': `${8 + Math.abs(Math.sin(index * 1.73)) * 26}px`,
                    '--bar-delay': `${index * -31}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <span className="voice-state-dot" aria-hidden="true" />
        </div>
        <div className="voice-transcript" aria-live="polite">
          <p key={mode}>{c.voiceLines[mode]}</p>
        </div>
        <div
          className="about-segment voice-modes"
          aria-label={c.voiceHint}
          style={{ '--selected': mode, '--segments': 3 } as CSSProperties}
        >
          {c.voiceModes.map((label, index) => (
            <button
              type="button"
              key={label}
              aria-pressed={mode === index}
              onClick={() => {
                setMode(index);
                setPlaying(index !== 2);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  const next = (mode + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                  setMode(next);
                  setPlaying(next !== 2);
                  (
                    event.currentTarget.parentElement?.children[next + 0] as
                      HTMLButtonElement | undefined
                  )?.focus();
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="about-caption">{c.voiceNote}</p>
      </div>
    </section>
  );
}

export function TeamStory({ copy: c, onOpen }: { copy: EditorialCopy; onOpen: () => void }) {
  const copy = teamDeviceCopy(useLocale());
  const [team, setTeam] = useState(true);
  const [member, setMember] = useState(0);
  const [version, setVersion] = useState(1);
  const [role, setRole] = useState<TeamDemoRole>('editor');
  const roleId = useId();
  const scene = copy.scenes[member]!;
  const revision = copy.versions[version - 1]!;
  // This is a public explanation of the existing roles, never an authorization check.
  const permissions = [
    { label: copy.edit, allowed: ['owner', 'admin', 'editor'].includes(role) },
    { label: copy.comment, allowed: role !== 'viewer' },
    { label: copy.invite, allowed: ['owner', 'admin'].includes(role) },
  ];
  return (
    <section className="about-team about-team-product" id="together" aria-labelledby="team-title">
      <ScrollReveal className="team-copy">
        <span className="about-eyebrow">{c.teamLabel}</span>
        <h2 id="team-title">{c.teamTitle}</h2>
        <p>{c.teamBody}</p>
        <div
          className="about-segment team-modes"
          role="group"
          aria-label={c.teamLabel}
          style={{ '--selected': team ? 1 : 0, '--segments': 2 } as CSSProperties}
        >
          {c.teamModes.map((label, index) => (
            <button
              type="button"
              key={label}
              aria-pressed={team === Boolean(index)}
              onClick={() => setTeam(Boolean(index))}
              onKeyDown={(event) => segmentKey(event, index, 2, (next) => setTeam(Boolean(next)))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="team-product-explanation" aria-live="polite">
          {[{ title: copy.personalTitle, body: copy.personalBody }, ...copy.scenes].map(
            (item, index) => (
              <div
                className="team-explanation-state"
                key={item.title}
                data-active={index === (team ? member + 1 : 0)}
                aria-hidden={index !== (team ? member + 1 : 0)}
              >
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ),
          )}
        </div>
        <div className="team-permission-stage" data-personal={!team}>
          <div className="team-role-field">
            <div className="team-role-select">
              <label htmlFor={roleId}>{copy.roleLabel}</label>
              <div className="team-role-control">
                <select
                  id={roleId}
                  value={role}
                  disabled={!team}
                  onChange={(event) => setRole(event.target.value as TeamDemoRole)}
                >
                  {(Object.keys(copy.roles) as TeamDemoRole[]).map((value) => (
                    <option key={value} value={value}>
                      {copy.roles[value]}
                    </option>
                  ))}
                </select>
                <CaretDown size={14} aria-hidden />
              </div>
            </div>
          </div>
          <ul className="team-permissions" aria-label={copy.roles[role]} aria-hidden={!team}>
            {permissions.map((permission) => (
              <li key={permission.label} data-allowed={permission.allowed}>
                {permission.allowed ? (
                  <Check size={15} aria-hidden />
                ) : (
                  <LockSimple size={14} aria-hidden />
                )}
                <span>{permission.label}</span>
                <small>{permission.allowed ? copy.allowed : copy.unavailable}</small>
              </li>
            ))}
          </ul>
          <p className="team-role-note" aria-live="polite">
            {team ? copy.roleNotes[role] : c.teamSolo}
          </p>
        </div>
        <button className="about-text-link" type="button" onClick={onOpen}>
          {c.agentOpen}
          <ArrowUpRight size={17} />
        </button>
      </ScrollReveal>
      <div
        className="team-visual team-product-visual"
        data-team={team}
        data-member={member}
        data-version={version}
        data-role={role}
      >
        <div className="team-visual-heading">
          <UsersThree size={18} />
          <span>{team ? scene.detail : c.teamSolo}</span>
          <small>{copy.teamDemo}</small>
        </div>
        <div className="team-product-canvas">
          <ProductImage name="local" alt={copy.imageAlt} />
          <div
            className="team-region-marker"
            aria-hidden="true"
            data-scene={member}
            data-visible={team}
          >
            <span>
              <Cursor size={16} weight="fill" />
              {scene.marker}
            </span>
          </div>
          <span className="team-current-version" aria-hidden>
            V{version}
          </span>
        </div>
        <div className="team-presence" role="group" aria-label={c.teamShared}>
          {c.teamMembers.map((name, index) => (
            <button
              type="button"
              key={name}
              disabled={!team}
              aria-pressed={team && member === index}
              onClick={() => setMember(index)}
              onKeyDown={(event) => segmentKey(event, index, 3, setMember)}
            >
              <span>
                {index === 0 ? (
                  <SlidersHorizontal size={16} />
                ) : index === 1 ? (
                  <Cursor size={16} />
                ) : (
                  <ChatCircleDots size={16} />
                )}
              </span>
              {name}
            </button>
          ))}
        </div>
        <div className="team-versions" role="group" aria-label={copy.versionsLabel}>
          {[1, 2, 3].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={version === value}
              aria-label={`${c.teamVersion} ${value}`}
              onClick={() => setVersion(value)}
              onKeyDown={(event) =>
                segmentKey(event, value - 1, 3, (index) => setVersion(index + 1))
              }
            >
              <span className="team-version-dot">
                {version === value ? <Check size={12} /> : value}
              </span>
              <span>
                <small>V{value}</small>
                {copy.versions[value - 1]!.name}
              </span>
            </button>
          ))}
        </div>
        <div className="team-version-detail" aria-live="polite">
          <span className="team-version-parent">
            <GitBranch size={15} />
            {revision.parent}
          </span>
          <div key={version}>
            <strong>{revision.action}</strong>
            <p>{revision.detail}</p>
          </div>
          <small>{copy.versionsLabel}</small>
        </div>
      </div>
    </section>
  );
}

export function DeviceStory({ copy: c }: { copy: EditorialCopy }) {
  const copy = teamDeviceCopy(useLocale());
  const [device, setDevice] = useState(0);
  const icons = [Desktop, DeviceTablet, DeviceMobile];
  return (
    <section className="about-devices about-devices-product" aria-labelledby="device-title">
      <ScrollReveal className="about-section-heading">
        <span className="about-eyebrow">06 / {c.deviceLabel}</span>
        <h2 id="device-title">{c.deviceTitle}</h2>
        <p>{c.deviceBody}</p>
      </ScrollReveal>
      <div
        className="about-segment device-modes"
        role="group"
        aria-label={c.deviceLabel}
        style={{ '--selected': device, '--segments': 3 } as CSSProperties}
      >
        {c.deviceModes.map((label, index) => {
          const Icon = icons[index]!;
          return (
            <button
              type="button"
              key={label}
              aria-pressed={device === index}
              onClick={() => setDevice(index)}
              onKeyDown={(event) => segmentKey(event, index, 3, setDevice)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <div className="device-composition device-product-stage" data-device={device}>
        <div
          className="device-desktop"
          data-active={device === 0}
          aria-hidden={device !== 0}
          inert={device !== 0}
        >
          <div className="device-chrome" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>STUDIO</span>
          </div>
          <ProductImage name="workspace" alt={copy.devices[0]!.alt} />
        </div>
        <div
          className="device-tablet"
          data-active={device === 1}
          aria-hidden={device !== 1}
          inert={device !== 1}
        >
          <span className="device-tablet-camera" aria-hidden />
          <ProductImage name="tablet" tablet alt={copy.devices[1]!.alt} />
        </div>
        <div
          className="device-phone"
          data-active={device === 2}
          aria-hidden={device !== 2}
          inert={device !== 2}
        >
          <div className="device-phone-speaker" aria-hidden="true" />
          <ProductImage name="phone" mobile alt={copy.devices[2]!.alt} />
        </div>
        <div className="device-floor" aria-hidden="true" />
      </div>
      <div className="device-workflow" aria-label={copy.deviceDetailLabel} aria-live="polite">
        {copy.devices.map((item, itemIndex) => (
          <div
            className="device-workflow-panel"
            key={item.title}
            data-active={device === itemIndex}
            aria-hidden={device !== itemIndex}
          >
            <div className="device-workflow-copy">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
            <ol>
              {item.steps.map((step, index) => (
                <li key={step}>
                  <span>0{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
