import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsHorizontal,
  Bell,
  ChatCircleDots,
  Check,
  CloudArrowUp,
  DownloadSimple,
  FileText,
  Images,
  Info,
  List,
  Package,
  Plus,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  UsersThree,
  X,
  ArrowRight,
  ShieldCheck,
  PencilSimple,
  Sun,
  Moon,
  CornersOut,
  GearSix,
  ChartBar,
  MagnifyingGlass,
  ClockCounterClockwise,
} from '@phosphor-icons/react';
import { api, ApiError, errorMessage, filenameBase, jsonRequest } from './lib/api';
import type {
  Artwork,
  Asset,
  Notice,
  Project,
  PublicConfig,
  Revision,
  Session,
  Space,
  View,
} from './lib/types';
import { useEditor, localPixelBudget, LocalImportError } from './editor/useEditor';
import { normalizeImageSourceFile } from './editor/imageSources';
import { createSourceLoadGuard, assertRevisionSourceBinding } from './editor/source-flow';
import { assetCopyAttempt, sourcePersistenceRoute } from './lib/asset-copy';
import { FloatingPanel } from './workspace/FloatingPanel';
import { ToolDock } from './workspace/ToolDock';
import { CommandMenu, type StudioCommand } from './workspace/CommandMenu';
import { boundedTitle } from './lib/titles';
import { workspaceCanvasInsets, useWorkspaceLayout } from './workspace/useWorkspaceLayout';
import { usePresence } from './motion/usePresence';
import { ImportSettings } from './components/ImportSettings';
import { MediaImportDialog } from './components/MediaImportDialog';
import {
  createRecipeV4,
  parseEditorRecipe,
  MAX_V3_PIXELS,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import { DEFAULT_BRAND, brandLogoUrl } from './lib/brand';

import { CanvasStage } from './editor/CanvasStage';
import { ToolInspector, toolGroups, type ToolGroup } from './editor/ToolInspector';
import { AuthPanel } from './components/AuthPanel';
import type { AIOperation } from './components/AIPanel';
import { AIPanelFeature } from './components/AIPanelFeature';
import { Sidebar } from './components/Sidebar';
import {
  Brand,
  Busy,
  DialogMotionContext,
  EmptyState,
  IconButton,
  InlineError,
  Modal,
  Toast,
} from './components/Ui';
import {
  CollaborateView,
  CompareView,
  DeliveryView,
  DocumentsView,
} from './components/WorkspaceViews';
import { AssetLibrary } from './components/AssetLibrary';
import { UsageDashboard } from './usage/UsageDashboard';
import { ResourceSearch } from './resources/ResourceSearch';
import { useCollaboration } from './collaboration/useCollaboration';
import { CollaborationStatus } from './collaboration/CollaborationStatus';
import { captureRenderedImage } from './editor/capture';
import {
  ExportDialog,
  NameDialog,
  ShareDialog,
  TeamDialog,
  CopyProjectDialog,
} from './components/ProjectDialogs';
const OpsDashboard = lazy(() =>
  import('./components/OpsDashboard').then((module) => ({ default: module.OpsDashboard })),
);
const DrawingBoard = lazy(() =>
  import('./components/DrawingBoard').then((module) => ({ default: module.DrawingBoard })),
);

const views: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'editor', label: '精修', icon: <SlidersHorizontal size={17} /> },
  { id: 'works', label: '作品', icon: <Images size={17} /> },
  { id: 'compare', label: '对比', icon: <ArrowsHorizontal size={17} /> },
  { id: 'collaborate', label: '协作', icon: <UsersThree size={17} /> },
  { id: 'docs', label: '文档', icon: <FileText size={17} /> },
  { id: 'deliver', label: '交付', icon: <Package size={17} /> },
  { id: 'usage', label: '用量', icon: <ChartBar size={17} /> },
];
type Dialog =
  | 'auth'
  | 'project'
  | 'team'
  | 'join'
  | 'teamSettings'
  | 'share'
  | 'export'
  | 'conflict'
  | 'help'
  | 'quota'
  | 'drawing'
  | 'copy'
  | 'importSettings'
  | 'mediaImport'
  | 'commands'
  | null;
export function App() {
  const rawEditor = useEditor();
  const workspaceLayout = useWorkspaceLayout();
  const [pickedColor, setPickedColor] = useState('#34372EFF');
  const [sampling, setSampling] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importReason, setImportReason] = useState<string | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceSource, setReferenceSource] = useState<'sketch' | 'upload'>('sketch');
  const [initialAIOperation, setInitialAIOperation] = useState<AIOperation>('edit-plan');
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<Session>({ user: null, spaces: [] });
  const [booting, setBooting] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [savedRecipe, setSavedRecipeState] = useState<string | null>(null);
  const savedRecipeRef = useRef<string | null>(null);
  const setSavedRecipe = useCallback((value: string | null) => {
    savedRecipeRef.current = value;
    setSavedRecipeState(value);
  }, []);
  const layerOwners = useRef(new Map<string, string>());
  const uploadedLayerAliases = useRef(new Map<string, string>());
  const uploadedBaseAssets = useRef(new Map<string, Asset>());
  const cloudBaseSources = useRef(new Map<number, Asset>());
  const [documentDirty, setDocumentDirty] = useState(false);
  const [view, setView] = useState<View>('editor');
  const [libraryTab, setLibraryTab] = useState<'project' | 'all' | 'memory'>('project');
  const [group, setGroup] = useState<ToolGroup>('light');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [ops, setOps] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [entitlements, setEntitlements] = useState<{
    available: number;
    held: number;
    freeAvailable: number;
    purchasedAvailable: number;
    periodEnd: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recipeInput = useRef<HTMLInputElement>(null);
  const projectRequest = useRef(0);
  const saveAfterProject = useRef(false);
  const saveLock = useRef(false);
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = project?.id ?? null;
  const notify = useCallback(
    (message: string, tone: Notice['tone'] = 'info') => setNotice({ message, tone }),
    [],
  );
  const dismissNotice = useCallback(() => setNotice(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const collaboration = useCollaboration({
    editor: rawEditor,
    artwork,
    revision,
    asset,
    enabled:
      !!session.user &&
      !!artwork &&
      !!revision &&
      !!asset &&
      !!project &&
      session.spaces.some((space) => space.id === project.spaceId) &&
      cloudBaseSources.current.get(rawEditor.getSourceIdentity())?.id === asset.id,
    canEdit: !!project && ['owner', 'admin', 'editor'].includes(project.role),
    tool: group,
    onHead(head) {
      setArtwork(head.artwork);
      setRevision(head.revision);
      setAsset(head.asset);
      setSavedRecipe(JSON.stringify(parseEditorRecipe(head.revision.recipe)));
      setArtworks((items) =>
        items.map((item) => (item.id === head.artwork.id ? head.artwork : item)),
      );
      setRefreshToken((v) => v + 1);
    },
    prepareRecipe: (next) =>
      project
        ? persistRecipeLayers(next, project, rawEditor.getSourceIdentity(), projectRequest.current)
        : Promise.reject(new Error('项目已改变，请重新打开作品。')),
    resolveReferences: resolveLayerReferences,
  });
  const editor = collaboration.editor;
  const captureCurrentImage = async () => {
    const current = artworkRef.current;
    if (
      !current ||
      !asset ||
      !editor.rendered ||
      !editor.renderedRecipe ||
      editor.rendering ||
      editor.isLoading() ||
      opening
    )
      throw new Error('画面还在更新，请就绪后共享当前图片。');
    const before = editor.getRecipe(),
      identity = editor.getSourceIdentity();
    if (JSON.stringify(before) !== JSON.stringify(editor.renderedRecipe))
      throw new Error('最新编辑还没有完成渲染，请稍后再共享。');
    const imageDataUrl = await captureRenderedImage(editor.rendered);
    if (
      identity !== editor.getSourceIdentity() ||
      before !== editor.getRecipe() ||
      artworkRef.current?.id !== current.id ||
      artworkRef.current.headVersion !== current.headVersion
    )
      throw new Error('共享期间画面已变化，请重新获取上下文。');
    return {
      imageDataUrl,
      assetId: asset.id,
      artworkId: current.id,
      expectedVersion: current.headVersion,
      recipe: structuredClone(before),
    };
  };
  const brand = config?.brand.name || DEFAULT_BRAND;
  const currentSpace = session.spaces.find((s) => s.id === spaceId) ?? null;
  const dirty = !!editor.file && JSON.stringify(editor.recipe) !== savedRecipe;
  const artworkRef = useRef(artwork);
  artworkRef.current = artwork;
  const isEditorDirty = () =>
    !!editor.file && JSON.stringify(editor.getRecipe()) !== savedRecipeRef.current;
  const refreshConfig = useCallback(() => {
    api<PublicConfig>('/public-config')
      .then(setConfig)
      .catch((e) => setCloudError(errorMessage(e)));
  }, []);

  useEffect(() => {
    let live = true;
    Promise.allSettled([api<PublicConfig>('/public-config'), api<Session>('/session')]).then(
      (results) => {
        if (!live) return;
        const c = results[0],
          s = results[1];
        if (c.status === 'fulfilled') setConfig(c.value);
        else setCloudError(errorMessage(c.reason));
        if (s.status === 'fulfilled') {
          setSession(s.value);
          setSpaceId(s.value.spaces.find((v) => v.kind === 'personal')?.id ?? null);
        } else setCloudError(errorMessage(s.reason));
        setBooting(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    document.title = `${brand} · ${project?.title ?? '创作工作台'}`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name=description]');
    if (meta && config?.brand.tagline) meta.content = config.brand.tagline;
    const icon = document.querySelector<HTMLLinkElement>('link[rel=icon]');
    if (icon) icon.href = brandLogoUrl(config?.brand) || '/favicon.svg';
  }, [
    brand,
    project?.title,
    config?.brand.logoUrl,
    config?.brand.logoAssetId,
    config?.brand.tagline,
  ]);
  useEffect(() => {
    if (!session.user || !spaceId) {
      setProjects([]);
      setEntitlements(null);
      return;
    }
    let live = true;
    setCloudError(null);
    Promise.allSettled([
      api<{ projects: Project[] }>(`/projects?spaceId=${encodeURIComponent(spaceId)}`),
      api<NonNullable<typeof entitlements>>(
        `/me/entitlements?spaceId=${encodeURIComponent(spaceId)}`,
      ),
    ]).then(([p, q]) => {
      if (!live) return;
      if (p.status === 'fulfilled') setProjects(p.value.projects);
      else setCloudError(errorMessage(p.reason));
      if (q.status === 'fulfilled') setEntitlements(q.value);
      else setEntitlements(null);
    });
    return () => {
      live = false;
    };
  }, [spaceId, session.user?.id, refreshToken]);
  useEffect(() => {
    if (!session.user) {
      setSharedProjects([]);
      return;
    }
    let live = true;
    api<{ projects: Project[] }>('/projects')
      .then((result) => {
        if (live)
          setSharedProjects(
            result.projects.filter(
              (value) => !session.spaces.some((space) => space.id === value.spaceId),
            ),
          );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [session.user?.id, session.spaces, refreshToken]);
  useEffect(() => {
    if (!session.user || !spaceId) return;
    const controller = new AbortController();
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const poll = async () => {
      try {
        const result = await api<{
          events: { type: string; projectId?: string }[];
          nextCursor: number;
        }>(`/events?spaceId=${encodeURIComponent(spaceId)}&after=${cursor}&waitMs=15000`, {
          signal: controller.signal,
        });
        cursor = result.nextCursor;
        if (disposed) return;
        if (result.events.length) setRefreshToken((t) => t + 1);
        timer = setTimeout(poll, 500);
      } catch (e) {
        if (disposed || (e as Error).name === 'AbortError') return;
        timer = setTimeout(poll, 10000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [session.user?.id, spaceId]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || e.isComposing || e.keyCode === 229) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDialog('commands');
        return;
      }
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? editor.redo() : editor.undo();
      }
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
        e.preventDefault();
        workspaceLayout.setFocused((value) => !value);
      }
      if (e.key === 'Escape') {
        setComparing(false);
        setSidebarOpen(false);
        setInspectorOpen(false);
        setAiOpen(false);
        workspaceLayout.setFocused(false);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [editor.undo, editor.redo]);
  useEffect(() => {
    if (!dirty && !documentDirty) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, documentDirty]);

  useEffect(() => {
    if (!project?.id || !refreshToken) return;
    void refreshProject(project.id).catch((e) => setCloudError(errorMessage(e)));
  }, [refreshToken, project?.id]);

  function receiveSession(next: Session) {
    setSession(next);
    setSpaceId(next.spaces.find((s) => s.kind === 'personal')?.id ?? null);
    setCloudError(null);
    notify('已登录，可以把作品保存到云端。', 'success');
  }
  async function logout() {
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return;
    }
    if (documentDirty && !window.confirm('文档还有未保存的修改，确定退出账号吗？')) return;
    ++projectRequest.current;
    editor.cancelPendingLoad();
    try {
      await api('/auth/logout', jsonRequest('POST'));
      setSession({ user: null, spaces: [] });
      setOpening(false);
      setSpaceId(null);
      setProject(null);
      setAssets([]);
      setArtworks([]);
      setArtwork(null);
      setAsset(null);
      setRevision(null);
      setSavedRecipe(null);
      setOps(false);
      setAiOpen(false);
      notify('已退出账号。当前照片仍在本机，请及时导出。');
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  }
  function selectSpace(space: Space | null) {
    if (documentDirty && !window.confirm('文档还有未保存的修改，确定切换空间吗？')) return;
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return;
    }
    ++projectRequest.current;
    editor.cancelPendingLoad();
    setOpening(false);
    setSpaceId(space?.id ?? null);
    setProject(null);
    setArtwork(null);
    setAsset(null);
    setRevision(null);
    setSavedRecipe(null);
    setAssets([]);
    setArtworks([]);
    setView(space ? 'works' : 'editor');
    setSidebarOpen(false);
    setAiOpen(false);
  }
  async function loadProject(next: Project) {
    if (documentDirty && !window.confirm('文档还有未保存的修改，确定切换项目吗？')) return;
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return;
    }
    const req = ++projectRequest.current;
    editor.cancelPendingLoad();
    setOpening(true);
    setCloudError(null);
    try {
      const result = await api<{ project: Project; assets: Asset[]; artworks: Artwork[] }>(
        `/projects/${next.id}`,
      );
      if (req !== projectRequest.current) return;
      setProject(result.project);
      setAssets(result.assets);
      setArtworks(result.artworks);
      setArtwork(null);
      setAsset(null);
      setRevision(null);
      setSavedRecipe(null);
      setView('works');
      setSidebarOpen(false);
      setAiOpen(false);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      if (req === projectRequest.current) setOpening(false);
    }
  }
  async function refreshProject(id: string) {
    const result = await api<{ project: Project; assets: Asset[]; artworks: Artwork[] }>(
      `/projects/${id}`,
    );
    if (projectIdRef.current !== id) return;
    setProject(result.project);
    setAssets(result.assets);
    setArtworks(result.artworks);
  }
  function beginSourceLoad() {
    const request = ++projectRequest.current;
    editor.cancelPendingLoad();
    const guard = createSourceLoadGuard(() => ({
      context: projectRequest.current,
      source: editor.getSourceIdentity(),
      recipe: editor.getRecipe(),
    }));
    return {
      ...guard,
      request,
      abandoned: () => {
        if (guard.status() === 'edited')
          notify('加载期间你继续修改了当前图片，已保留这些编辑。准备好后可重新打开目标图片。');
        return false;
      },
    };
  }
  async function importFile(file?: File): Promise<boolean> {
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return false;
    }
    if (!file) {
      fileInput.current?.click();
      return false;
    }
    if (documentDirty && !window.confirm('文档还有未保存的修改。打开照片会离开文档，确定继续吗？'))
      return false;
    if (
      isEditorDirty() &&
      !window.confirm('当前还有未保存的编辑。打开新图片将替换本地编辑，确认继续吗？')
    )
      return false;
    // Close the previous source's panel before decoding. A tool explicitly opened
    // while the new image becomes visible must not be closed by the late load completion.
    // Leave a confirmed document now, so no new document edits can be lost while decoding.
    setView('editor');
    setInspectorOpen(false);
    const load = beginSourceLoad();
    try {
      const loaded = await editor.loadFile(file, undefined, load.isCurrent);
      if (!loaded) return load.abandoned();
      if (load.request !== projectRequest.current) return false;
      setArtwork(null);
      setAsset(null);
      setRevision(null);
      setSavedRecipe(null);
      setComparing(false);
      setSampling(false);
      setPendingImport(null);
      setImportReason(null);
      notify('图片已打开，尚未上传。', 'success');
      return true;
    } catch (e) {
      if (!load.isCurrent()) return load.abandoned();
      if (
        e instanceof LocalImportError &&
        ['LOCAL_SIZE_LIMIT', 'LOCAL_FORMAT_UNSUPPORTED'].includes(e.code)
      ) {
        setPendingImport(file);
        setImportReason(e.message);
        setDialog('importSettings');
      } else notify(errorMessage(e), 'error');
      return false;
    }
  }

  async function resolveLayerReferences(
    value: EditorRecipe,
    isCurrent: () => boolean,
  ): Promise<Map<string, File>> {
    const references = new Map<string, File>();
    if (value.schemaVersion !== 3 && value.schemaVersion !== 4) return references;
    for (const id of new Set(value.imageLayers.map((layer) => layer.sourceId))) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('云端作品包含不可解析的合成素材引用。');
      if (!isCurrent()) return references;
      const response = await fetch(`/v1/assets/${id}/file`, { credentials: 'include' });
      if (!isCurrent()) return references;
      if (!response.ok) throw new Error('无法读取作品引用的合成素材，请确认项目访问权限。');
      const blob = await response.blob();
      if (!isCurrent()) return references;
      references.set(
        id,
        new File([blob], `${id}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type }),
      );
    }
    return references;
  }
  async function openArtwork(next: Artwork | string): Promise<boolean> {
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return false;
    }
    if (
      isEditorDirty() &&
      !window.confirm(
        '当前还有未保存的编辑。打开云端作品前，请确认已导出或不再需要这些修改。继续打开吗？',
      )
    )
      return false;
    const id = typeof next === 'string' ? next : next.id;
    const load = beginSourceLoad();
    setOpening(true);
    try {
      const data = await api<{ artwork: Artwork; asset: Asset; revision: Revision }>(
        `/artworks/${id}`,
      );
      if (!load.isCurrent()) return load.abandoned();
      assertRevisionSourceBinding({
        artworkId: id,
        projectId: data.artwork.projectId,
        revision: data.revision,
        asset: data.asset,
      });
      if (data.artwork.assetId !== data.asset.id)
        throw new Error('当前作品来源与版本不一致，请刷新后重试。');
      const response = await fetch(data.asset.url, { credentials: 'include' });
      if (!response.ok) throw new Error('暂时无法读取这张图片，请检查项目访问权限后重试。');
      const blob = await response.blob();
      if (!load.isCurrent()) return load.abandoned();
      const file = new File([blob], data.asset.name, { type: blob.type || data.asset.mime });
      const layerReferences = await resolveLayerReferences(data.revision.recipe, load.isCurrent);
      if (!load.isCurrent()) return load.abandoned();
      const loaded = await editor.loadFile(
        file,
        data.revision.recipe,
        load.isCurrent,
        layerReferences,
      );
      if (!loaded) return load.abandoned();
      if (load.request !== projectRequest.current) return false;
      for (const sourceId of layerReferences.keys())
        layerOwners.current.set(sourceId, data.artwork.projectId);
      cloudBaseSources.current.set(editor.getSourceIdentity(), data.asset);
      setArtwork(data.artwork);
      setAsset(data.asset);
      setRevision(data.revision);
      setSavedRecipe(JSON.stringify(parseEditorRecipe(data.revision.recipe)));
      setView('editor');
      setComparing(false);
      notify(`已打开「${data.artwork.title}」版本 ${data.artwork.headVersion}。`, 'success');
      return true;
    } catch (e) {
      if (!load.isCurrent()) return load.abandoned();
      if (load.request === projectRequest.current) notify(errorMessage(e), 'error');
      return false;
    } finally {
      if (load.request === projectRequest.current) setOpening(false);
    }
  }

  async function openLibraryAsset(next: Asset) {
    if (
      next.projectId !== project?.id &&
      documentDirty &&
      !window.confirm('文档还有未保存的修改，确定切换项目吗？')
    )
      return;
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return;
    }
    if (
      isEditorDirty() &&
      !window.confirm('当前还有未保存的编辑。打开素材原图会替换本地草稿，继续吗？')
    )
      return;
    const load = beginSourceLoad();
    setOpening(true);
    try {
      const destination =
        next.projectId !== project?.id
          ? await api<{ project: Project; assets: Asset[]; artworks: Artwork[] }>(
              `/projects/${next.projectId}`,
            )
          : null;
      if (!load.isCurrent()) return load.abandoned();
      const response = await fetch(next.url, { credentials: 'include' });
      if (!response.ok) throw new Error('无法读取素材，请刷新当前项目权限后重试。');
      const blob = await response.blob();
      if (!load.isCurrent()) {
        load.abandoned();
        return;
      }
      const loaded = await editor.loadFile(
        new File([blob], next.name, { type: blob.type || next.mime }),
        undefined,
        load.isCurrent,
      );
      if (!loaded) {
        load.abandoned();
        return;
      }
      if (load.request !== projectRequest.current) return;
      cloudBaseSources.current.set(editor.getSourceIdentity(), next);
      if (destination) {
        setProject(destination.project);
        setAssets(destination.assets);
        setArtworks(destination.artworks);
        if (session.spaces.some((space) => space.id === destination.project.spaceId))
          setSpaceId(destination.project.spaceId);
      }
      setAsset(next);
      setArtwork(null);
      setRevision(null);
      setSavedRecipe(null);
      setView('editor');
      setComparing(false);
      setInspectorOpen(false);
      setAiOpen(false);
      notify('原始素材已打开。保存时会建立独立作品，不会改写已有版本。', 'success');
    } catch (error) {
      if (!load.isCurrent()) {
        load.abandoned();
        return;
      }
      if (load.request === projectRequest.current) notify(errorMessage(error), 'error');
    } finally {
      if (load.request === projectRequest.current) setOpening(false);
    }
  }

  async function copyCloudAsset(sourceAssetId: string, targetProjectId: string): Promise<Asset> {
    if (!session.user) throw new Error('请先登录再复制云端素材。');
    let storage: Storage | undefined;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Same-tab memory still preserves the key. */
    }
    const request = assetCopyAttempt(session.user.id, sourceAssetId, targetProjectId, storage);
    const result = await api<{ asset: Asset }>(
      `/assets/${sourceAssetId}/copy`,
      jsonRequest('POST', request),
    );
    return result.asset;
  }
  async function persistRecipeLayers(
    snapshot: EditorRecipe,
    target: Project,
    savedSource: number,
    savedContext: number,
  ): Promise<EditorRecipe> {
    if (
      (snapshot.schemaVersion === 3 || snapshot.schemaVersion === 4) &&
      snapshot.imageLayers.length
    ) {
      const mapping = new Map<string, string>(),
        files = rawEditor.getLayerFiles();
      for (const sourceId of new Set(snapshot.imageLayers.map((layer) => layer.sourceId))) {
        const route = sourcePersistenceRoute(
          sourceId,
          layerOwners.current.get(sourceId),
          target.id,
        );
        if (route === 'reuse') continue;
        const cached = uploadedLayerAliases.current.get(`${target.id}:${sourceId}`);
        if (cached) {
          mapping.set(sourceId, cached);
          continue;
        }
        let uploadedAsset: Asset;
        if (route === 'copy') uploadedAsset = await copyCloudAsset(sourceId, target.id);
        else {
          let layerFile = files.get(sourceId);
          if (!layerFile) throw new Error('缺少合成素材原文件，无法保存完整作品。');
          const layerFormat = layerFile.type.split('/')[1];
          if (
            layerFormat === 'bmp' ||
            (config?.media && !config.media.serverImport.includes(layerFormat ?? ''))
          )
            layerFile = await normalizeImageSourceFile(layerFile);
          if (layerFile.size > (config?.limits.maxUploadBytes ?? 20 * 1024 * 1024))
            throw new Error('合成素材超出服务器上传预算。');
          const form = new FormData();
          form.append('file', layerFile);
          const uploaded = await api<{ asset: Asset }>(`/projects/${target.id}/assets`, {
            method: 'POST',
            body: form,
          });
          uploadedAsset = uploaded.asset;
        }
        if (
          savedSource !== rawEditor.getSourceIdentity() ||
          savedContext !== projectRequest.current
        )
          throw new Error('上传期间作品已切换，素材保留于原项目。');
        mapping.set(sourceId, uploadedAsset.id);
        layerOwners.current.set(uploadedAsset.id, target.id);
        uploadedLayerAliases.current.set(`${target.id}:${sourceId}`, uploadedAsset.id);
      }
      snapshot = {
        ...snapshot,
        imageLayers: snapshot.imageLayers.map((layer) => ({
          ...layer,
          sourceId: mapping.get(layer.sourceId) ?? layer.sourceId,
        })),
      };
      // Rekey only references; a user may have continued editing while uploads were in flight.
      rawEditor.rekeyImageSources(mapping);
    }
    return snapshot;
  }
  async function saveToProject(target: Project, asNew = false) {
    if (!asNew && collaboration.enabled && artwork?.projectId === target.id) {
      if (saveLock.current || editor.isLoading() || opening) return;
      saveLock.current = true;
      setSaving(true);
      try {
        await collaboration.publishCurrent();
        notify('当前调整已同步为云端版本。', 'success');
      } catch (error) {
        notify(errorMessage(error), 'error');
      } finally {
        saveLock.current = false;
        setSaving(false);
      }
      return;
    }
    if (!editor.file || saveLock.current) return;
    if (editor.isLoading() || opening) {
      notify('图片正在准备中，请加载完成后再保存。');
      return;
    }
    let snapshot = structuredClone(editor.getRecipe());
    const savedFile = editor.file;
    const savedSource = editor.getSourceIdentity();
    const savedContext = projectRequest.current;
    saveLock.current = true;
    setSaving(true);
    try {
      const knownSource = cloudBaseSources.current.get(savedSource);
      let currentAsset =
        knownSource?.projectId === target.id
          ? knownSource
          : (uploadedBaseAssets.current.get(`${target.id}:${savedSource}`) ?? null);
      if (!currentAsset || currentAsset.projectId !== target.id) {
        if (knownSource) {
          // Known cloud bytes retain their copy policy and provenance; never
          // fall back to uploading their already-downloaded File on rejection.
          currentAsset = await copyCloudAsset(knownSource.id, target.id);
        } else {
          if (
            editor.dimensions &&
            editor.dimensions.width * editor.dimensions.height >
              (config?.limits.maxPixels ?? 40_000_000)
          )
            throw new Error(
              '原图超过当前服务端像素预算。本地编辑与导出仍可继续，请明确准备较小副本再保存云端。',
            );
          const uploadFile = await editor.getCloudUploadFile(
            !!config?.media && !config.media.serverImport.includes(editor.sourceFormat),
          );
          if (uploadFile.size > (config?.limits.maxUploadBytes ?? 20 * 1024 * 1024))
            throw new Error(
              `上传文件超过当前云端 ${Math.floor((config?.limits.maxUploadBytes ?? 20 * 1024 * 1024) / 1024 / 1024)} MiB 上限，本地作品仍然保留。`,
            );
          const form = new FormData();
          form.append('file', uploadFile);
          currentAsset = (
            await api<{ asset: Asset }>(`/projects/${target.id}/assets`, {
              method: 'POST',
              body: form,
            })
          ).asset;
        }
        if (savedSource !== editor.getSourceIdentity() || savedContext !== projectRequest.current)
          throw new Error('源图片或项目已切换，本次素材保留在原项目，未绑定到当前画面。');
        uploadedBaseAssets.current.set(`${target.id}:${savedSource}`, currentAsset);
      }
      snapshot = await persistRecipeLayers(snapshot, target, savedSource, savedContext);
      const result =
        artwork && !asNew && artwork.projectId === target.id
          ? await api<{ artwork: Artwork; revision: Revision }>(
              `/artworks/${artwork.id}/revisions`,
              jsonRequest('POST', {
                expectedVersion: artwork.headVersion,
                recipe: snapshot,
                label: '手动编辑',
              }),
            )
          : await api<{ artwork: Artwork; revision: Revision }>(
              `/projects/${target.id}/artworks`,
              jsonRequest('POST', {
                assetId: currentAsset.id,
                title: boundedTitle(filenameBase(savedFile.name), asNew ? ' · 独立分支' : ''),
                recipe: snapshot,
              }),
            );
      if (savedSource !== editor.getSourceIdentity() || savedContext !== projectRequest.current) {
        notify('原作品版本已保存，但当前画面已切换，因此未替换当前编辑绑定。');
        setRefreshToken((value) => value + 1);
        return;
      }
      setAsset(currentAsset);
      cloudBaseSources.current.set(savedSource, currentAsset);
      setArtwork(result.artwork);
      setRevision(result.revision);
      setSavedRecipe(JSON.stringify(snapshot));
      await refreshProject(target.id);
      setRefreshToken((v) => v + 1);
      setDialog(null);
      notify(`版本 ${result.artwork.headVersion} 已保存到「${target.title}」。`, 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setDialog('conflict');
      else notify(errorMessage(e), 'error');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function serverImport() {
    if (!pendingImport || !project) throw new Error('请先选择文件和保存项目。');
    const incoming = pendingImport;
    const destination = project;
    const guard = createSourceLoadGuard(() => ({
      context: projectRequest.current,
      source: editor.getSourceIdentity(),
      recipe: editor.getRecipe(),
    }));
    if (incoming.size > (config?.media?.maxUploadBytes ?? config?.limits.maxUploadBytes ?? 0))
      throw new Error('这份文件超过当前服务端上传上限。没有上传，请使用较小副本或调整服务配置。');
    const form = new FormData();
    form.append('file', incoming);
    const uploaded = await api<{ asset: Asset }>(`/projects/${destination.id}/assets`, {
      method: 'POST',
      body: form,
    });
    const result = await api<{ artwork: Artwork; revision: Revision }>(
      `/projects/${destination.id}/artworks`,
      jsonRequest('POST', {
        assetId: uploaded.asset.id,
        title: boundedTitle(filenameBase(incoming.name)),
        recipe: createRecipeV4(),
      }),
    );
    setRefreshToken((value) => value + 1);
    if (guard.status() === 'superseded') {
      notify(
        `规范化素材与新作品已保存到「${destination.title}」，当前工作区已改变，因此未自动打开。`,
        'success',
      );
      return;
    }
    setPendingImport(null);
    setImportReason(null);
    await refreshProject(destination.id);
    if (!guard.isCurrent()) {
      notify(
        `规范化素材与新作品已保存到「${destination.title}」。上传期间的新编辑已保留，可从项目中打开该作品。`,
        'success',
      );
      return;
    }
    const exceedsEngine =
      uploaded.asset.width * uploaded.asset.height > MAX_V3_PIXELS ||
      uploaded.asset.width > 8192 ||
      uploaded.asset.height > 8192;
    if (
      !exceedsEngine &&
      uploaded.asset.width * uploaded.asset.height <=
        Math.min(editor.pixelBudget, localPixelBudget(), MAX_V3_PIXELS)
    ) {
      await openArtwork(result.artwork);
    } else {
      setView('works');
      notify(
        exceedsEngine
          ? '规范化PNG与新作品已保存到项目。原图超过当前工作台的16.8MP / 单边8192px编辑上限，请明确准备较小副本；提高设备预算不会改变此工作台上限。'
          : '规范化PNG与新作品已保存到项目。当前设备预算不足，可在16.8MP引擎上限内调整预算或使用较小副本。',
        'success',
      );
    }
  }
  function save() {
    if (editor.isLoading() || opening) {
      notify('图片正在准备中，请加载完成后再保存。');
      return;
    }
    if (!editor.file) {
      notify('先打开一张照片，再保存到项目。');
      return;
    }
    if (!session.user) {
      setDialog('auth');
      return;
    }
    if (!project) {
      saveAfterProject.current = true;
      setDialog('project');
      return;
    }
    void saveToProject(project);
  }
  function openCreateProject() {
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return;
    }
    if (!session.user) {
      setDialog('auth');
      return;
    }
    saveAfterProject.current = false;
    setDialog('project');
  }
  async function createProject(title: string) {
    if (saveLock.current) throw new Error('作品正在保存，请稍等片刻。');
    if (!spaceId) throw new Error('请先选择一个创作空间。');
    const context = ++projectRequest.current;
    editor.cancelPendingLoad();
    setOpening(false);
    const result = await api<{ project: Project }>(
      '/projects',
      jsonRequest('POST', { spaceId, title }),
    );
    if (context !== projectRequest.current) {
      setRefreshToken((value) => value + 1);
      notify('项目已创建，可在相应空间查看。');
      return;
    }
    setProject(result.project);
    setProjects((p) => [result.project, ...p]);
    setAssets([]);
    setArtworks([]);
    setArtwork(null);
    setAsset(null);
    setRevision(null);
    setSavedRecipe(null);
    setView('editor');
    if (saveAfterProject.current) {
      saveAfterProject.current = false;
      await saveToProject(result.project);
    } else notify('项目已创建，打开照片开始创作。', 'success');
  }
  async function createTeam(name: string) {
    const result = await api<{ space: Space }>('/spaces', jsonRequest('POST', { name }));
    const next = await api<Session>('/session');
    setSession(next);
    selectSpace(result.space);
    notify('团队空间已创建。可以邀请队友加入。', 'success');
  }
  async function joinTeam(code: string) {
    const result = await api<{ space: Space }>(
      '/invitations/accept',
      jsonRequest('POST', { code }),
    );
    const next = await api<Session>('/session');
    setSession(next);
    selectSpace(result.space);
    notify('已加入团队空间。', 'success');
  }
  function changeView(next: View) {
    if (
      view === 'docs' &&
      next !== view &&
      documentDirty &&
      !window.confirm('文档还有未保存的修改，确定离开文档吗？')
    )
      return false;
    setView(next);
    setInspectorOpen(false);
    setAiOpen(false);
    return true;
  }
  async function openRevision(next: Revision) {
    const current = artworkRef.current;
    if (!current || saveLock.current || opening) return;
    if (isEditorDirty() && !window.confirm('查看历史会替换本地未保存草稿，继续吗？')) return;
    const load = beginSourceLoad();
    setOpening(true);
    try {
      const data = await api<{ revision: Revision; asset: Asset }>(
        `/artworks/${current.id}/revisions/${next.id}`,
      );
      if (!load.isCurrent()) {
        load.abandoned();
        return;
      }
      assertRevisionSourceBinding({
        artworkId: current.id,
        projectId: current.projectId,
        revision: data.revision,
        asset: data.asset,
      });
      const response = await fetch(data.asset.url, { credentials: 'include' });
      if (!response.ok) throw new Error('无法读取这个历史版本的底图。');
      const blob = await response.blob();
      if (!load.isCurrent()) {
        load.abandoned();
        return;
      }
      const references = await resolveLayerReferences(data.revision.recipe, load.isCurrent);
      if (!load.isCurrent()) {
        load.abandoned();
        return;
      }
      const loaded = await editor.loadFile(
        new File([blob], data.asset.name, { type: blob.type || data.asset.mime }),
        data.revision.recipe,
        load.isCurrent,
        references,
      );
      if (!loaded) {
        load.abandoned();
        return;
      }
      if (load.request !== projectRequest.current) return;
      for (const sourceId of references.keys())
        layerOwners.current.set(sourceId, current.projectId);
      cloudBaseSources.current.set(editor.getSourceIdentity(), data.asset);
      setAsset(data.asset);
      setRevision(data.revision);
      setView('editor');
      setComparing(false);
      // A historical source becomes a separate draft; saving is explicitly a fork, not a recipe on the new source.
      setArtwork(null);
      setSavedRecipe(null);
      notify(`历史版本 ${next.version} 的底图、合成素材与配方已打开，保存将建立独立作品。`);
    } catch (error) {
      if (!load.isCurrent()) {
        load.abandoned();
        return;
      }
      if (load.request === projectRequest.current) notify(errorMessage(error), 'error');
    } finally {
      if (load.request === projectRequest.current) setOpening(false);
    }
  }
  async function restoreRevision(next: Revision) {
    const current = artworkRef.current;
    if (!current || isEditorDirty() || saveLock.current || opening)
      throw new Error('请先保存当前草稿再恢复历史。');
    const source = editor.getSourceIdentity(),
      before = editor.getRecipe();
    saveLock.current = true;
    setSaving(true);
    try {
      await collaboration.beforeExternalWrite();
      const restored = await api<{ artwork: Artwork }>(
        `/artworks/${current.id}/restore`,
        jsonRequest('POST', { revisionId: next.id, expectedVersion: current.headVersion }),
      );
      if (
        source === editor.getSourceIdentity() &&
        before === editor.getRecipe() &&
        artworkRef.current?.id === current.id
      ) {
        saveLock.current = false;
        await openArtwork(restored.artwork);
      } else notify('历史已在云端恢复成新版本，当前继续编辑的草稿已保留。');
      setRefreshToken((v) => v + 1);
    } finally {
      collaboration.afterExternalWrite();
      saveLock.current = false;
      setSaving(false);
    }
  }
  const requireProject = (
    <EmptyState
      icon={<UsersThree size={36} />}
      title="让大家接上你的想法"
      description={
        session.user
          ? '先选择或创建项目，讨论、文档和任务就会围绕同一份作品展开。'
          : '登录后创建项目，可以邀请团队一起整理作品与意见。'
      }
      action={
        <button className="button button-primary" onClick={openCreateProject}>
          {session.user ? '创建项目' : '登录创作空间'}
          <ArrowRight size={17} />
        </button>
      }
    />
  );

  const activePanelId = workspaceLayout.focused
    ? null
    : aiOpen
      ? 'ai'
      : inspectorOpen
        ? 'inspector'
        : null;
  const activePanel = activePanelId ? workspaceLayout.panel(activePanelId) : null;
  const panelPresence = usePresence(!!activePanelId, 'panel-frame');
  const lastPanelId = useRef<typeof activePanelId>(null);
  if (activePanelId) lastPanelId.current = activePanelId;
  const shownPanelId = activePanelId ?? (panelPresence.present ? lastPanelId.current : null);
  const shownPanel = shownPanelId ? workspaceLayout.panel(shownPanelId) : null;
  const dialogPresence = usePresence(!!dialog, 'modal-frame');
  const lastDialog = useRef<Dialog>(null);
  if (dialog) lastDialog.current = dialog;
  const renderedDialog = dialog ?? (dialogPresence.present ? lastDialog.current : null);
  const canvasInsets = workspaceCanvasInsets(
    activePanel,
    workspaceLayout.view,
    workspaceLayout.focused,
  );
  const openInspector = (tool: ToolGroup) => {
    workspaceLayout.setFocused(false);
    setGroup(tool);
    setInspectorOpen(true);
    setAiOpen(false);
    setSampling(false);
    if (workspaceLayout.panel('inspector').presentation === 'collapsed')
      workspaceLayout.updatePanel('inspector', {
        ...workspaceLayout.panel('inspector'),
        presentation: 'normal',
      });
  };
  const chooseTool = (tool: ToolGroup) => {
    if (group === tool && inspectorOpen && !aiOpen) {
      setInspectorOpen(false);
      setSampling(false);
    } else openInspector(tool);
  };
  const resetWorkspace = () => {
    workspaceLayout.reset();
    setInspectorOpen(false);
    setAiOpen(false);
    setSidebarOpen(false);
    notify('已恢复当前屏幕的默认布局。');
  };
  const openAI = () => {
    workspaceLayout.setFocused(false);
    setAiOpen(true);
    setInspectorOpen(false);
    setSampling(false);
    if (workspaceLayout.panel('ai').presentation === 'collapsed')
      workspaceLayout.updatePanel('ai', { ...workspaceLayout.panel('ai'), presentation: 'normal' });
  };
  const commands: StudioCommand[] = [
    ...toolGroups.map((tool) => ({
      id: 'tool-' + tool.id,
      label: tool.label,
      description: tool.description,
      keywords: tool.id,
      section: '精修工具',
      icon: tool.icon,
      run: () => {
        if (!changeView('editor')) return;
        openInspector(tool.id);
      },
    })),
    {
      id: 'ai',
      label: 'AI 共创',
      description: '图片、文字、语音与创作助手',
      keywords: 'ai agent chat',
      section: '创作空间',
      icon: <Sparkle size={20} />,
      run: () => {
        if (changeView('editor')) openAI();
      },
    },
    ...views
      .filter((item) => item.id !== 'editor')
      .map((item) => ({
        id: 'view-' + item.id,
        label: item.id === 'compare' ? '对比与云端版本' : item.label,
        description: '打开' + item.label + '工作视图',
        keywords: item.id,
        section: '创作空间',
        icon: item.icon,
        run: () => {
          changeView(item.id);
        },
      })),
    {
      id: 'import',
      label: '打开照片',
      description: '从设备选择图片，在本地开始编辑',
      keywords: 'open import',
      section: '常用操作',
      icon: <Plus size={20} />,
      run: () => {
        void importFile();
      },
    },
    {
      id: 'draw',
      label: '画一张草图',
      description: '自由画板，也可作为 AI 生图参考',
      keywords: 'draw sketch',
      section: '常用操作',
      icon: <PencilSimple size={20} />,
      run: () => setDialog('drawing'),
    },
    {
      id: 'export',
      label: '导出图片',
      description: editor.file ? '选择格式与质量，下载编辑结果' : '先打开一张图片',
      keywords: 'download export png jpeg webp',
      section: '常用操作',
      icon: <DownloadSimple size={20} />,
      disabled: !editor.file || opening || editor.loading,
      run: () => setDialog('export'),
    },
    {
      id: 'save',
      label: '保存版本',
      description: editor.file ? '保存到当前创作空间' : '先打开一张图片',
      keywords: 'save cloud',
      section: '常用操作',
      icon: <CloudArrowUp size={20} />,
      disabled: !editor.file || saving || opening || editor.loading,
      run: () => {
        void save();
      },
    },
    {
      id: 'focus',
      label: '专注画面',
      description: '暂时收起工具，按 F 返回',
      keywords: 'focus',
      section: '常用操作',
      icon: <CornersOut size={20} />,
      run: () => workspaceLayout.setFocused(true),
    },
    {
      id: 'help',
      label: '使用说明',
      description: '编辑、协作与格式的实际能力',
      keywords: 'help',
      section: '常用操作',
      icon: <Info size={20} />,
      run: () => setDialog('help'),
    },
  ];
  return (
    <>
      {ops && session.user?.isOperator ? (
        <Suspense
          fallback={
            <div className="content-view">
              <Busy label="正在打开运营管理" />
            </div>
          }
        >
          <OpsDashboard onBack={() => setOps(false)} onConfigChanged={refreshConfig} />
        </Suspense>
      ) : (
        <div
          className={`app-shell canvas-workspace studio-workspace view-${view} theme-${workspaceLayout.layout.theme} ${workspaceLayout.focused ? 'is-focused' : ''}`}
          data-has-image={!!editor.file}
        >
          <Sidebar
            brand={brand}
            logoUrl={brandLogoUrl(config?.brand)}
            session={session}
            spaceId={spaceId}
            projects={projects}
            sharedProjects={sharedProjects}
            selectedProject={project}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onSpace={selectSpace}
            onProject={(next) => void loadProject(next)}
            onNewProject={openCreateProject}
            onNewTeam={() => setDialog('team')}
            onJoinTeam={() => setDialog('join')}
            onTeamSettings={() => setDialog('teamSettings')}
            onAuth={() => setDialog('auth')}
            onLogout={() => void logout()}
            onOps={() => setOps(true)}
          />
          <div className="workspace">
            <header className="floating-topbar" data-motion="topbar">
              <div className="workspace-identity">
                <IconButton label="打开空间与项目" onClick={() => setSidebarOpen(true)}>
                  <List size={21} />
                </IconButton>
                <Brand name={brand} logoUrl={brandLogoUrl(config?.brand)} compact />
                <div className="workspace-project-title">
                  <strong
                    title={artwork?.title ?? project?.title ?? editor.file?.name ?? '本地创作'}
                  >
                    {artwork?.title ?? project?.title ?? '本地创作'}
                  </strong>
                  <span
                    className="workspace-save-state"
                    data-state={
                      saving
                        ? 'saving'
                        : artwork && !dirty
                          ? 'saved'
                          : editor.file
                            ? 'draft'
                            : 'local'
                    }
                    role="status"
                  >
                    {saving
                      ? '正在保存'
                      : artwork && !dirty
                        ? `版本 ${artwork.headVersion} 已保存`
                        : editor.file
                          ? '本地草稿'
                          : '图片不会自动上传'}
                  </span>
                </div>
              </div>
              <nav className="compact-view-tabs" aria-label="工作视图">
                {views.map((item) => (
                  <button
                    key={item.id}
                    className={view === item.id ? 'active' : ''}
                    onClick={() => changeView(item.id)}
                    aria-label={item.label}
                    title={item.label}
                    aria-current={view === item.id ? 'page' : undefined}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
              <select
                className="mobile-view-select"
                aria-label="切换工作视图"
                value={view}
                onChange={(event) => changeView(event.target.value as View)}
              >
                {views.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="workspace-top-actions">
                <IconButton
                  label="搜索工具与操作（Ctrl / ⌘ K）"
                  className="studio-search-trigger"
                  onClick={() => setDialog('commands')}
                >
                  <MagnifyingGlass size={19} />
                </IconButton>
                <IconButton
                  label={workspaceLayout.layout.theme === 'light' ? '切换深灰背景' : '切换浅灰背景'}
                  className="theme-toggle"
                  onClick={() =>
                    workspaceLayout.setTheme(
                      workspaceLayout.layout.theme === 'light' ? 'dark' : 'light',
                    )
                  }
                >
                  {workspaceLayout.layout.theme === 'light' ? (
                    <Moon size={19} />
                  ) : (
                    <Sun size={19} />
                  )}
                </IconButton>
                <IconButton
                  label="专注画面（F）"
                  className="focus-toggle"
                  onClick={() => workspaceLayout.setFocused(true)}
                >
                  <CornersOut size={20} />
                </IconButton>
                <details className="workspace-settings">
                  <summary aria-label="布局与工作台设置">
                    <GearSix size={19} />
                  </summary>
                  <div>
                    <button
                      onClick={() =>
                        workspaceLayout.setTheme(
                          workspaceLayout.layout.theme === 'light' ? 'dark' : 'light',
                        )
                      }
                    >
                      {workspaceLayout.layout.theme === 'light' ? '切换深灰画布' : '切换浅灰画布'}
                    </button>
                    <button onClick={() => setDialog('importSettings')}>
                      图片格式与分辨率预算
                    </button>
                    <button onClick={resetWorkspace}>重置当前屏幕布局</button>
                    <button onClick={() => workspaceLayout.setFocused(true)}>专注画面 · F</button>
                    <button onClick={() => setDialog('help')}>使用说明与能力</button>
                    {session.user && entitlements && (
                      <button onClick={() => setDialog('quota')}>
                        服务点 · {entitlements.available}
                      </button>
                    )}
                  </div>
                </details>
                <button
                  className="button button-secondary top-save"
                  aria-label="保存"
                  disabled={!editor.file || saving || opening || editor.loading}
                  onClick={save}
                >
                  {saving ? <Busy label="" /> : <CloudArrowUp size={18} />}
                  <span>保存</span>
                </button>
                <button
                  className="button button-primary top-export"
                  aria-label="导出"
                  disabled={!editor.file || opening || editor.loading}
                  onClick={() => setDialog('export')}
                >
                  <DownloadSimple size={18} />
                  <span>导出</span>
                </button>
                <button
                  type="button"
                  className={`studio-account ${session.user ? 'is-signed-in' : ''}`}
                  aria-label={session.user ? `账户：${session.user.displayName}` : '登录创作空间'}
                  onClick={() => (session.user ? setSidebarOpen(true) : setDialog('auth'))}
                >
                  {session.user ? session.user.displayName.slice(0, 1) : '登录'}
                </button>
              </div>
            </header>
            {cloudError && (
              <div className="cloud-status" role="status">
                <Info size={16} />
                <span>云端暂不可用，本地编辑可以继续。</span>
                <button
                  onClick={() => {
                    setCloudError(null);
                    refreshConfig();
                    setRefreshToken((value) => value + 1);
                  }}
                >
                  重试
                </button>
              </div>
            )}
            <div className="workspace-body">
              {view === 'editor' ? (
                <>
                  <div
                    className="editor-content"
                    style={{
                      left: canvasInsets.left,
                      right: canvasInsets.right,
                      bottom: canvasInsets.bottom,
                    }}
                  >
                    {editor.file && !workspaceLayout.focused && (
                      <div className="image-action-strip" data-motion="canvas-toolbar">
                        <IconButton label="打开另一张图片" onClick={() => void importFile()}>
                          <Plus size={20} />
                        </IconButton>
                        <IconButton label="打开草图板" onClick={() => setDialog('drawing')}>
                          <PencilSimple size={19} />
                        </IconButton>
                      </div>
                    )}
                    {collaboration.enabled && (
                      <CollaborationStatus
                        collaboration={collaboration}
                        onReload={() => void openArtwork(artwork!.id)}
                        onFork={() => project && void saveToProject(project, true)}
                      />
                    )}
                    <CanvasStage
                      editor={editor}
                      collaboration={collaboration}
                      group={group}
                      onImport={(file) => void importFile(file)}
                      onAI={openAI}
                      onDraw={() => setDialog('drawing')}
                      comparing={comparing}
                      setComparing={setComparing}
                      sampling={sampling}
                      onSample={(color) => {
                        setPickedColor(color);
                        setSampling(false);
                        setGroup('color');
                        setInspectorOpen(true);
                        notify(`已取色 ${color}`);
                      }}
                    />
                  </div>
                  {!workspaceLayout.focused && (
                    <ToolDock
                      group={group}
                      inspectorOpen={inspectorOpen}
                      aiOpen={aiOpen}
                      compact={workspaceLayout.view.bucket === 'phone'}
                      onTool={chooseTool}
                      onAI={() => {
                        if (aiOpen) setAiOpen(false);
                        else openAI();
                      }}
                    />
                  )}
                </>
              ) : (
                <div className="view-container">
                  {view === 'works' && (
                    <div className="library-hub">
                      <nav
                        className="library-context-tabs"
                        aria-label="素材视图"
                        data-motion="context-navigation"
                      >
                        <button
                          type="button"
                          aria-pressed={libraryTab === 'project'}
                          onClick={() => setLibraryTab('project')}
                        >
                          项目作品
                        </button>
                        <button
                          type="button"
                          aria-pressed={libraryTab === 'all'}
                          onClick={() => setLibraryTab('all')}
                        >
                          跨空间查找
                        </button>
                        <button
                          type="button"
                          aria-pressed={libraryTab === 'memory'}
                          onClick={() => setLibraryTab('memory')}
                        >
                          长期素材
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!session.user) setDialog('auth');
                            else if (!project) openCreateProject();
                            else setDialog('mediaImport');
                          }}
                        >
                          原片与专业格式
                        </button>
                      </nav>
                      {libraryTab === 'project' ? (
                        <AssetLibrary
                          project={project}
                          artworks={artworks}
                          space={currentSpace}
                          projects={projects}
                          refreshToken={refreshToken}
                          onSelectProject={(item) => void loadProject(item)}
                          onOpenAsset={(item) => void openLibraryAsset(item)}
                          onOpen={(item) => void openArtwork(item)}
                          onImport={() => void importFile()}
                          onCreate={openCreateProject}
                          onCopy={() => setDialog('copy')}
                          onShare={() => setDialog('share')}
                        />
                      ) : (
                        <ResourceSearch
                          key={libraryTab}
                          spaces={session.spaces}
                          rememberedOnly={libraryTab === 'memory'}
                          onOpen={async (item) => {
                            await openLibraryAsset(item.asset);
                          }}
                        />
                      )}
                    </div>
                  )}{' '}
                  {view === 'compare' && (
                    <CompareView
                      editor={editor}
                      artwork={artwork}
                      onOpenRevision={openRevision}
                      isDirty={dirty}
                      onRestoreRevision={restoreRevision}
                      canRestore={!!project && ['owner', 'admin', 'editor'].includes(project.role)}
                    />
                  )}{' '}
                  {view === 'collaborate' &&
                    (project ? (
                      <CollaborateView
                        key={project.id}
                        currentUserId={session.user?.id}
                        project={project}
                        artwork={artwork}
                        revision={revision}
                        refreshToken={refreshToken}
                        onShare={() => setDialog('share')}
                      />
                    ) : (
                      requireProject
                    ))}{' '}
                  {view === 'docs' &&
                    (project ? (
                      <DocumentsView
                        key={project.id}
                        project={project}
                        refreshToken={refreshToken}
                        onDirtyChange={setDocumentDirty}
                      />
                    ) : (
                      requireProject
                    ))}{' '}
                  {view === 'deliver' && (
                    <DeliveryView
                      editor={editor}
                      artwork={artwork}
                      sourcePending={opening || editor.loading}
                      onExport={() => setDialog('export')}
                      onRecipeImport={() => recipeInput.current?.click()}
                    />
                  )}
                  {view === 'usage' && (
                    <div className="content-view">
                      <UsageDashboard
                        key={currentSpace?.id ?? 'personal'}
                        space={currentSpace}
                        refreshToken={refreshToken}
                      />
                    </div>
                  )}
                </div>
              )}
              {shownPanelId && shownPanel && (
                <FloatingPanel
                  panelKey={shownPanelId}
                  open={!!activePanelId}
                  motionState={panelPresence.phase}
                  title={
                    shownPanelId === 'ai'
                      ? 'AI 创作'
                      : (toolGroups.find((tool) => tool.id === group)?.label ?? '调整')
                  }
                  label={shownPanelId === 'ai' ? 'AI可移动面板' : '可移动编辑面板'}
                  geometry={shownPanel}
                  viewport={workspaceLayout.view}
                  onGeometry={(next) => workspaceLayout.updatePanel(shownPanelId, next)}
                  onClose={() => {
                    setInspectorOpen(false);
                    setAiOpen(false);
                    setSampling(false);
                  }}
                  navigation={
                    <nav className="studio-context-tabs" aria-label="当前作品快捷操作">
                      <button
                        type="button"
                        aria-pressed={shownPanelId === 'inspector' && group !== 'history'}
                        onClick={() => openInspector(group === 'history' ? 'light' : group)}
                      >
                        <SlidersHorizontal size={15} />
                        <span>调整</span>
                      </button>
                      <button type="button" aria-pressed={shownPanelId === 'ai'} onClick={openAI}>
                        <Sparkle size={15} />
                        <span>AI 共创</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => changeView('collaborate')}
                        title="打开项目讨论与任务"
                      >
                        <UsersThree size={15} />
                        <span>协作</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={shownPanelId === 'inspector' && group === 'history'}
                        onClick={() => openInspector('history')}
                      >
                        <ClockCounterClockwise size={15} />
                        <span>记录</span>
                      </button>
                    </nav>
                  }
                >
                  {shownPanelId === 'inspector' ? (
                    <ToolInspector
                      editor={editor}
                      group={group}
                      onGroupChange={setGroup}
                      mobileOpen
                      onClose={() => setInspectorOpen(false)}
                      pickedColor={pickedColor}
                      onColorChange={setPickedColor}
                      sampling={sampling}
                      onSample={() => {
                        setSampling(!sampling);
                        if (workspaceLayout.view.bucket === 'phone') setInspectorOpen(false);
                      }}
                    />
                  ) : (
                    <AIPanelFeature
                      key={(session.user?.id ?? 'local') + ':' + (project?.id ?? 'none')}
                      userId={session.user?.id ?? null}
                      projectAssets={assets}
                      currentAsset={asset}
                      referenceSource={referenceSource}
                      onReferenceFile={(file, source) => {
                        setReferenceFile(file);
                        setReferenceSource(source);
                      }}
                      project={project}
                      artwork={artwork}
                      recipe={editor.recipe}
                      captureCurrentImage={captureCurrentImage}
                      onBeforeArtworkWrite={collaboration.beforeExternalWrite}
                      onAfterArtworkWrite={collaboration.afterExternalWrite}
                      isDirty={dirty}
                      onDecisionApplied={async (id) => {
                        if (isEditorDirty() || artworkRef.current?.id !== id) {
                          notify('云端已采用AI结果，当前本地草稿继续保留，可稍后从作品中打开。');
                          return;
                        }
                        await openArtwork(id);
                      }}
                      config={config}
                      initialOperation={initialAIOperation}
                      referenceFile={referenceFile}
                      onClearReference={() => setReferenceFile(null)}
                      onDraw={() => setDialog('drawing')}
                      onCreateProject={openCreateProject}
                      onOpenArtwork={(id) => {
                        void openArtwork(id).then((opened) => {
                          if (opened) setAiOpen(false);
                        });
                      }}
                      onTaskChanged={() => setRefreshToken((value) => value + 1)}
                      onClose={() => setAiOpen(false)}
                      onPreview={(next) => {
                        editor.preview(next);
                        setView('editor');
                        notify('建议已作为待确认预览进入当前画面；可以继续调整、取消或保存。');
                      }}
                      onSave={save}
                      isLoggedIn={!!session.user}
                      onAuth={() => setDialog('auth')}
                    />
                  )}
                </FloatingPanel>
              )}
              {workspaceLayout.focused && (
                <div className="focus-exit">
                  <button onClick={() => workspaceLayout.setFocused(false)}>
                    <CornersOut size={18} />
                    退出专注 <kbd>F</kbd>
                  </button>
                </div>
              )}
              {opening && (
                <div className="workspace-busy">
                  <Busy label="正在打开项目与作品…" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="选择照片"
        accept="image/jpeg,image/png,image/webp,image/bmp,image/gif,image/avif,image/tiff,.bmp,.gif,.avif,.tif,.tiff"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importFile(file);
        }}
      />
      <input
        ref={recipeInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="选择配方文件"
        accept="application/json,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            editor
              .importRecipe(file)
              .then(() => notify('配方已应用到本地编辑。', 'success'))
              .catch((error) => notify(errorMessage(error), 'error'));
        }}
      />
      <DialogMotionContext.Provider value={{ open: !!dialog, phase: dialogPresence.phase }}>
        {renderedDialog === 'commands' && <CommandMenu commands={commands} onClose={closeDialog} />}
        {renderedDialog === 'drawing' && (
          <Suspense
            fallback={
              <Modal title="准备草图板" onClose={closeDialog}>
                <Busy />
              </Modal>
            }
          >
            <DrawingBoard
              initialColor={pickedColor}
              onClose={closeDialog}
              onUse={(file) => importFile(file)}
              onReference={(file) => {
                if (!changeView('editor')) return false;
                setReferenceFile(file);
                setReferenceSource('sketch');
                setInitialAIOperation('generate-image');
                openAI();
                notify('草图已作为本地参考。确认提交生图时才会上传。');
                return true;
              }}
            />
          </Suspense>
        )}
        {renderedDialog === 'importSettings' && (
          <ImportSettings
            budget={editor.pixelBudget}
            onBudget={editor.setPixelBudget}
            file={pendingImport}
            reason={importReason}
            config={config}
            project={project}
            loggedIn={!!session.user}
            onAuth={() => setDialog('auth')}
            onCreateProject={openCreateProject}
            onRetry={() => importFile(pendingImport ?? undefined)}
            onServerImport={serverImport}
            onProfessionalImport={() => setDialog('mediaImport')}
            onClose={closeDialog}
          />
        )}
        {renderedDialog === 'mediaImport' && project && (
          <MediaImportDialog
            project={project}
            onClose={closeDialog}
            onImported={async (imported) => {
              await openLibraryAsset(imported);
              setRefreshToken((value) => value + 1);
              setDialog(null);
            }}
          />
        )}
        {renderedDialog === 'auth' && (
          <AuthPanel
            config={config}
            onSession={receiveSession}
            onClose={() => setDialog(pendingImport ? 'importSettings' : null)}
          />
        )}
        {renderedDialog === 'project' && (
          <NameDialog
            kind="project"
            defaultName={editor.file ? boundedTitle(filenameBase(editor.file.name)) : ''}
            onSubmit={createProject}
            onClose={() => setDialog(pendingImport ? 'importSettings' : null)}
          />
        )}
        {renderedDialog === 'team' && (
          <NameDialog kind="team" onSubmit={createTeam} onClose={closeDialog} />
        )}
        {renderedDialog === 'join' && (
          <NameDialog kind="join" onSubmit={joinTeam} onClose={closeDialog} />
        )}
        {renderedDialog === 'teamSettings' && currentSpace && (
          <TeamDialog
            space={currentSpace}
            onClose={closeDialog}
            onMembershipChanged={() => {
              void api<Session>('/session')
                .then(setSession)
                .catch((error) => notify(errorMessage(error), 'error'));
              setRefreshToken((n) => n + 1);
            }}
          />
        )}
        {renderedDialog === 'copy' && project && (
          <CopyProjectDialog
            project={project}
            spaces={session.spaces}
            onClose={closeDialog}
            onCopied={(copied) => {
              setSpaceId(copied.spaceId);
              setRefreshToken((value) => value + 1);
              void loadProject(copied);
              notify('独立副本已创建。', 'success');
            }}
          />
        )}
        {renderedDialog === 'share' && project && (
          <ShareDialog project={project} onClose={closeDialog} />
        )}
        {renderedDialog === 'export' && editor.file && (
          <ExportDialog
            editor={editor}
            sourcePending={opening || editor.loading}
            onClose={closeDialog}
            onSuccess={(message) => notify(message, 'success')}
          />
        )}
        {renderedDialog === 'conflict' && (
          <Modal
            title="云端已经有了更新"
            subtitle="你的本地编辑仍然保留，没有覆盖队友的新版本。"
            onClose={closeDialog}
          >
            <p className="dialog-copy">
              可以先保留当前编辑，也可以把这份修改保存为独立作品，再到项目中比较两份结果。
            </p>
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={closeDialog}>
                保留本地编辑
              </button>
              <button
                className="button button-primary"
                disabled={saving}
                onClick={() => {
                  if (project) void saveToProject(project, true);
                }}
              >
                {saving ? <Busy /> : '另存为独立分支'}
              </button>
            </div>
          </Modal>
        )}
        {renderedDialog === 'quota' && entitlements && (
          <Modal
            title="你的服务点"
            subtitle={currentSpace?.name ?? '当前空间'}
            onClose={closeDialog}
          >
            <div className="quota-balance">
              <Sparkle size={30} />
              <strong>{entitlements.available}</strong>
              <span>可用服务点</span>
            </div>
            <div className="quota-detail">
              <div>
                <span>免费权益可用</span>
                <strong>{entitlements.freeAvailable}</strong>
              </div>
              <div>
                <span>购买权益可用</span>
                <strong>{entitlements.purchasedAvailable}</strong>
              </div>
              <div>
                <span>任务占用</span>
                <strong>{entitlements.held}</strong>
              </div>
            </div>
            <p className="form-hint">
              点数用于已开放的云端能力，本地手动编辑不消耗服务点。团队额度与个人额度分别计算。
            </p>
            <button
              className="button button-secondary"
              onClick={() => {
                setDialog(null);
                setInspectorOpen(false);
                setAiOpen(false);
                setView('usage');
              }}
            >
              <ChartBar size={17} />
              查看用量历史与趋势
            </button>
          </Modal>
        )}
        {renderedDialog === 'help' && (
          <Modal title={`在${brand}，自在创作`} onClose={closeDialog}>
            <div className="help-list">
              <section>
                <SlidersHorizontal size={24} />
                <div>
                  <h3>先从一张照片开始</h3>
                  <p>
                    先在照片下方选择调节、人像、局部或构图，再展开需要的工具。支持多区域、曲线、四角透视、绘制、修复和图层合成；照片先在本机处理。
                  </p>
                </div>
              </section>
              <section>
                <CloudArrowUp size={24} />
                <div>
                  <h3>喜欢哪一步，就留下它</h3>
                  <p>
                    登录后把作品保存到项目。进入已保存的作品后，每次确认调整会同步为新版本；冲突时保留本地草稿，可以另存分支。
                  </p>
                </div>
              </section>
              <section>
                <UsersThree size={24} />
                <div>
                  <h3>让队友接上你的想法</h3>
                  <p>
                    创建团队、邀请成员，在同一张作品上查看队员游标和编辑范围。相同区域会先取得编辑权；也可以在项目里讨论、写文档和跟进任务。
                  </p>
                </div>
              </section>
              <section>
                <ShieldCheck size={24} />
                <div>
                  <h3>清楚知道作品去了哪里</h3>
                  <p>
                    打开本地照片不会自动上传。AI
                    默认使用你提交的文字和参数；主动开启共享画面后会发送当前图片预览，选择参考图或开始语音也会发送对应内容。模型、服务点与能力在执行前显示。
                  </p>
                </div>
              </section>
            </div>
            <p className="fine-print">
              本地格式以头部检查与浏览器解码为准，PNG / JPEG / WebP / BMP / 静态 GIF / AVIF
              可按实际支持导入；TIFF 可明确上传规范化。当前本机预算{' '}
              {(editor.pixelBudget / 1e6).toFixed(1)}{' '}
              百万像素，可在设置中修改；云端另有服务限制。细节滤镜请在导出的原尺寸图片上复核。
            </p>
          </Modal>
        )}
      </DialogMotionContext.Provider>
      <Toast notice={notice} dismiss={dismissNotice} />
    </>
  );
}
