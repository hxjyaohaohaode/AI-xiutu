import { useEffect, useRef, useState } from 'react';
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
  VoiceServerEvent,
} from '@ai-xiutu/contracts';
import { parseEditorRecipe, type EditorRecipe } from '@ai-xiutu/editor';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { Artwork, Project, Session, Space } from '../lib/types';
import { EditorVoiceClient } from './voiceClient';
import {
  acknowledgeEditCandidate,
  assistantEditorKey,
  assistantScopeKey,
  AssistantOperationGate,
  type AssistantEditorState,
  type AssistantOperationToken,
} from './assistantGuards';
import './live-assistant.css';

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
  state: string;
  prompt?: string;
  output?: { text: string; citations: AssistantCitation[]; candidates: AssistantCandidate[] };
  errorCode?: string;
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: AssistantCitation[];
}
export interface LiveAssistantProps {
  project: Project | null;
  artwork: Artwork | null;
  recipe: EditorRecipe;
  isLoggedIn: boolean;
  onAuth: () => void;
  onSave: () => void;
  onPreview: (recipe: EditorRecipe) => void;
  onPrepareGenerationDraft: (draft: {
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
  const [modelId, setModelId] = useState(''),
    [voiceId, setVoiceId] = useState(''),
    [voice, setVoice] = useState('marin');
  const [mode, setMode] = useState<'text' | 'voice'>('voice'),
    [callState, setCallState] = useState<'idle' | 'connecting' | 'active' | 'closing'>('idle');
  const [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [shareImage, setShareImage] = useState(false),
    [allowWebSearch, setAllowWebSearch] = useState(false),
    [memory, setMemory] = useState(false);
  const [spaceIds, setSpaceIds] = useState<string[]>(project ? [project.spaceId] : []),
    [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [resourceQuery, setResourceQuery] = useState(''),
    [resources, setResources] = useState<
      { id: string; name: string; space: string; thumbnail: string }[]
    >([]);
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
    setContextStatus('未共享画面');
    setSpaceIds(project ? [project.spaceId] : []);
    setReferenceIds([]);
    setResources([]);
    setParentTurnId(undefined);
    setMessages([]);
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
  }, [searchScope]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!isLoggedIn || !project) return;
      try {
        const [{ turns }, savedCandidates] = await Promise.all([
          api<{ turns: Turn[] }>(`/projects/${project.id}/assistant-turns`, {
            signal: controller.signal,
          }),
          api<{ candidates: AssistantCandidate[] }>(
            `/projects/${project.id}/assistant-candidates`,
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
        setMessages((old) => {
          const merged = new Map<string, Message>();
          for (const turn of [...complete].reverse()) {
            merged.set(`${turn.id}-u`, {
              id: `${turn.id}-u`,
              role: 'user',
              text: turn.prompt ?? '',
            });
            merged.set(turn.id, {
              id: turn.id,
              role: 'assistant',
              text: turn.output?.text ?? '',
              citations: turn.output?.citations,
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
        if (turns.some((turn) => turn.state === 'running'))
          timer = setTimeout(() => void load(), 1500);
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
  }, [project?.id, isLoggedIn, historyEpoch]);
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
            voiceClient?.updateContext(context);
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
    allowWebSearch,
    usePersonalMemory: memory,
  };
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
    if (event.type === 'context') setContextStatus(event.imageShared ? '画面已更新' : '参数已更新');
    if (event.type === 'tool')
      setToolStatus(
        event.state === 'running'
          ? `正在协作：${({ search_resources: '查找素材', describe_editor: '读取编辑参数', propose_edit: '准备参数候选', propose_curve: '准备曲线', draft_generation: '整理生图草案', consult_editor: '分析当前需求' } as Record<string, string>)[event.name] ?? event.name}`
          : '',
      );
    if (event.type === 'transcript')
      setMessages((old) => {
        const last = old.at(-1);
        if (event.delta && last?.role === event.role && last.id.startsWith('live-'))
          return [
            ...old.slice(0, -1),
            { ...last, text: `${last.text}${event.text}`.slice(-12000) },
          ].slice(-40);
        return [...old, { id: `live-${secureUuid()}`, role: event.role, text: event.text }].slice(
          -40,
        );
      });
    if (event.type === 'assistant-result') {
      setMessages((old) =>
        [
          ...old,
          {
            id: secureUuid(),
            role: 'assistant' as const,
            text: event.text,
            citations: event.citations,
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
      const session = await api<{ id: string; ticket: string; websocketPath: string }>(
        `/projects/${project.id}/voice-sessions`,
        jsonRequest('POST', {
          idempotencyKey: secureUuid(),
          modelId: voiceId,
          backendModelId: modelId,
          voice,
          context,
          scope,
        }),
      );
      if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
        voiceClient.dispose();
        return;
      }
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
  async function submit() {
    if (requests.current.busy || !isLoggedIn || !project || !prompt.trim() || !modelId) return;
    const text = prompt.trim();
    setError('');
    setPrompt('');
    setMessages((old) => [...old, { id: secureUuid(), role: 'user' as const, text }].slice(-40));
    if (callState === 'active') {
      client.current?.send({ type: 'text', text });
      return;
    }
    const token = requests.current.begin();
    if (!token) return;
    setBusy(true);
    const controller = new AbortController();
    turnAbort.current = controller;
    try {
      const context = await getContext();
      if (!requestIsActive(token) || controller.signal.aborted) return;
      let result = await api<Turn>(`/projects/${project.id}/assistant-turns`, {
        ...jsonRequest('POST', {
          idempotencyKey: secureUuid(),
          modelId,
          prompt: text,
          context,
          scope,
          parentTurnId,
        }),
        signal: controller.signal,
      });
      const deadline = Date.now() + 280_000;
      while (result.state === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (controller.signal.aborted || !requestIsActive(token)) return;
        result = await api<Turn>(`/assistant-turns/${result.id}`, { signal: controller.signal });
      }
      if (controller.signal.aborted || !requestIsActive(token)) return;
      if (result.state === 'completed' && result.output) {
        setParentTurnId(result.id);
        setMessages((old) =>
          [
            ...old,
            {
              id: result.id,
              role: 'assistant' as const,
              text: result.output!.text,
              citations: result.output!.citations,
            },
          ].slice(-40),
        );
        setCandidates((old) => [...result.output!.candidates, ...old].slice(0, 30));
      } else
        setError(
          result.state === 'unknown'
            ? '本轮结果待核验，不会自动重试；可以在用量记录中查看。'
            : `本轮未完成：${result.errorCode ?? result.state}`,
        );
    } catch (err) {
      if (!controller.signal.aborted && requestIsActive(token)) setError(errorMessage(err));
    } finally {
      if (requests.current.finish(token) && alive.current) setBusy(false);
      if (turnAbort.current === controller) turnAbort.current = null;
    }
  }
  async function decide(candidate: AssistantCandidate, decision: 'previewed' | 'rejected') {
    if (!isLoggedIn || !project) return;
    const token = requests.current.begin();
    if (!token) return;
    setError('');
    try {
      if (decision === 'previewed' && candidate.kind === 'edit') {
        const applied = await acknowledgeEditCandidate(candidate, {
          readCurrent: () => editorState(current.current),
          isActive: () => requestIsActive(token),
          acknowledge: (body) =>
            api(`/assistant-candidates/${candidate.id}/decision`, jsonRequest('POST', body)),
          apply: (next) => current.current.onPreview(next),
        });
        if (!applied) return;
      } else {
        let commit: (() => void) | null = null;
        if (decision === 'previewed') {
          commit = await onPrepareGenerationDraft({
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
        old.map((item) => (item.id === candidate.id ? { ...item, decision } : item)),
      );
    } catch (err) {
      if (requestIsActive(token)) setError(errorMessage(err));
    } finally {
      requests.current.finish(token);
    }
  }
  function cancelSearch() {
    searches.current.invalidate();
    searchAbort.current?.controller.abort();
    searchAbort.current = null;
    setResources([]);
  }
  async function search() {
    if (!isLoggedIn || !project || inCall || !spaceIds.length) return;
    searchAbort.current?.controller.abort();
    const token = searches.current.beginLatest(),
      controller = new AbortController();
    searchAbort.current = { token, controller };
    setError('');
    try {
      const all = await Promise.all(
        spaceIds.map((spaceId) =>
          api<{
            resources: {
              asset: { id: string; name: string; thumbnailUrl: string };
              space: { name: string };
            }[];
          }>(`/resources?spaceId=${spaceId}&query=${encodeURIComponent(resourceQuery)}&limit=12`, {
            signal: controller.signal,
          }),
        ),
      );
      if (!searchIsActive(token) || controller.signal.aborted) return;
      setResources(
        all
          .flatMap((page) =>
            page.resources.map((item) => ({
              id: item.asset.id,
              name: item.asset.name,
              thumbnail: item.asset.thumbnailUrl,
              space: item.space.name,
            })),
          )
          .slice(0, 36),
      );
    } catch (err) {
      if (searchIsActive(token) && !controller.signal.aborted) setError(errorMessage(err));
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
  return (
    <section className="live-assistant" aria-label="实时语音与智能体协作">
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
              disabled={inCall}
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
            disabled={inCall || busy}
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
          <label>
            <input
              type="checkbox"
              checked={memory}
              disabled={inCall}
              onChange={(event) => setMemory(event.target.checked)}
            />
            使用我明确记住的素材标注
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
          {!!resources.length && (
            <div className="assistant-resource-results">
              {resources.map((item) => (
                <button
                  key={item.id}
                  disabled={inCall || (!referenceIds.includes(item.id) && referenceIds.length >= 8)}
                  aria-pressed={referenceIds.includes(item.id)}
                  onClick={() =>
                    setReferenceIds((old) =>
                      old.includes(item.id)
                        ? old.filter((id) => id !== item.id)
                        : [...old, item.id],
                    )
                  }
                >
                  <img src={item.thumbnail} alt="" />
                  <span>
                    {item.name}
                    <small>{item.space}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p>
            检索只返回名称与标注；只有选中的 {referenceIds.length}{' '}
            张参考图和勾选的当前预览会发送给模型。
          </p>
        </div>
      </details>
      {mode === 'voice' && (
        <div className={`assistant-call ${callState}`} data-assistant-motion="call">
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
        </div>
      )}
      <div className="assistant-messages" aria-label="协作对话" data-assistant-motion="messages">
        {messages.map((message) => (
          <article key={message.id} className={`assistant-message ${message.role}`}>
            <small>{message.role === 'user' ? '你' : '创作助手'}</small>
            <p>{message.text}</p>
            {!!message.citations?.length && (
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
      {candidates.some(
        (item) =>
          item.decision === 'pending' ||
          (item.kind === 'generation' && item.decision === 'previewed'),
      ) && (
        <div className="assistant-candidates" data-assistant-motion="candidates">
          {candidates
            .filter(
              (item) =>
                item.decision === 'pending' ||
                (item.kind === 'generation' && item.decision === 'previewed'),
            )
            .map((candidate) => (
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
                  <button onClick={() => void decide(candidate, 'rejected')}>退回</button>
                  <button onClick={() => void decide(candidate, 'previewed')}>
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
        {busy ? '正在读取上下文并协作…' : toolStatus}
      </p>
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
        候选需要你确认，保存前仍可撤销。
      </p>
    </section>
  );
}
