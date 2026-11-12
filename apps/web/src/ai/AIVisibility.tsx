import { createContext } from 'react';

/** Layout visibility never controls an in-flight request or a voice session. */
export const AIVisibilityContext = createContext(true);

export interface AIActivity {
  callActive: boolean;
  requestActive: boolean;
  /** Current local connection state; an unresolved receipt is not a live call. */
  callState: 'idle' | 'connecting' | 'active' | 'closing';
  muted: boolean;
  callVisible: boolean;
  /** Stable controls for the currently mounted voice owner. */
  onMute?: () => void;
  onEnd?: () => void;
  onResume?: (trigger?: HTMLElement) => void;
}

export const IDLE_AI_ACTIVITY: AIActivity = Object.freeze({
  callActive: false,
  requestActive: false,
  callState: 'idle',
  muted: false,
  callVisible: false,
});
