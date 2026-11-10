/** Small functional illustrations; they never represent generated or user media. */
export function ComposerVisual({
  kind,
}: {
  kind: 'assistant' | 'image' | 'text' | 'adjust' | 'voice';
}) {
  return (
    <svg
      className="composer-visual"
      width="64"
      height="48"
      viewBox="0 0 64 48"
      fill="none"
      aria-hidden="true"
    >
      {kind === 'image' ? (
        <>
          <rect
            x="11"
            y="7"
            width="42"
            height="34"
            rx="5"
            fill="var(--surface-secondary)"
            stroke="currentColor"
          />
          <circle cx="23" cy="18" r="4" fill="var(--accent)" />
          <path
            d="m14 36 12-11 8 7 7-15 10 19"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </>
      ) : kind === 'text' ? (
        <>
          <path
            d="M16 7h25l7 7v27H16V7Z"
            fill="var(--surface-secondary)"
            stroke="currentColor"
            strokeLinejoin="round"
          />
          <path
            d="M23 18h17M23 25h17M23 32h10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M23 32h10" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : kind === 'adjust' ? (
        <>
          <path d="M12 13h40M12 24h40M12 35h40" stroke="currentColor" strokeLinecap="round" />
          <circle cx="24" cy="13" r="4" fill="var(--surface)" stroke="currentColor" />
          <circle cx="41" cy="24" r="4" fill="var(--accent)" stroke="currentColor" />
          <circle cx="29" cy="35" r="4" fill="var(--surface)" stroke="currentColor" />
        </>
      ) : kind === 'voice' ? (
        <>
          <rect
            x="26"
            y="7"
            width="12"
            height="22"
            rx="6"
            fill="var(--surface-secondary)"
            stroke="currentColor"
          />
          <path
            d="M20 23a12 12 0 0 0 24 0M32 35v6m-6 0h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M30 13h4m-4 5h4" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path
            d="M13 10h38v25H28l-10 7v-7h-5V10Z"
            fill="var(--surface-secondary)"
            stroke="currentColor"
            strokeLinejoin="round"
          />
          <path
            d="M22 20h20M22 26h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="m49 5 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" fill="var(--accent)" />
        </>
      )}
    </svg>
  );
}
