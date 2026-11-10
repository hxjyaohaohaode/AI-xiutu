import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  Waveform,
  ArrowUp,
  Eye,
  MagnifyingGlass,
  Sparkle,
  Pause,
} from '@phosphor-icons/react';
import type {
  AssistantCandidate,
  AssistantContext,
  AssistantCitation,
  AssistantCloudResource,
  AssistantSearchEvidence,
  VoiceServerEvent,
  AssistantGrant,
  AssistantWorkspace,
  MemorySuggestion,
} from '@ai-xiutu/contracts';
import { assistantSearchEvidenceSchema } from '@ai-xiutu/contracts';
import { parseEditorRecipe, type EditorRecipe } from '@ai-xiutu/editor';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { Artwork, Project, Session, Space } from '../lib/types';
import { EditorVoiceClient } from './voiceClient';
import { appendCaption, type CaptionState, VoiceCaptions } from './VoiceCaptions';
import {
  acknowledgeEditCandidate,
  assistantEditorKey,
  assistantScopeKey,
  AssistantOperationGate,
  type AssistantEditorState,
  type AssistantOperationToken,
} from './assistantGuards';
import './live-assistant.css';
import { CreativeControls, initialCreativeSettings } from './CreativeControls';
import { observeAssistantTurn, type RunEvent } from './turnStream';
import { ContextEvidence } from './ContextEvidence';
import { MemoryControls } from './MemoryControls';
import { WorkspaceCards } from './WorkspaceCards';
import { CloudImageResults, SearchEvidence } from './SearchEvidence';

export type CaptureCurrentImage = () => Promise<AssistantContext & { imageDataUrl: string }>;
interface Model {
  id: string;
  label: string;
  operations: string[];
  unitCost: number;
  maxSeconds: number;
  maxDelegations: number;
  imageInput: boolean;
  webSearch: boolean;
  webImageSearch?: boolean;
  voice?: { voices: string[] } | null;
}
interface Catalog {
  ready: boolean;
  voiceReady: boolean;
  reason: string | null;
  models: Model[];
}
interface Turn {
  id: string;
  modelId?: string;
  conversationId?: string;
  state: string;
  stopRequested?: boolean;
  prompt?: string;
  output?: {
    text: string;
    citations: AssistantCitation[];
    search?: AssistantSearchEvidence[];
    candidates: AssistantCandidate[];
    workspace?: AssistantWorkspace;
    memorySuggestions?: MemorySuggestion[];
    execution?: {
      state: 'applied' | 'blocked' | 'review_required';
      code?: string;
      artworkId?: string;
      revisionId?: string;
    };
  };
  errorCode?: string;
}

function turnStatus(turn: Turn) {
  if (turn.state === 'unknown') return '本轮结果待核验，可以在用量记录中查看。';
  if (turn.state === 'stopped') return '本轮已停止。已完成的供应商调用可在用量记录中查看。';
  if (turn.state === 'unavailable') return '本轮引用的素材权限已变化。';
  return `本轮未完成（${turn.errorCode ?? turn.state}）`;
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: AssistantCitation[];
  search?: AssistantSearchEvidence[];
}
export interface LiveAssistantProps {
  project: Project | null;
  artwork: Artwork | null;
  recipe: EditorRecipe;
  isLoggedIn: boolean;
  onAuth: () => void;
  onSave: () => void;
  onPreview: (recipe: EditorRecipe) => void;
  imageModelIds: string[];
  onBeforeArtworkWrite?: () => void | Promise<void>;
  onAfterArtworkWrite?: () => void | Promise<void>;
  onApplied: (artworkId: string) => void | Promise<void>;
  onPrepareGenerationDraft: (draft: {
    executionGrantId?: string;
    candidateId: string;
    prompt: string;
    referenceAssetIds: string[];
  }) => Promise<(() => void) | null>;
  captureCurrentImage?: CaptureCurrentImage;
}
function editorState(value: LiveAssistantProps): AssistantEditorState {
  return {
    loggedIn: value.isLoggedIn,
    projectId: value.project?.id ?? null,
    spaceId: value.project?.spaceId ?? null,
    artworkId: value.artwork?.id ?? null,
    assetId: value.artwork?.assetId ?? null,
    version: value.artwork?.headVersion ?? null,
    recipe: value.recipe,
  };
}
export function LiveAssistant(props: LiveAssistantProps) {
  const {
    project,
    artwork,
    recipe,
    isLoggedIn,
    onAuth,
    onSave,
    onPrepareGenerationDraft,
    captureCurrentImage,
  } = props;
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [spaces, setSpaces] = useState<Space[]>([]);
  const [creative, setCreative] = useState(initialCreativeSettings);
  const [grant, setGrant] = useState<AssistantGrant | null>(null);
  const [contextManifest, setContextManifest] = useState<Record<string, any> | null>(null);
  const [workspace, setWorkspace] = useState<{
    spec: AssistantWorkspace;
    candidateIds: string[];
  } | null>(null);
  const freshConversation = useRef(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<
    { id: string; title: string; turnCount: number }[]
  >([]);
  const [memorySuggestions, setMemorySuggestions] = useState<{
    items: MemorySuggestion[];
    sourceTurnId?: string;
  }>({ items: [] });
  const streamText = useRef(new Map<string, string>());
  const activeGrant = useRef<AssistantGrant | null>(null);
  activeGrant.current = grant;
  const [modelId, setModelId] = useState(''),
    [voiceId, setVoiceId] = useState(''),
    [voice, setVoice] = useState('marin');
  const [mode, setMode] = useState<'text' | 'voice'>('voice'),
    [callState, setCallState] = useState<'idle' | 'connecting' | 'active' | 'closing'>('idle');
  const callPanel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (callState !== 'connecting') return;
    const scroll = callPanel.current?.closest('.ai-workbench');
    if (scroll) scroll.scrollTop = 0;
  }, [callState]);
  const [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [shareImage, setShareImage] = useState(false),
    [allowWebSearch, setAllowWebSearch] = useState(false),
    [memory, setMemory] = useState(false);
  const [publicQuery, setPublicQuery] = useState('');
  const [publicImages, setPublicImages] = useState(false);
  const [voiceCaptions, setVoiceCaptions] = useState<CaptionState>({});
  const [voiceSearchUsed, setVoiceSearchUsed] = useState(false);
  const [activeTurn, setActiveTurn] = useState<{ id: string; stopping: boolean } | null>(null);
  const [spaceIds, setSpaceIds] = useState<string[]>(project ? [project.spaceId] : []),
    [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [resourceQuery, setResourceQuery] = useState(''),
    [resources, setResources] = useState<AssistantCloudResource[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [messages, setMessages] = useState<Message[]>([]),
    [candidates, setCandidates] = useState<AssistantCandidate[]>([]);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [parentTurnId, setParentTurnId] = useState<string | undefined>(),
    [muted, setMuted] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const [toolStatus, setToolStatus] = useState(''),
    [contextStatus, setContextStatus] = useState('未共享画面');
  const voiceEpoch = useRef(0),
    voiceEnding = useRef(false),
    voiceCanvas = useRef<{ accepted: string; pending?: { key: string; tag: string } }>({
      accepted: '',
    }),
    turnAbort = useRef<AbortController | null>(null);
  const client = useRef<EditorVoiceClient | null>(null),
    current = useRef(props),
    alive = useRef(true);
  const requests = useRef(new AssistantOperationGate()),
    searches = useRef(new AssistantOperationGate());
  const searchAbort = useRef<{
    token: AssistantOperationToken;
    controller: AbortController;
  } | null>(null);
  current.current = props;
  const requestScope = assistantScopeKey(editorState(props));
  requests.current.setScope(requestScope);
  const voiceScope = useRef(requestScope);
  if (voiceScope.current !== requestScope) {
    voiceScope.current = requestScope;
    voiceEpoch.current++;
  }
  const searchScope = JSON.stringify([requestScope, [...spaceIds].sort(), resourceQuery]);
  searches.current.setScope(searchScope);
  function requestIsActive(token: AssistantOperationToken) {
    return (
      alive.current &&
      requests.current.owns(token) &&
      assistantScopeKey(editorState(current.current)) === token.scope
    );
  }
  function searchIsActive(token: AssistantOperationToken) {
    return (
      alive.current &&
      searches.current.owns(token) &&
      assistantScopeKey(editorState(current.current)) === requestScope
    );
  }
  const models = catalog?.models.filter((item) => item.operations.includes('assistant-turn')) ?? [];
  const voices = catalog?.models.filter((item) => item.operations.includes('realtime-voice')) ?? [];
  const selected = models.find((item) => item.id === modelId),
    selectedVoice = voices.find((item) => item.id === voiceId);
  const voiceOptions = selectedVoice?.voice?.voices ?? [];
  useEffect(() => {
    if (voiceOptions.length && !voiceOptions.includes(voice)) setVoice(voiceOptions[0]!);
  }, [voiceId, voiceOptions.join(','), voice]);
  const inCall = callState !== 'idle';
  useEffect(() => {
    alive.current = true;
    if (!isLoggedIn) return;
    const controller = new AbortController();
    void Promise.all([
      api<Catalog>('/assistant/models', { signal: controller.signal }),
      api<Session>('/session', { signal: controller.signal }),
    ])
      .then(([value, session]) => {
        if (controller.signal.aborted) return;
        setCatalog(value);
        setSpaces(session.spaces);
        setModelId((old) =>
          value.models.some((item) => item.id === old && item.operations.includes('assistant-turn'))
            ? old
            : (value.models.find((item) => item.operations.includes('assistant-turn'))?.id ?? ''),
        );
        setVoiceId((old) =>
          value.models.some((item) => item.id === old && item.operations.includes('realtime-voice'))
            ? old
            : (value.models.find((item) => item.operations.includes('realtime-voice'))?.id ?? ''),
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      });
    return () => {
      controller.abort();
    };
  }, [isLoggedIn]);
  useEffect(() => {
    voiceEpoch.current++;
    voiceEnding.current = true;
    client.current?.end();
    client.current = null;
    turnAbort.current?.abort();
    turnAbort.current = null;
    requests.current.invalidate();
    searches.current.invalidate();
    searchAbort.current?.controller.abort();
    searchAbort.current = null;
    setBusy(false);
    setError('');
    setCallState('idle');
    setMuted(false);
    setShareImage(false);
    setAllowWebSearch(false);
    setPublicQuery('');
    setPublicImages(false);
    setActiveTurn(null);
    setContextStatus('未共享画面');
    setSpaceIds(project ? [project.spaceId] : []);
    setReferenceIds([]);
    setResources([]);
    setParentTurnId(undefined);
    setConversationId(undefined);
    setConversations([]);
    setGrant(null);
    setContextManifest(null);
    setWorkspace(null);
    setMemorySuggestions({ items: [] });
    streamText.current.clear();
    freshConversation.current = false;
    setCreative(initialCreativeSettings());
    setMessages([]);
    setVoiceCaptions({});
    setCandidates([]);
    if (!isLoggedIn) {
      setCatalog(null);
      setSpaces([]);
    }
  }, [project?.id, project?.spaceId, isLoggedIn]);
  useEffect(() => {
    const pending = searchAbort.current;
    if (pending && !searches.current.owns(pending.token)) {
      pending.controller.abort();
      searchAbort.current = null;
    }
    if (!resourceQuery.trim() || !project || !isLoggedIn || inCall || !spaceIds.length) return;
    const timer = setTimeout(() => void search(), 280);
    return () => clearTimeout(timer);
  }, [searchScope, inCall]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!isLoggedIn || !project) return;
      try {
        const catalog = await api<{ conversations: typeof conversations }>(
          `/projects/${project.id}/assistant-conversations`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setConversations(catalog.conversations);
        if (conversationId === undefined) {
          setConversationId(catalog.conversations[0]?.id ?? '');
          return;
        }
        if (!conversationId) return;
        const [{ turns }, savedCandidates] = await Promise.all([
          api<{ turns: Turn[] }>(
            `/projects/${project.id}/assistant-turns?conversationId=${conversationId}`,
            {
              signal: controller.signal,
            },
          ),
          api<{ candidates: AssistantCandidate[] }>(
            `/projects/${project.id}/assistant-candidates?conversationId=${conversationId}`,
            { signal: controller.signal },
          ),
        ]);
        if (
          controller.signal.aborted ||
          !alive.current ||
          assistantScopeKey(editorState(current.current)) !== requestScope
        )
          return;
        const complete = turns.filter((turn) => turn.state === 'completed');
        if (complete[0])
          setMemorySuggestions({
            items: complete[0].output?.memorySuggestions ?? [],
            sourceTurnId: complete[0].id,
          });
        if (complete[0]?.output?.workspace)
          setWorkspace({
            spec: complete[0].output.workspace,
            candidateIds: complete[0].output.candidates.map((item) => item.id),
          });
        if (!freshConversation.current) setParentTurnId((current) => current ?? complete[0]?.id);
        setMessages((old) => {
          const merged = new Map<string, Message>();
          for (const turn of [...turns].reverse()) {
            merged.set(`${turn.id}-u`, {
              id: `${turn.id}-u`,
              role: 'user',
              text: turn.prompt ?? '',
            });
            if (turn.state === 'running') continue;
            merged.set(turn.id, {
              id: turn.id,
              role: 'assistant',
              text: turn.state === 'completed' ? (turn.output?.text ?? '') : turnStatus(turn),
              citations: turn.output?.citations,
              search: turn.output?.search,
            });
          }
          for (const message of old) if (!merged.has(message.id)) merged.set(message.id, message);
          return [...merged.values()].slice(-60);
        });
        setCandidates((old) => {
          const merged = new Map(old.map((item) => [item.id, item]));
          for (const candidate of savedCandidates.candidates) merged.set(candidate.id, candidate);
          return [...merged.values()].slice(0, 50);
        });
        const running = turns.find((turn) => turn.state === 'running');
        if (running && !requests.current.busy) {
          if (running.modelId) setModelId(running.modelId);
          const token = requests.current.begin();
          if (token) {
            streamText.current.delete(running.id);
            setActiveTurn({ id: running.id, stopping: running.stopRequested === true });
            setBusy(true);
            void observeAssistantTurn<Turn>(running.id, controller.signal, (event) => {
              if (requestIsActive(token)) showRunEvent(event);
            })
              .then((result) => {
                if (requestIsActive(token)) {
                  if (result.state === 'completed') setParentTurnId(result.id);
                  setHistoryEpoch((old) => old + 1);
                }
              })
              .catch((error) => {
                if (!controller.signal.aborted && requestIsActive(token))
                  setError(errorMessage(error));
              })
              .finally(() => {
                if (requests.current.finish(token) && alive.current) {
                  setBusy(false);
                  setActiveTurn(null);
                }
              });
          }
        }
        if (running) timer = setTimeout(() => void load(), 1500);
      } catch (err) {
        if (
          !controller.signal.aborted &&
          alive.current &&
          assistantScopeKey(editorState(current.current)) === requestScope
        )
          setError(errorMessage(err));
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [project?.id, isLoggedIn, historyEpoch, conversationId]);
  useEffect(
    () => () => {
      alive.current = false;
      voiceEpoch.current++;
      voiceEnding.current = true;
      requests.current.invalidate();
      searches.current.invalidate();
      searchAbort.current?.controller.abort();
      turnAbort.current?.abort();
      client.current?.end();
    },
    [],
  );
  useEffect(() => {
    if (callState !== 'active') return;
    const interval = setInterval(() => setElapsed((old) => old + 1), 1000);
    return () => clearInterval(interval);
  }, [callState]);
  const getContext = async (): Promise<AssistantContext | undefined> => {
    const value = current.current;
    if (!value.artwork || !value.project) return undefined;
    if (shareImage) {
      if (!value.captureCurrentImage) throw new Error('当前画面尚未渲染完成，请稍后再共享。');
      return value.captureCurrentImage();
    }
    return {
      artworkId: value.artwork.id,
      assetId: value.artwork.assetId,
      expectedVersion: value.artwork.headVersion,
      recipe: parseEditorRecipe(value.recipe),
    };
  };
  const recipeSnapshot = JSON.stringify(recipe);
  useEffect(() => {
    if (callState !== 'active' || !artwork) return;
    const epoch = voiceEpoch.current,
      voiceClient = client.current,
      baseline = assistantEditorKey(editorState(current.current));
    if (voiceCanvas.current.accepted === baseline && !voiceCanvas.current.pending) return;
    if (voiceCanvas.current.accepted || voiceCanvas.current.pending) {
      voiceCanvas.current = { accepted: '' };
      voiceClient?.send({ type: 'context.invalidate' });
    }
    setContextStatus('画布已变化，等待同步');
    let cancelled = false;
    const active = () =>
      !cancelled &&
      alive.current &&
      !voiceEnding.current &&
      epoch === voiceEpoch.current &&
      voiceClient === client.current &&
      assistantEditorKey(editorState(current.current)) === baseline;
    const timer = setTimeout(() => {
      void getContext()
        .then((context) => {
          if (context && active()) {
            const tag = secureUuid();
            voiceCanvas.current.pending = { key: baseline, tag };
            voiceClient?.updateContext(context, tag);
            setContextStatus(shareImage ? '正在更新画面…' : '正在更新参数…');
          }
        })
        .catch((err) => {
          if (active()) setContextStatus(errorMessage(err));
        });
    }, 3200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    recipeSnapshot,
    callState,
    shareImage,
    captureCurrentImage,
    artwork?.id,
    artwork?.assetId,
    artwork?.headVersion,
    requestScope,
  ]);
  const scope = {
    spaceIds,
    referenceAssetIds: referenceIds,
    allowWebSearch: allowWebSearch && Boolean(selected?.webSearch),
    ...(allowWebSearch && selected?.webSearch && publicQuery.trim()
      ? {
          publicSearch: {
            query: publicQuery.trim(),
            kind: publicImages && selected.webImageSearch ? 'images' : 'text',
          },
        }
      : {}),
    usePersonalMemory: memory,
    creativeBrief: creative.brief,
    ...(grant ? { executionGrantId: grant.id } : {}),
  };
  async function authorize() {
    if (!project || !modelId) throw new Error('请先选择项目和思考模型');
    const scopeKey = requestScope;
    const result = await api<{ grant: AssistantGrant }>(
      `/projects/${project.id}/assistant-grants`,
      jsonRequest('POST', {
        mode: creative.mode,
        unitLimit: creative.unitLimit,
        stepLimit: creative.stepLimit,
        minutes: 30,
        allowedActions:
          creative.mode === 'suggest'
            ? ['assistant-turn', 'realtime-voice']
            : ['assistant-turn', 'realtime-voice', 'edit', 'generate-image'],
        modelIds: [...new Set([modelId, voiceId, ...props.imageModelIds].filter(Boolean))],
      }),
    );
    if (!alive.current || assistantScopeKey(editorState(current.current)) !== scopeKey) return null;
    activeGrant.current = result.grant;
    setGrant(result.grant);
    return result.grant;
  }
  async function requestScopeWithGrant() {
    let currentGrant = activeGrant.current;
    if (
      !currentGrant ||
      currentGrant.revokedAt ||
      new Date(currentGrant.expiresAt).getTime() <= Date.now()
    ) {
      if (creative.mode === 'auto') throw new Error('请先明确授权自动执行的范围与预算');
      currentGrant = await authorize();
    }
    if (!currentGrant) throw new Error('项目已切换，请重新发送');
    return { ...scope, executionGrantId: currentGrant.id };
  }
  async function refreshGrant() {
    const id = activeGrant.current?.id;
    if (!id) return;
    try {
      const result = await api<{ grant: AssistantGrant }>(`/assistant-grants/${id}`);
      if (alive.current && activeGrant.current?.id === id) setGrant(result.grant);
    } catch {
      /* Task results remain visible if a usage refresh is temporarily unavailable. */
    }
  }
  async function revokeGrant() {
    const id = activeGrant.current?.id;
    if (!id) return;
    if (inCall) endVoice();
    try {
      await api(`/assistant-grants/${id}`, jsonRequest('DELETE', {}));
      if (activeGrant.current?.id === id) {
        activeGrant.current = null;
        setGrant(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function explicitAuthorize() {
    const token = requests.current.begin();
    if (!token) return;
    setBusy(true);
    try {
      await authorize();
    } catch (err) {
      if (requestIsActive(token)) setError(errorMessage(err));
    } finally {
      if (requests.current.finish(token) && alive.current) setBusy(false);
    }
  }
  function receive(event: VoiceServerEvent) {
    if (!alive.current) return;
    if (voiceEnding.current && event.type !== 'closed' && event.type !== 'error') return;
    if (event.type === 'ready') {
      setCallState('active');
      setElapsed(0);
      setContextStatus(shareImage ? '当前画面已共享，调整后会更新' : '仅共享参数，未发送画面');
    }
    if (event.type === 'closed') {
      setCallState('idle');
      setMuted(false);
      setToolStatus('');
      if (event.state === 'unknown')
        setError('通话已停止，供应商最终状态待核验；系统不会自动重拨或重复扣额。');
    }
    if (event.type === 'error') setError(event.message);
    if (event.type === 'search-started') setVoiceSearchUsed(true);
    if (event.type === 'context') {
      const pending = voiceCanvas.current.pending;
      if (
        pending &&
        pending.tag === event.contextTag &&
        pending.key === assistantEditorKey(editorState(current.current))
      ) {
        voiceCanvas.current = { accepted: pending.key };
        setContextStatus(event.imageShared ? '画面已更新' : '参数已更新');
      }
    }
    if (event.type === 'tool')
      setToolStatus(
        event.state === 'running'
          ? `正在协作：${({ search_resources: '查找素材', describe_editor: '读取编辑参数', propose_edit: '准备参数候选', propose_curve: '准备曲线', draft_generation: '整理生图草案', consult_editor: '分析当前需求' } as Record<string, string>)[event.name] ?? event.name}`
          : '',
      );
    if (event.type === 'transcript') setVoiceCaptions((old) => appendCaption(old, event));
    if (event.type === 'assistant-result') {
      if (voiceCanvas.current.accepted !== assistantEditorKey(editorState(current.current))) return;
      setMemorySuggestions({ items: event.memorySuggestions ?? [] });
      setWorkspace(
        event.workspace
          ? { spec: event.workspace, candidateIds: event.candidates.map((item) => item.id) }
          : null,
      );
      setMessages((old) =>
        [
          ...old,
          {
            id: secureUuid(),
            role: 'assistant' as const,
            text: event.text,
            citations: event.citations,
            search: event.search,
          },
        ].slice(-40),
      );
      setCandidates((old) => [...event.candidates, ...old].slice(0, 30));
    }
  }
  async function startVoice() {
    if (!isLoggedIn || !project || !voiceId || !modelId || callState !== 'idle') return;
    const token = requests.current.begin();
    if (!token) return;
    const epoch = ++voiceEpoch.current;
    voiceEnding.current = false;
    setError('');
    setVoiceCaptions({});
    setVoiceSearchUsed(false);
    setCallState('connecting');
    const voiceIsActive = () =>
      alive.current &&
      epoch === voiceEpoch.current &&
      assistantScopeKey(editorState(current.current)) === token.scope;
    const voiceClient = new EditorVoiceClient(
      (event) => {
        if (voiceIsActive()) receive(event);
      },
      (message) => {
        if (voiceIsActive()) {
          setError(message);
          setCallState('idle');
        }
      },
    );
    client.current = voiceClient;
    const baseline = assistantEditorKey(editorState(current.current));
    try {
      await voiceClient.prepareMicrophone();
      if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
        voiceClient.dispose();
        return;
      }
      const context = await getContext();
      if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
        voiceClient.dispose();
        return;
      }
      const authorizedScope = await requestScopeWithGrant();
      if (!requestIsActive(token)) {
        voiceClient.dispose();
        return;
      }
      if (assistantEditorKey(editorState(current.current)) !== baseline)
        throw new Error('准备期间画布已变化，请确认当前画面后重新通话。');
      const session = await api<{ id: string; ticket: string; websocketPath: string }>(
        `/projects/${project.id}/voice-sessions`,
        jsonRequest('POST', {
          idempotencyKey: secureUuid(),
          modelId: voiceId,
          backendModelId: modelId,
          voice,
          context,
          scope: { ...authorizedScope, publicSearch: undefined },
        }),
      );
      if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
        voiceClient.dispose();
        return;
      }
      voiceCanvas.current = { accepted: baseline };
      voiceClient.connect(session.websocketPath, session.ticket);
    } catch (err) {
      voiceClient.dispose();
      if (requestIsActive(token) && epoch === voiceEpoch.current) {
        setCallState('idle');
        setError(errorMessage(err));
      }
    } finally {
      requests.current.finish(token);
    }
  }
  function endVoice() {
    voiceEnding.current = true;
    requests.current.invalidate();
    turnAbort.current?.abort();
    turnAbort.current = null;
    setBusy(false);
    if (callState === 'connecting') voiceEpoch.current++;
    setCallState(callState === 'connecting' ? 'idle' : 'closing');
    client.current?.end();
  }
  function searchDuringCall() {
    const query = publicQuery.trim();
    if (
      callState !== 'active' ||
      !selected?.webSearch ||
      !allowWebSearch ||
      !query ||
      voiceSearchUsed
    )
      return;
    setError('');
    client.current?.send({
      type: 'search',
      search: { query, kind: publicImages && selected.webImageSearch ? 'images' : 'text' },
    });
  }
  function showRunEvent(event: RunEvent) {
    if (event.type === 'text.delta' && typeof event.payload.delta === 'string') {
      const text = (streamText.current.get(event.runId) ?? '') + event.payload.delta;
      streamText.current.set(event.runId, text);
      setMessages((old) =>
        [
          ...old.filter((item) => item.id !== event.runId),
          {
            ...old.find((item) => item.id === event.runId),
            id: event.runId,
            role: 'assistant' as const,
            text,
          },
        ].slice(-60),
      );
    } else if (event.type === 'search.results') {
      const parsed = assistantSearchEvidenceSchema.safeParse(event.payload);
      if (!parsed.success) return;
      const evidence = parsed.data;
      setMessages((old) => {
        const message = old.find((item) => item.id === event.runId);
        return [
          ...old.filter((item) => item.id !== event.runId),
          {
            id: event.runId,
            role: 'assistant' as const,
            text: message?.text ?? '',
            search: [...(message?.search ?? []), evidence].slice(-16),
          },
        ].slice(-60);
      });
    } else if (event.type === 'run.stopping') {
      setActiveTurn({ id: event.runId, stopping: true });
      setToolStatus('已收到停止请求，正在核对已发送的请求');
    } else if (event.type.startsWith('tool.')) {
      const names: Record<string, string> = {
        describe_editor: '读取编辑参数',
        search_resources: '检索素材',
        public_search: '检索公开来源',
        propose_sequence: '组合编辑步骤',
        propose_retouch: '准备局部质感候选',
        propose_healing: '准备局部修复候选',
        propose_edit: '准备参数候选',
        propose_curve: '准备曲线',
        draft_generation: '整理生图要求',
        inspect_candidate: '渲染并检查真实候选图像',
        select_candidate: '确定本轮编辑方案',
        read_history: '回查原文',
        read_tool_result: '读取工具结果',
      };
      setToolStatus(
        `${names[event.payload.name] ?? '处理工具结果'} · ${{ 'tool.running': '进行中', 'tool.completed': '已完成', 'tool.failed': '未通过检查' }[event.type] ?? ''}`,
      );
    } else if (event.type === 'context.prepared') setContextManifest(event.payload);
  }
  async function submit() {
    if (requests.current.busy || !isLoggedIn || !project || !prompt.trim() || !modelId) return;
    if (
      mode === 'text' &&
      allowWebSearch &&
      selected?.webSearch &&
      !publicQuery.trim() &&
      !inCall
    ) {
      setError('请填写可发送给公开搜索的查询词，或取消公开检索。');
      return;
    }
    const text = prompt.trim();
    const userMessageId = secureUuid();
    setError('');
    setToolStatus('');
    setPrompt('');
    setMessages((old) => [...old, { id: userMessageId, role: 'user' as const, text }].slice(-40));
    if (callState === 'active') {
      client.current?.send({ type: 'text', text });
      return;
    }
    const token = requests.current.begin();
    if (!token) return;
    setBusy(true);
    const controller = new AbortController();
    turnAbort.current = controller;
    const baseline = assistantEditorKey(editorState(current.current));
    let writePrepared = false;
    try {
      const context = await getContext();
      if (!requestIsActive(token) || controller.signal.aborted) return;
      const authorizedScope = await requestScopeWithGrant();
      if (!requestIsActive(token) || controller.signal.aborted) return;
      if (creative.mode === 'auto') {
        await props.onBeforeArtworkWrite?.();
        writePrepared = true;
      }
      if (!requestIsActive(token) || controller.signal.aborted) return;
      if (assistantEditorKey(editorState(current.current)) !== baseline)
        throw new Error('准备期间画布已变化，请确认当前画面后重新发送。');
      let result = await api<Turn>(`/projects/${project.id}/assistant-turns`, {
        ...jsonRequest('POST', {
          idempotencyKey: secureUuid(),
          modelId,
          prompt: text,
          context,
          scope: authorizedScope,
          parentTurnId,
        }),
        signal: controller.signal,
      });
      if (requestIsActive(token))
        setMessages((old) =>
          old.map((message) =>
            message.id === userMessageId ? { ...message, id: `${result.id}-u` } : message,
          ),
        );
      if (result.state === 'running' && requestIsActive(token)) {
        setActiveTurn({ id: result.id, stopping: result.stopRequested === true });
        result = await observeAssistantTurn<Turn>(result.id, controller.signal, (event) => {
          if (requestIsActive(token)) showRunEvent(event);
        });
      }
      if (controller.signal.aborted || !requestIsActive(token)) return;
      setActiveTurn(null);
      if (result.state === 'completed' && result.output) {
        setMemorySuggestions({
          items: result.output.memorySuggestions ?? [],
          sourceTurnId: result.id,
        });
        setWorkspace(
          result.output.workspace
            ? {
                spec: result.output.workspace,
                candidateIds: result.output.candidates.map((item) => item.id),
              }
            : null,
        );
        streamText.current.delete(result.id);
        freshConversation.current = false;
        setParentTurnId(result.id);
        setConversationId(result.conversationId);
        setMessages((old) =>
          [
            ...old.filter((message) => message.id !== result.id),
            {
              id: result.id,
              role: 'assistant' as const,
              text: result.output!.text,
              citations: result.output!.citations,
              search: result.output!.search,
            },
          ].slice(-40),
        );
        setCandidates((old) => [...result.output!.candidates, ...old].slice(0, 30));
        if (result.output.execution?.state === 'applied') {
          if (
            result.output.execution.artworkId &&
            result.output.execution.artworkId === current.current.artwork?.id
          )
            await props.onApplied(result.output.execution.artworkId);
          setToolStatus('已自动保存新版本，可在历史中对比和恢复');
        } else if (result.output.execution) {
          const code = result.output.execution.code;
          setError(
            code === 'ALTERNATIVE_CANDIDATES'
              ? '本轮提出了多个备选方案，请选择预览后继续。'
              : code === 'CANDIDATE_REVIEW_REQUIRED'
                ? '本轮尚未完成对候选画面的检查，已保留方案，请预览确认。'
                : code === 'NATIVE_PIXEL_CHECK_REQUIRED'
                  ? '局部方案尚未通过原尺寸检查，已保留候选。可共享画面后重新检查，或先在画布预览。'
                  : code === 'MODEL_TURN_INCOMPLETE'
                    ? '模型未完成本轮核对，候选保留供查看。'
                    : code === 'AUTOMATIC_UNSAVED_BASE'
                      ? '本轮基于未保存参数，已保留候选，请先预览确认。'
                      : `自动修改已停止，候选已保留，请检查版本、占用或授权后继续。${code ?? ''}`,
          );
        }
      } else {
        streamText.current.delete(result.id);
        setMessages((old) => old.filter((item) => item.id !== result.id));
        setConversationId(result.conversationId);
        setHistoryEpoch((old) => old + 1);
        setError(turnStatus(result));
      }
    } catch (err) {
      if (!controller.signal.aborted && requestIsActive(token)) setError(errorMessage(err));
    } finally {
      if (writePrepared) {
        try {
          await props.onAfterArtworkWrite?.();
        } catch (err) {
          if (alive.current) setError(errorMessage(err));
        }
      }
      if (requests.current.finish(token) && alive.current) {
        setBusy(false);
        setActiveTurn(null);
      }
      if (turnAbort.current === controller) turnAbort.current = null;
      void refreshGrant();
    }
  }
  async function decide(
    candidate: AssistantCandidate,
    decision: 'previewed' | 'rejected',
    automatic = false,
  ) {
    if (!isLoggedIn || !project) return;
    const token = requests.current.begin();
    if (!token) return;
    setError('');
    setBusy(true);
    let appliedRevisionId: string | undefined;
    try {
      if (decision === 'previewed' && candidate.kind === 'edit') {
        if (automatic) await props.onBeforeArtworkWrite?.();
        let savedId: string | undefined;
        const applied = await acknowledgeEditCandidate(candidate, {
          readCurrent: () => editorState(current.current),
          isActive: () => requestIsActive(token),
          acknowledge: async (body) => {
            if (!automatic)
              return api(
                `/assistant-candidates/${candidate.id}/decision`,
                jsonRequest('POST', body),
              );
            const result = await api<{ artworkId: string; revisionId: string }>(
              `/assistant-candidates/${candidate.id}/apply`,
              jsonRequest('POST', { recipe: body.recipe, expectedVersion: body.expectedVersion }),
            );
            savedId = result.artworkId;
            appliedRevisionId = result.revisionId;
            return result;
          },
          apply: (next) => {
            if (!automatic) current.current.onPreview(next);
          },
        });
        if (!applied) return;
        if (automatic && savedId) {
          await props.onApplied(savedId);
          setToolStatus('已自动保存新版本，可在历史中对比和恢复');
        }
      } else {
        let commit: (() => void) | null = null;
        if (decision === 'previewed') {
          commit = await onPrepareGenerationDraft({
            executionGrantId: candidate.executionGrantId,
            candidateId: candidate.id,
            prompt: candidate.prompt ?? '',
            referenceAssetIds: candidate.referenceAssetIds ?? [],
          });
          if (!commit || !requestIsActive(token)) return;
        }
        await api(
          `/assistant-candidates/${candidate.id}/decision`,
          jsonRequest('POST', { decision }),
        );
        if (!requestIsActive(token)) return;
        commit?.();
      }
      if (!requestIsActive(token)) return;
      setCandidates((old) =>
        old.map((item) =>
          item.id === candidate.id
            ? { ...item, decision, ...(appliedRevisionId ? { appliedRevisionId } : {}) }
            : item,
        ),
      );
    } catch (err) {
      if (requestIsActive(token)) setError(errorMessage(err));
    } finally {
      requests.current.finish(token);
      try {
        if (automatic) await props.onAfterArtworkWrite?.();
      } catch (err) {
        if (alive.current) setError(errorMessage(err));
      }
      if (alive.current) setBusy(false);
      void refreshGrant();
    }
  }
  const autoAttempted = useRef(new Set<string>());
  const workspaceReady =
    workspace && workspace.candidateIds.every((id) => candidates.some((item) => item.id === id));
  const workspaceCandidateIds = new Set(
    workspaceReady
      ? workspace.spec.sections.flatMap((section) =>
          section.type === 'candidates'
            ? section.candidateIndices.map((index) => workspace.candidateIds[index])
            : [],
        )
      : [],
  );
  const remainingCandidates = candidates.filter(
    (item) =>
      !workspaceCandidateIds.has(item.id) &&
      (item.decision === 'pending' ||
        (item.kind === 'generation' && item.decision === 'previewed')),
  );
  useEffect(() => {
    if (creative.mode !== 'auto' || !grant || grant.revokedAt || busy || requests.current.busy)
      return;
    const candidate = candidates.find(
      (item) =>
        item.kind === 'edit' &&
        item.autoEligible !== false &&
        item.executionManagedBy !== 'server' &&
        item.executionGrantId === grant.id &&
        item.decision === 'pending' &&
        !autoAttempted.current.has(item.id),
    );
    if (!candidate) return;
    autoAttempted.current.add(candidate.id);
    void decide(candidate, 'previewed', true);
  }, [candidates, creative.mode, grant, busy]);
  function cancelSearch() {
    searches.current.invalidate();
    searchAbort.current?.controller.abort();
    searchAbort.current = null;
    setResources([]);
    setSearchStatus('');
  }
  function toggleReference(id: string) {
    setReferenceIds((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : old.length < 8 ? [...old, id] : old,
    );
  }
  async function stopActiveTurn() {
    if (!activeTurn || activeTurn.stopping) return;
    const id = activeTurn.id;
    const scope = requestScope;
    setActiveTurn({ id, stopping: true });
    try {
      const result = await api<{ state: string; stopRequested: boolean }>(
        `/assistant-turns/${id}/stop`,
        jsonRequest('POST', {}),
      );
      if (
        alive.current &&
        assistantScopeKey(editorState(current.current)) === scope &&
        result.stopRequested
      )
        setToolStatus('已停止后续动作，正在核对本轮状态');
    } catch (error) {
      if (alive.current && assistantScopeKey(editorState(current.current)) === scope) {
        setError(errorMessage(error));
        setActiveTurn((value) => (value?.id === id ? { id, stopping: false } : value));
      }
    }
  }
  async function search() {
    if (!isLoggedIn || !project || inCall || !spaceIds.length) return;
    searchAbort.current?.controller.abort();
    const token = searches.current.beginLatest(),
      controller = new AbortController();
    searchAbort.current = { token, controller };
    setSearchStatus('正在检索授权空间…');
    try {
      const result = await api<{ resources: AssistantCloudResource[] }>(
        `/projects/${project.id}/assistant-resources/search`,
        {
          ...jsonRequest('POST', { spaceIds, query: resourceQuery.trim(), limit: 20 }),
          signal: controller.signal,
        },
      );
      if (!searchIsActive(token) || controller.signal.aborted) return;
      setResources(result.resources);
      setSearchStatus(
        result.resources.length
          ? `显示 ${result.resources.length} 张图片`
          : '当前范围内没有匹配图片',
      );
    } catch (err) {
      if (searchIsActive(token) && !controller.signal.aborted) setSearchStatus(errorMessage(err));
    } finally {
      searches.current.finish(token);
      if (searchAbort.current?.controller === controller) searchAbort.current = null;
    }
  }
  if (!isLoggedIn)
    return (
      <div className="live-assistant empty">
        <Waveform size={32} />
        <p>与 AI 边说边创作，也可以继续打字交流。</p>
        <button className="button button-primary" onClick={onAuth}>
          登录后开始
        </button>
      </div>
    );
  const voicePanel = mode === 'voice' && (
    <div ref={callPanel} className={`assistant-call ${callState}`} data-assistant-motion="call">
      <div className="assistant-voice-orb" aria-hidden>
        <Waveform size={28} />
      </div>
      <div className="assistant-call-status" aria-live="polite">
        {callState === 'active'
          ? `正在通话 ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
          : callState === 'connecting'
            ? '正在连接麦克风与语音服务…'
            : callState === 'closing'
              ? '正在结束并核对用量…'
              : '说出想法，一起看图、找素材、调参数'}
        <small>
          {inCall
            ? contextStatus
            : selectedVoice
              ? `本次 ${selectedVoice.unitCost} 服务点 · 最长 ${selectedVoice.maxSeconds} 秒 · 最多 ${selectedVoice.maxDelegations} 次后端协作`
              : '由运营配置可用模型与额度'}
        </small>
      </div>
      {!inCall ? (
        <div className="assistant-call-start">
          <select
            aria-label="语音音色"
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
          >
            {voiceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            className="button button-primary"
            onClick={startVoice}
            disabled={!catalog?.voiceReady || !project || !selected || !selectedVoice}
          >
            <Microphone size={17} />
            开始实时通话
          </button>
        </div>
      ) : (
        <div className="assistant-call-actions">
          <button
            aria-label={muted ? '开启麦克风' : '静音麦克风'}
            aria-pressed={muted}
            disabled={callState !== 'active'}
            onClick={() => {
              client.current?.mute(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? <MicrophoneSlash size={20} /> : <Microphone size={20} />}
          </button>
          <button
            aria-label="打断播报"
            disabled={callState !== 'active'}
            onClick={() => client.current?.interrupt()}
          >
            <Pause size={20} />
          </button>
          <button
            className="end-call"
            aria-label="结束实时通话"
            disabled={callState === 'closing'}
            onClick={endVoice}
          >
            <PhoneDisconnect size={20} />
          </button>
        </div>
      )}
      {(inCall || voiceCaptions.user || voiceCaptions.assistant) && (
        <VoiceCaptions captions={voiceCaptions} />
      )}
      {callState === 'active' && allowWebSearch && selected?.webSearch && (
        <details className="assistant-voice-search">
          <summary>通话中公开搜索</summary>
          <form
            className="assistant-public-query"
            onSubmit={(event) => {
              event.preventDefault();
              searchDuringCall();
            }}
          >
            <label>
              可公开的查询词
              <input
                aria-label="通话公开检索查询词"
                value={publicQuery}
                maxLength={240}
                onChange={(event) => setPublicQuery(event.target.value)}
                placeholder="例如：静物柔光参考"
              />
            </label>
            {selected.webImageSearch && (
              <label>
                <input
                  type="checkbox"
                  checked={publicImages}
                  onChange={(event) => setPublicImages(event.target.checked)}
                />
                查找公开图片
              </label>
            )}
            <small>也可说「公开搜索：关键词」。本通话最多一次公开搜索，只发送查询词。</small>
            <button
              type="submit"
              className="button button-secondary"
              disabled={!publicQuery.trim() || !!toolStatus || voiceSearchUsed}
            >
              {voiceSearchUsed ? '本次已发起检索' : '搜索'}
            </button>
          </form>
        </details>
      )}
    </div>
  );
  return (
    <section
      className="live-assistant"
      data-in-call={inCall || undefined}
      aria-label="实时语音与智能体协作"
    >
      {inCall && voicePanel}
      <header className="assistant-mode" data-assistant-motion="mode">
        <button aria-pressed={mode === 'voice'} onClick={() => setMode('voice')}>
          实时对话
        </button>
        <button aria-pressed={mode === 'text'} disabled={inCall} onClick={() => setMode('text')}>
          文字协作
        </button>
      </header>
      <div className="assistant-models" data-assistant-motion="models">
        {mode === 'voice' && (
          <label>
            语音模型
            <select
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              disabled={inCall || !!grant}
            >
              <option value="">选择语音模型</option>
              {voices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          思考与工具模型
          <select
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={inCall || busy || !!grant}
          >
            <option value="">选择智能体模型</option>
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!catalog?.ready && (
        <p className="assistant-readiness" role="status">
          {catalog?.reason ?? '正在读取实际模型配置…'}
        </p>
      )}
      {!project && (
        <p className="assistant-readiness">
          请先建立或打开一个项目。<button onClick={onSave}>保存到项目</button>
        </p>
      )}
      <CreativeControls
        value={creative}
        onChange={setCreative}
        disabled={inCall || busy}
        grant={grant}
        onAuthorize={() => {
          void explicitAuthorize();
        }}
        onRevoke={() => {
          void revokeGrant();
        }}
      />
      <ContextEvidence turnId={parentTurnId} live={contextManifest} />
      {project && (
        <MemoryControls
          key={`${project.id}:${artwork?.id ?? ''}`}
          projectId={project.id}
          artworkId={artwork?.id}
          sourceTurnId={parentTurnId}
          disabled={busy || inCall}
          suggestions={memorySuggestions}
        />
      )}
      <button
        className="text-button"
        disabled={busy || inCall}
        onClick={() => {
          freshConversation.current = true;
          setConversationId('');
          setParentTurnId(undefined);
          setMessages([]);
          setCandidates([]);
          setContextManifest(null);
          setWorkspace(null);
          setMemorySuggestions({ items: [] });
        }}
      >
        开始新会话，保留已保存的历史
      </button>
      <label className="assistant-conversation-select">
        会话记录
        <select
          aria-label="会话记录"
          value={conversationId ?? ''}
          disabled={busy || inCall}
          onChange={(event) => {
            setConversationId(event.target.value);
            freshConversation.current = !event.target.value;
            setParentTurnId(undefined);
            setMessages([]);
            setCandidates([]);
            setWorkspace(null);
            setMemorySuggestions({ items: [] });
            setContextManifest(null);
            setError('');
          }}
        >
          <option value="">新会话</option>
          {conversations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {item.turnCount} 轮
            </option>
          ))}
        </select>
      </label>
      <details className="assistant-context" data-assistant-motion="context">
        <summary>
          <Eye size={15} /> 共享范围 · {shareImage ? '画面与参数' : '仅参数'}
          {allowWebSearch ? ' · 联网' : ''}
        </summary>
        <div className="assistant-context-options">
          <label>
            <input
              type="checkbox"
              checked={shareImage}
              disabled={inCall || !artwork || !selected?.imageInput}
              onChange={(event) => setShareImage(event.target.checked)}
            />
            共享当前预览，通话中编辑后持续更新
          </label>
          <label>
            <input
              type="checkbox"
              checked={allowWebSearch}
              disabled={inCall || !selected?.webSearch}
              onChange={(event) => setAllowWebSearch(event.target.checked)}
            />
            允许公开网络检索，保留来源链接
          </label>
          {mode === 'text' && allowWebSearch && selected?.webSearch && (
            <div className="assistant-public-query">
              <label>
                可公开的查询词
                <input
                  aria-label="公开检索查询词"
                  value={publicQuery}
                  maxLength={240}
                  disabled={inCall || busy}
                  onChange={(event) => setPublicQuery(event.target.value)}
                  placeholder="例如：复古产品静物布光参考"
                />
              </label>
              {selected.webImageSearch && (
                <label>
                  <input
                    type="checkbox"
                    checked={publicImages}
                    disabled={inCall || busy}
                    onChange={(event) => setPublicImages(event.target.checked)}
                  />
                  同时查找公开图片
                </label>
              )}
              <small>公开检索使用这里填写的查询词。共享画面和项目资料在编辑协作步骤中处理。</small>
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={memory}
              disabled={inCall}
              onChange={(event) => setMemory(event.target.checked)}
            />
            使用已确认的偏好、项目要求与素材标注
          </label>
          <fieldset disabled={inCall}>
            <legend>可搜索的空间</legend>
            {spaces.map((space) => (
              <label key={space.id}>
                <input
                  type="checkbox"
                  checked={spaceIds.includes(space.id)}
                  onChange={(event) => {
                    cancelSearch();
                    setSpaceIds((old) =>
                      event.target.checked
                        ? [...old, space.id]
                        : old.filter((id) => id !== space.id),
                    );
                    setReferenceIds([]);
                  }}
                />
                {space.name}
                <small>{space.kind === 'team' ? '团队' : '个人'}</small>
              </label>
            ))}
          </fieldset>
          <div className="assistant-resource-search">
            <input
              aria-label="搜索授权素材"
              value={resourceQuery}
              maxLength={200}
              onChange={(event) => {
                cancelSearch();
                setResourceQuery(event.target.value);
              }}
              disabled={inCall}
              placeholder="找一张以前用过的图片"
            />
            <button aria-label="查找素材" onClick={search} disabled={inCall || !spaceIds.length}>
              <MagnifyingGlass size={17} />
            </button>
          </div>
          {searchStatus && <p role="status">{searchStatus}</p>}
          {!!resources.length && (
            <CloudImageResults
              resources={resources}
              selected={referenceIds}
              disabled={inCall || busy}
              onSelect={toggleReference}
            />
          )}
          <p>
            检索只返回名称与标注；只有选中的 {referenceIds.length}{' '}
            张参考图和勾选的当前预览会发送给模型。
          </p>
        </div>
      </details>
      {!inCall && voicePanel}
      <div className="assistant-messages" aria-label="协作对话" data-assistant-motion="messages">
        {messages.map((message) => (
          <article key={message.id} className={`assistant-message ${message.role}`}>
            <small>{message.role === 'user' ? '你' : '创作助手'}</small>
            {message.text && <p>{message.text}</p>}
            {!!message.search?.length && (
              <SearchEvidence
                evidence={message.search}
                selected={referenceIds}
                disabled={inCall || busy}
                onSelect={toggleReference}
              />
            )}
            {!message.search?.some((item) => item.kind === 'web') &&
              !!message.citations?.length && (
                <div className="assistant-citations">
                  {message.citations.map((citation) => (
                    <a
                      key={citation.url}
                      href={/^https?:\/\//.test(citation.url) ? citation.url : undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {citation.title}
                    </a>
                  ))}
                </div>
              )}
          </article>
        ))}
      </div>
      {workspace && workspaceReady && (
        <WorkspaceCards
          spec={workspace.spec}
          candidates={workspace.candidateIds.map((id) =>
            candidates.find((item) => item.id === id)!,
          )}
          grant={grant}
          disabled={busy}
          canExecute={creative.mode !== 'suggest'}
          onDecision={(candidate, decision) => {
            void decide(candidate, decision);
          }}
          onPrompt={setPrompt}
        />
      )}
      {remainingCandidates.length > 0 && (
        <div className="assistant-candidates" data-assistant-motion="candidates">
          {remainingCandidates.map((candidate) => (
            <article key={candidate.id} className="assistant-candidate">
              <h4>
                <Sparkle size={15} />
                {candidate.kind === 'edit' ? '待确认的编辑' : '生图草案'}
              </h4>
              <p>{candidate.summary}</p>
              {!!candidate.changes?.length && (
                <details>
                  <summary>查看 {candidate.changes.length} 项参数变化</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>参数</th>
                        <th>原值</th>
                        <th>建议</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidate.changes.map((change) => (
                        <tr key={change.path}>
                          <td>{change.label}</td>
                          <td>{change.before}</td>
                          <td>{change.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
              <div>
                <button disabled={busy} onClick={() => void decide(candidate, 'rejected')}>
                  退回
                </button>
                <button
                  disabled={creative.mode === 'suggest' || busy}
                  onClick={() => void decide(candidate, 'previewed')}
                >
                  {candidate.kind === 'edit'
                    ? '在编辑器预览'
                    : candidate.decision === 'previewed'
                      ? '重新打开生图草案'
                      : '选择模型与生成参数'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="assistant-tool-status" aria-live="polite">
        {toolStatus || (busy ? '正在读取上下文并协作…' : '')}
      </p>
      {activeTurn && (
        <button
          type="button"
          className="button button-secondary"
          disabled={activeTurn.stopping}
          onClick={() => void stopActiveTurn()}
        >
          {activeTurn.stopping ? '正在核对停止结果' : '停止本轮执行'}
        </button>
      )}
      {error && (
        <p className="assistant-error" role="alert">
          {error}
          <button className="text-button" onClick={() => setHistoryEpoch((old) => old + 1)}>
            刷新会话记录
          </button>
        </p>
      )}
      <form
        className="assistant-composer"
        data-assistant-motion="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="向智能体描述修改需求"
          placeholder={
            inCall ? '也可以打字补充要求…' : '让 AI 看当前画面、提出建议，或找素材继续创作…'
          }
          rows={2}
          value={prompt}
          maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button
          aria-label="发送协作请求"
          type="submit"
          disabled={
            busy ||
            !prompt.trim() ||
            !project ||
            !catalog?.ready ||
            !selected ||
            (inCall && callState !== 'active')
          }
        >
          <ArrowUp size={19} />
        </button>
      </form>
      <p className="assistant-note">
        {inCall
          ? '麦克风实时传输，离开面板会结束通话。'
          : selected
            ? `文字协作每轮 ${selected.unitCost} 服务点。`
            : ''}
        {creative.mode === 'auto'
          ? '授权内的参数编辑保存为新版本，可从历史恢复。'
          : creative.mode === 'suggest'
            ? '当前只提供建议，保持图片不变。'
            : '候选需要你确认，保存前仍可撤销。'}
      </p>
    </section>
  );
}
