import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, ChatCircleDots, Check, Cursor, Desktop, DeviceMobile, DeviceTablet, Microphone, Pause, Play, SlidersHorizontal, UsersThree } from '@phosphor-icons/react';
import { EditorialImage, ProductImage } from './AboutArt';
import { ScrollReveal } from './effects';
import type { EditorialCopy } from './editorial-copy';

export function VoiceStory({ copy: c }: { copy: EditorialCopy }) {
  const [mode, setMode] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = root.current;
    if (!target || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(target);
    const hide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', hide);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  return <section className="about-voice" aria-labelledby="voice-title" ref={root}>
    <ScrollReveal className="voice-copy"><span className="about-eyebrow">{c.voiceLabel}</span><h2 id="voice-title">{c.voiceTitle}</h2><p>{c.voiceBody}</p></ScrollReveal>
    <div className="voice-illustration" data-mode={mode} data-playing={playing && visible}>
      <div className="voice-orbit" aria-hidden="true"><i /><i /><i /><span><Microphone size={30} weight="light" /></span></div>
      <div className="voice-pill" onKeyDown={event => { if (event.key === 'Escape') setPlaying(false); }}>
        <button type="button" aria-pressed={playing} aria-label={playing ? c.voicePause : c.voicePlay} onClick={() => setPlaying(value => !value)}>
          {playing ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}</button>
        <div className="voice-wave" aria-hidden="true">{Array.from({ length: 32 }, (_, index) => <i key={index}
          style={{ '--bar-height': `${8 + Math.abs(Math.sin(index * 1.73)) * 26}px`, '--bar-delay': `${index * -31}ms` } as CSSProperties} />)}</div>
        <span className="voice-state-dot" aria-hidden="true" />
      </div>
      <div className="voice-transcript" aria-live="polite"><p key={mode}>{c.voiceLines[mode]}</p></div>
      <div className="about-segment voice-modes" aria-label={c.voiceHint} style={{ '--selected': mode, '--segments': 3 } as CSSProperties}>
        {c.voiceModes.map((label, index) => <button type="button" key={label} aria-pressed={mode === index}
          onClick={() => { setMode(index); setPlaying(index !== 2); }} onKeyDown={event => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault();
              const next = (mode + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
              setMode(next); setPlaying(next !== 2);
              (event.currentTarget.parentElement?.children[next + 0] as HTMLButtonElement | undefined)?.focus();
            }
          }}>{label}</button>)}
      </div><p className="about-caption">{c.voiceNote}</p>
    </div>
  </section>;
}

export function TeamStory({ copy: c, onOpen }: { copy: EditorialCopy; onOpen: () => void }) {
  const [team, setTeam] = useState(true);
  const [member, setMember] = useState(0);
  const [version, setVersion] = useState(1);
  return <section className="about-team" id="together" aria-labelledby="team-title">
    <ScrollReveal className="team-copy"><span className="about-eyebrow">{c.teamLabel}</span><h2 id="team-title">{c.teamTitle}</h2><p>{c.teamBody}</p>
      <div className="about-segment team-modes" style={{ '--selected': team ? 1 : 0, '--segments': 2 } as CSSProperties}>
        {c.teamModes.map((label, index) => <button type="button" key={label} aria-pressed={team === Boolean(index)} onClick={() => setTeam(Boolean(index))}>{label}</button>)}
      </div><ul className="team-notes">{c.teamNotes.map((note, index) => <li key={note} data-active={team && member === index}>
        <button type="button" onClick={() => { setTeam(true); setMember(index); }} onPointerEnter={event => { if (event.pointerType === 'mouse' && team) setMember(index); }}>
          <span>0{index + 1}</span>{note}<ArrowUpRight size={16} /></button></li>)}</ul>
      <button className="about-text-link" type="button" onClick={onOpen}>{c.agentOpen}<ArrowUpRight size={17} /></button>
    </ScrollReveal>
    <div className="team-visual" data-team={team} data-member={member} data-version={version}>
      <EditorialImage name="team-studio" alt={c.teamAlt} />
      <div className="team-visual-heading"><UsersThree size={18} /><span>{team ? c.teamShared : c.teamSolo}</span></div>
      <div className="team-selection" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="team-cursors" aria-hidden={!team}>{c.teamMembers.map((name, index) => <div className={`team-cursor cursor-${index}`} key={name} data-active={member === index}>
        <Cursor size={22} weight="fill" /><span>{name}</span></div>)}</div>
      <div className="team-presence" aria-label={c.teamShared}>
        {c.teamMembers.map((name, index) => <button type="button" key={name} disabled={!team} aria-pressed={team && member === index}
          onClick={() => setMember(index)} onFocus={() => setMember(index)}><span>{index === 0 ? <SlidersHorizontal size={16} /> : index === 1 ? <Cursor size={16} /> : <ChatCircleDots size={16} />}</span>{name}</button>)}
      </div>
      <div className="team-versions"><span>{c.teamVersion}</span>{[1, 2, 3].map(value => <button type="button" key={value} aria-pressed={version === value}
        aria-label={`${c.teamVersion} ${value}`} onClick={() => setVersion(value)}>{version === value ? <Check size={13} /> : <i />}{value}</button>)}</div>
    </div>
  </section>;
}

export function DeviceStory({ copy: c }: { copy: EditorialCopy }) {
  const [device, setDevice] = useState(0);
  const icons = [Desktop, DeviceTablet, DeviceMobile];
  return <section className="about-devices" aria-labelledby="device-title">
    <ScrollReveal className="about-section-heading"><span className="about-eyebrow">06 / {c.deviceLabel}</span><h2 id="device-title">{c.deviceTitle}</h2><p>{c.deviceBody}</p></ScrollReveal>
    <div className="about-segment device-modes" style={{ '--selected': device, '--segments': 3 } as CSSProperties}>
      {c.deviceModes.map((label, index) => { const Icon = icons[index]!; return <button type="button" key={label} aria-pressed={device === index}
        onClick={() => setDevice(index)} onPointerEnter={event => { if (event.pointerType === 'mouse') setDevice(index); }}><Icon size={17} /><span>{label}</span></button>; })}
    </div>
    <div className="device-composition" data-device={device}>
      <div className="device-desktop"><div className="device-chrome" aria-hidden="true"><i /><i /><i /><span>STUDIO</span></div><ProductImage name="workspace" /></div>
      <div className="device-phone"><div className="device-phone-speaker" aria-hidden="true" /><ProductImage name="phone" mobile /></div>
      <div className="device-floor" aria-hidden="true" />
    </div>
  </section>;
}
