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
import { FloatingPanel } from './workspace/FloatingPanel';
import { panelBottomOffset, useWorkspaceLayout } from './workspace/useWorkspaceLayout';
import { usePresence } from './motion/usePresence';
import { ImportSettings } from './components/ImportSettings';
import { createRecipeV2, parseEditorRecipe } from '@ai-xiutu/editor';
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
  | null;
export function App() {
  const editor = useEditor();
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
  const [savedRecipe, setSavedRecipe] = useState<string | null>(null);
  const [documentDirty, setDocumentDirty] = useState(false);
  const [view, setView] = useState<View>('editor');
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
  const brand = config?.brand.name || DEFAULT_BRAND;
  const currentSpace = session.spaces.find((s) => s.id === spaceId) ?? null;
  const dirty = !!editor.file && JSON.stringify(editor.recipe) !== savedRecipe;
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
      if (document.querySelector('dialog[open]')) return;
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? editor.redo() : editor.undo();
      }
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
  async function importFile(file?: File): Promise<boolean> {
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return false;
    }
    if (!file) {
      fileInput.current?.click();
      return false;
    }
    if (dirty && !window.confirm('当前还有未保存的编辑。打开新图片将替换本地编辑，确认继续吗？'))
      return false;
    const request = ++projectRequest.current;
    editor.cancelPendingLoad();
    try {
      await editor.loadFile(file, undefined, () => request === projectRequest.current);
      if (request !== projectRequest.current) return false;
      setArtwork(null);
      setAsset(null);
      setRevision(null);
      setSavedRecipe(null);
      setView('editor');
      setComparing(false);
      setInspectorOpen(false);
      setSampling(false);
      setPendingImport(null);
      setImportReason(null);
      notify('图片已打开，尚未上传。', 'success');
      return true;
    } catch (e) {
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

  async function openArtwork(next: Artwork | string): Promise<boolean> {
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return false;
    }
    if (
      dirty &&
      !window.confirm(
        '当前还有未保存的编辑。打开云端作品前，请确认已导出或不再需要这些修改。继续打开吗？',
      )
    )
      return false;
    const id = typeof next === 'string' ? next : next.id;
    const req = ++projectRequest.current;
    editor.cancelPendingLoad();
    setOpening(true);
    try {
      const data = await api<{ artwork: Artwork; asset: Asset; revision: Revision }>(
        `/artworks/${id}`,
      );
      if (req !== projectRequest.current) return false;
      const response = await fetch(data.asset.url, { credentials: 'include' });
      if (!response.ok) throw new Error('暂时无法读取这张图片，请检查项目访问权限后重试。');
      const blob = await response.blob();
      if (req !== projectRequest.current) return false;
      const file = new File([blob], data.asset.name, { type: blob.type || data.asset.mime });
      await editor.loadFile(file, data.revision.recipe, () => req === projectRequest.current);
      if (req !== projectRequest.current) return false;
      setArtwork(data.artwork);
      setAsset(data.asset);
      setRevision(data.revision);
      setSavedRecipe(JSON.stringify(parseEditorRecipe(data.revision.recipe)));
      setView('editor');
      setComparing(false);
      notify(`已打开「${data.artwork.title}」版本 ${data.artwork.headVersion}。`, 'success');
      return true;
    } catch (e) {
      if (req === projectRequest.current) notify(errorMessage(e), 'error');
      return false;
    } finally {
      if (req === projectRequest.current) setOpening(false);
    }
  }

  async function openLibraryAsset(next: Asset) {
    if (!project || next.projectId !== project.id) return;
    if (saveLock.current) {
      notify('作品正在保存，请稍等片刻。');
      return;
    }
    if (dirty && !window.confirm('当前还有未保存的编辑。打开素材原图会替换本地草稿，继续吗？'))
      return;
    const request = ++projectRequest.current;
    editor.cancelPendingLoad();
    setOpening(true);
    try {
      const response = await fetch(next.url, { credentials: 'include' });
      if (!response.ok) throw new Error('无法读取素材，请刷新当前项目权限后重试。');
      const blob = await response.blob();
      if (request !== projectRequest.current) return;
      await editor.loadFile(
        new File([blob], next.name, { type: blob.type || next.mime }),
        undefined,
        () => request === projectRequest.current,
      );
      if (request !== projectRequest.current) return;
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
      if (request === projectRequest.current) notify(errorMessage(error), 'error');
    } finally {
      if (request === projectRequest.current) setOpening(false);
    }
  }

  async function saveToProject(target: Project, asNew = false) {
    if (!editor.file || saveLock.current) return;
    if (editor.isLoading() || opening) {
      notify('图片正在准备中，请加载完成后再保存。');
      return;
    }
    const snapshot = structuredClone(editor.recipe);
    const savedFile = editor.file;
    const savedSource = editor.getSourceIdentity();
    const savedContext = projectRequest.current;
    saveLock.current = true;
    setSaving(true);
    try {
      let currentAsset = asset;
      if (!currentAsset || currentAsset.projectId !== target.id) {
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
        if (savedSource !== editor.getSourceIdentity() || savedContext !== projectRequest.current)
          throw new Error('源图片或项目已切换，本次素材保留在原项目，未绑定到当前画面。');
        setAsset(currentAsset);
      }
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
                title: `${filenameBase(savedFile.name)}${asNew ? ' · 独立分支' : ''}`,
                recipe: snapshot,
              }),
            );
      if (savedSource !== editor.getSourceIdentity() || savedContext !== projectRequest.current) {
        notify('原作品版本已保存，但当前画面已切换，因此未替换当前编辑绑定。');
        setRefreshToken((value) => value + 1);
        return;
      }
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
    if (pendingImport.size > (config?.media?.maxUploadBytes ?? config?.limits.maxUploadBytes ?? 0))
      throw new Error('这份文件超过当前服务端上传上限。没有上传，请使用较小副本或调整服务配置。');
    const form = new FormData();
    form.append('file', pendingImport);
    const uploaded = await api<{ asset: Asset }>(`/projects/${project.id}/assets`, {
      method: 'POST',
      body: form,
    });
    const result = await api<{ artwork: Artwork; revision: Revision }>(
      `/projects/${project.id}/artworks`,
      jsonRequest('POST', {
        assetId: uploaded.asset.id,
        title: filenameBase(pendingImport.name),
        recipe: createRecipeV2(),
      }),
    );
    setPendingImport(null);
    setImportReason(null);
    await refreshProject(project.id);
    setRefreshToken((value) => value + 1);
    if (uploaded.asset.width * uploaded.asset.height <= editor.pixelBudget) {
      await openArtwork(result.artwork);
    } else {
      setView('works');
      notify(
        '规范化PNG与新作品已保存到项目。当前设备预算不足以打开全尺寸，请调高合理预算或在其他设备继续。',
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
      return;
    setView(next);
    setInspectorOpen(false);
    setAiOpen(false);
  }
  function openRevision(next: Revision) {
    editor.commit(next.recipe, `查看云端版本 ${next.version}`);
    setRevision(next);
    setView('editor');
    notify(`版本 ${next.version} 已作为本地编辑打开。云端最新版本尚未改变。`);
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
  const canvasInsets = {
    left: activePanel?.dock === 'left' ? activePanel.width + 24 : 0,
    right: activePanel?.dock === 'right' ? activePanel.width + 24 : 0,
    bottom:
      activePanel?.dock === 'bottom'
        ? activePanel.height + panelBottomOffset(workspaceLayout.view) + 10
        : workspaceLayout.focused
          ? 0
          : workspaceLayout.view.bucket === 'phone'
            ? 66
            : workspaceLayout.view.height < 500
              ? 58
              : 78,
  };
  const chooseTool = (tool: ToolGroup) => {
    setGroup(tool);
    setInspectorOpen(group !== tool || !inspectorOpen);
    setAiOpen(false);
    setSampling(false);
  };
  const resetWorkspace = () => {
    workspaceLayout.reset();
    setInspectorOpen(false);
    setAiOpen(false);
    setSidebarOpen(false);
    notify('已恢复当前屏幕的默认布局。');
  };
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
          className={`app-shell canvas-workspace view-${view} theme-${workspaceLayout.layout.theme} ${workspaceLayout.focused ? 'is-focused' : ''}`}
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
                  <strong>{project?.title ?? '本地创作'}</strong>
                  <span>
                    {saving
                      ? '正在保存'
                      : artwork && !dirty
                        ? '版本已保存'
                        : editor.file
                          ? '尚有本地编辑'
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
                    <CanvasStage
                      editor={editor}
                      group={group}
                      onImport={(file) => void importFile(file)}
                      onAI={() => setAiOpen(true)}
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
                    <nav
                      className="floating-tool-dock"
                      aria-label="编辑工具"
                      data-motion="tool-dock"
                    >
                      {toolGroups.map((tool) => (
                        <button
                          key={tool.id}
                          data-motion="tool-item"
                          className={group === tool.id && inspectorOpen ? 'active' : ''}
                          aria-pressed={group === tool.id && inspectorOpen}
                          onClick={() => chooseTool(tool.id)}
                        >
                          {tool.icon}
                          <span>{tool.label}</span>
                        </button>
                      ))}
                      <span className="dock-divider" />
                      <button
                        className={aiOpen ? 'active ai-tool' : 'ai-tool'}
                        aria-pressed={aiOpen}
                        onClick={() => {
                          setAiOpen(!aiOpen);
                          setInspectorOpen(false);
                        }}
                      >
                        <Sparkle size={22} />
                        <span>AI</span>
                      </button>
                    </nav>
                  )}
                </>
              ) : (
                <div className="view-container">
                  {view === 'works' && (
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
                  )}{' '}
                  {view === 'compare' && (
                    <CompareView editor={editor} artwork={artwork} onOpenRevision={openRevision} />
                  )}{' '}
                  {view === 'collaborate' &&
                    (project ? (
                      <CollaborateView
                        key={project.id}
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
                      onExport={() => setDialog('export')}
                      onRecipeImport={() => recipeInput.current?.click()}
                    />
                  )}
                </div>
              )}
              {shownPanelId && shownPanel && (
                <FloatingPanel
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
                >
                  {shownPanelId === 'inspector' ? (
                    <ToolInspector
                      editor={editor}
                      group={group}
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
                        editor.commit(next, '预览AI建议');
                        setView('editor');
                        notify('建议已进入本地编辑，可以继续调整或撤销。');
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
                setReferenceFile(file);
                setReferenceSource('sketch');
                setInitialAIOperation('generate-image');
                setAiOpen(true);
                setInspectorOpen(false);
                notify('草图已作为本地参考。确认提交生图时才会上传。');
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
            onClose={closeDialog}
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
            defaultName={editor.file ? filenameBase(editor.file.name) : ''}
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
          <TeamDialog space={currentSpace} onClose={closeDialog} />
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
                    当前支持明暗、色彩、RGB曲线、裁切旋转、径向局部调整、锐化与柔化。照片先在本机处理。
                  </p>
                </div>
              </section>
              <section>
                <CloudArrowUp size={24} />
                <div>
                  <h3>喜欢哪一步，就留下它</h3>
                  <p>登录后把作品保存到项目。每次保存创建新版本，发生冲突时可以另存分支。</p>
                </div>
              </section>
              <section>
                <UsersThree size={24} />
                <div>
                  <h3>让队友接上你的想法</h3>
                  <p>
                    创建团队、邀请成员，在项目里讨论、写文档和跟进任务。共享时选择具体接收者与范围。
                  </p>
                </div>
              </section>
              <section>
                <ShieldCheck size={24} />
                <div>
                  <h3>清楚知道作品去了哪里</h3>
                  <p>
                    打开照片不会自动上传。AI
                    调整只发送文字和参数；生图会发送你确认的参考草图；语音需要单独确认发送。具体能力按服务设置开放。
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
