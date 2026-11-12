import './studio-styles.css';
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CloudArrowUp,
  DownloadSimple,
  Info,
  List,
  Plus,
  SlidersHorizontal,
  Sparkle,
  UsersThree,
  ArrowRight,
  ShieldCheck,
  PencilSimple,
  CornersOut,
  ChartBar,
  MagnifyingGlass,
  Images,
  BookmarkSimple,
  FileImage,
  ClockCounterClockwise,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  X,
} from '@phosphor-icons/react';
import { api, ApiError, downloadBlob, errorMessage, filenameBase, jsonRequest } from './lib/api';
import { secureUuid } from './lib/uuid';
import { t, useLocale } from './i18n';
import { createSampleRecipe, getSampleImage, type SampleSettings } from './about/sample';
import { aboutCopy } from './about/copy';
import { isAccountSiteRoute, type SiteRoute } from './about/site-route';
import { AccountPageFrame } from './account/AccountPageFrame';
import { accountPageCopy } from './account/page-copy';
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
import type { AssistantVisualAttachment } from '@ai-xiutu/contracts';
import { useEditor, localPixelBudget, LocalImportError } from './editor/useEditor';
import { normalizeImageSourceFile } from './editor/imageSources';
import { createSourceLoadGuard, assertRevisionSourceBinding } from './editor/source-flow';
import { assetCopyAttempt, sourcePersistenceRoute } from './lib/asset-copy';
import { FloatingPanel } from './workspace/FloatingPanel';
import { ADJUSTMENT_GROUPS, ToolDock } from './workspace/ToolDock';
import { ToolOverview } from './workspace/ToolOverview';
import { PanelNavigation, type PanelSection } from './workspace/PanelNavigation';
import { interactionText } from './workspace/interaction-copy';
import { WorkspaceViewTabs } from './workspace/WorkspaceViewTabs';
import { CommandMenu, type StudioCommand } from './workspace/CommandMenu';
import {
  WorkspaceNavigation,
  WorkspaceSettings,
  workspaceViews,
} from './workspace/WorkspaceNavigation';
import type { StudioThemeController } from './workspace/useStudioTheme';
import { StudioGlyph } from './components/StudioGlyph';
import { RubberSegment } from './components/control-motion';
import { boundedTitle } from './lib/titles';
import { workspaceCanvasInsets, useWorkspaceLayout } from './workspace/useWorkspaceLayout';
import { usePresence } from './motion/usePresence';
import { MotionSwitch } from './motion/Presence';
import { ImportSettings } from './components/ImportSettings';
import {
  createDeferredFeature,
  DeferredFeatureStatus,
  FeatureSkeleton,
} from './components/DeferredFeature';
import {
  createRecipeV4,
  parseEditorRecipe,
  MAX_V3_PIXELS,
  type CutoutSettings,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import { DEFAULT_BRAND, brandLogoUrl } from './lib/brand';

import { CanvasStage } from './editor/CanvasStage';
import { ToolInspector, toolGroups, type ToolGroup } from './editor/ToolInspector';
import { AuthPanel, type AuthMode, type AuthSessionMeta } from './components/AuthPanel';
import { AuthCooldowns, isAuthSession } from './account/auth-model';
import { SessionFence, type SessionSnapshot } from './account/session-lifecycle';
import { AccountReady } from './account/AccountReady';
import {
  clearDocumentDraftsForActor,
  documentDrafts,
  getDocumentDraftCount,
  subscribeDocumentDrafts,
} from './account/document-drafts';
import { modalMotionRoleForDialog } from './components/modal-profiles';
import type { AIOperation } from './components/AIPanel';
import { AIPanelFeature } from './components/AIPanelFeature';
import { IDLE_AI_ACTIVITY, type AIActivity } from './ai/AIVisibility';
import { useConfirmation } from './components/ConfirmationDialog';
import { confirmStableScope } from './lib/confirmation-scope';
import { Sidebar } from './components/Sidebar';
import {
  Brand,
  Busy,
  DialogMotionContext,
  EmptyState,
  IconButton,
  Modal,
  Toast,
} from './components/Ui';
import { useCollaboration } from './collaboration/useCollaboration';
import { CollaborationStatus } from './collaboration/CollaborationStatus';
import { TeamVoiceBanner } from './collaboration/TeamVoiceBanner';
import { useTeamVoice } from './collaboration/useTeamVoice';
import { captureRenderedImage, captureSketchVisual, captureWorkspaceVisual } from './editor/capture';
import {
  ExportDialog,
  NameDialog,
  ShareDialog,
  TeamDialog,
  CopyProjectDialog,
} from './components/ProjectDialogs';
const OpsDashboard = createDeferredFeature(
  async () => ({ default: (await import('./components/OpsDashboard')).OpsDashboard }),
  '运营管理',
  (state, props) => (
    <div className="content-view">
      <DeferredFeatureStatus {...state} profile="operations" onBack={props.onBack} />
    </div>
  ),
  'operations',
);
const DrawingBoard = createDeferredFeature(
  async () => ({ default: (await import('./components/DrawingBoard')).DrawingBoard }),
  '草图板',
  (state, props) => (
    <Modal title={t('准备草图板')} onClose={props.onClose}>
      <DeferredFeatureStatus {...state} profile="drawing" onBack={props.onClose} />
    </Modal>
  ),
  'drawing',
);
const CompareView = createDeferredFeature(
  async () => ({ default: (await import('./components/WorkspaceViews')).CompareView }),
  '版本比较',
  undefined,
  'compare',
);
const CollaborateView = createDeferredFeature(
  async () => ({ default: (await import('./components/WorkspaceViews')).CollaborateView }),
  '项目协作',
  undefined,
  'collaboration',
);
const DocumentsView = createDeferredFeature(
  async () => ({ default: (await import('./components/WorkspaceViews')).DocumentsView }),
  '项目文档',
  undefined,
  'documents',
);
const DeliveryView = createDeferredFeature(
  async () => ({ default: (await import('./components/WorkspaceViews')).DeliveryView }),
  '作品交付',
  undefined,
  'delivery',
);
const AssetLibrary = createDeferredFeature(
  async () => ({ default: (await import('./components/AssetLibrary')).AssetLibrary }),
  '素材库',
  undefined,
  'gallery',
);
const UsageDashboard = createDeferredFeature(
  async () => ({ default: (await import('./usage/UsageDashboard')).UsageDashboard }),
  '用量账本',
  undefined,
  'usage',
);
const ResourceSearch = createDeferredFeature(
  async () => ({ default: (await import('./resources/ResourceSearch')).ResourceSearch }),
  '资源搜索',
  undefined,
  'search',
);
const MediaImportDialog = createDeferredFeature(
  async () => ({ default: (await import('./components/MediaImportDialog')).MediaImportDialog }),
  '母版导入',
  (state, props) => (
    <Modal title={t('导入母版')} profile="media" onClose={props.onClose}>
      <DeferredFeatureStatus {...state} profile="media" />
    </Modal>
  ),
);
let accountModuleRetry = 0;
let recoveredAccountCenter: typeof import('./account/AccountCenter').AccountCenter | undefined;
const AccountCenter = createDeferredFeature(
  async (retry) => {
    if (recoveredAccountCenter) return { default: recoveredAccountCenter };
    try {
      return { default: (await import('./account/AccountCenter')).AccountCenter };
    } catch (error) {
      if (!retry || !(error instanceof TypeError)) throw error;
      // Chromium remembers a failed module URL for this document. A manual
      // retry gets a fresh URL for the same account chunk without a page reload.
      const failedUrl = error.message.match(/https?:\/\/\S+$/)?.[0];
      if (!failedUrl) throw error;
      const url = new URL(failedUrl);
      if (
        url.origin !== window.location.origin ||
        !/^\/(?:src\/account\/AccountCenter\.tsx|assets\/AccountCenter-[\w-]+\.js)$/.test(
          url.pathname,
        )
      )
        throw error;
      url.searchParams.set('retry', String(++accountModuleRetry));
      const module: typeof import('./account/AccountCenter') = await import(
        /* @vite-ignore */ url.href
      );
      recoveredAccountCenter = module.AccountCenter;
      return { default: recoveredAccountCenter };
    }
  },
  '账号信息',
  (state, props) => (
    <AccountPageFrame
      title={t('账号与使用')}
      config={props.config}
      onBack={props.onClose}
      onHome={props.onHome}
      busy={props.loggingOut}
      wide
    >
      <DeferredFeatureStatus {...state} profile="account" />
    </AccountPageFrame>
  ),
);

const views = workspaceViews.map((item) => ({
  ...item,
  icon: <StudioGlyph name={item.id} size={19} />,
}));
type Dialog =
  | 'auth'
  | 'account'
  | 'accountReady'
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
  | 'navigation'
  | 'settings'
  | null;
export type StudioEntry = {
  key: number;
  mode: 'studio' | 'password' | 'register' | 'reset' | 'account' | 'welcome' | 'usage' | 'sample';
  sample?: SampleSettings;
};
type AppProps = {
  studioTheme: StudioThemeController;
  active?: boolean;
  siteRoute?: SiteRoute;
  accountBackToAbout?: boolean;
  entryRequest?: StudioEntry;
  publicConfig?: PublicConfig | null;
  onAbout?: () => void;
  onEntryCancel?: () => void;
  onEntryComplete?: () => void;
  onPageNavigate?: (route: SiteRoute, replace?: boolean) => void;
  onRegisterLeaveGuard?: (guard: ((next: SiteRoute) => boolean) | null) => void;
};
export function App({
  studioTheme,
  active = true,
  siteRoute = 'studio',
  accountBackToAbout = false,
  entryRequest,
  publicConfig,
  onAbout,
  onEntryCancel,
  onEntryComplete,
  onPageNavigate,
  onRegisterLeaveGuard,
}: AppProps) {
  const locale = useLocale();
  const introduction = aboutCopy(locale);
  const accountCopy = accountPageCopy(locale);
  const activeRef = useRef(active);
  activeRef.current = active;
  const entryHandled = useRef<number | null>(null);
  const entryKey = useRef(entryRequest?.key);
  entryKey.current = entryRequest?.key;
  const entryAuth = useRef(false);
  const authExitGuard = useRef<(() => boolean) | null>(null);
  const registerAuthExitGuard = useCallback((guard: (() => boolean) | null) => {
    authExitGuard.current = guard;
  }, []);
  const postLoginRoute = useRef<SiteRoute>('studio');
  const registeredActor = useRef<string | null>(null);
  const accountReturnFocus = useRef<HTMLElement | null>(null);
  const rawEditor = useEditor();
  const workspaceLayout = useWorkspaceLayout();
  const workspaceSurface = useRef<HTMLDivElement>(null);
  const capturingWorkspace = useRef(false);
  const restoreInspectorAfterAI = useRef(false);
  const [visualDraft, setVisualDraft] = useState<{
    scope: string;
    recipe: EditorRecipe;
    attachment: AssistantVisualAttachment;
  } | null>(null);
  const [pickedColor, setPickedColor] = useState('#34372EFF');
  const [sampling, setSampling] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importReason, setImportReason] = useState<string | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceSource, setReferenceSource] = useState<'sketch' | 'upload'>('sketch');
  const [initialAIOperation, setInitialAIOperation] = useState<AIOperation>('edit-plan');
  const [config, setConfig] = useState<PublicConfig | null>(publicConfig ?? null);
  const [session, setSession] = useState<Session>({ user: null, spaces: [] });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [sessionFence] = useState(() => new SessionFence());
  const [authCooldowns] = useState(() => new AuthCooldowns());
  const authIntent = useRef(0);
  const [authEntry, setAuthEntry] = useState<{ mode: AuthMode; key: number }>({
    mode: 'password',
    key: 0,
  });
  const authOwner = useRef<SessionSnapshot>(sessionFence.snapshot());
  const authCompleted = useRef(false);
  const postAuthDialog = useRef<Dialog>(null);
  const [accountEntry, setAccountEntry] = useState<{
    tab: 'overview' | 'security' | 'billing' | 'data';
    key: number;
  }>({ tab: 'overview', key: 0 });
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudNoticeDismissed, setCloudNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!cloudError) setCloudNoticeDismissed(false);
  }, [cloudError]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const teamVoiceArtwork =
    session.user &&
    project &&
    session.spaces.some((space) => space.id === project.spaceId && space.kind === 'team')
      ? artwork?.id
      : undefined;
  const teamVoice = useTeamVoice(teamVoiceArtwork, session.user?.id);
  const [asset, setAsset] = useState<Asset | null>(null);
  const cutoutAttempt = useRef<{ key: string; id: string } | null>(null);
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
  const retainedDocumentCount = useSyncExternalStore(
    subscribeDocumentDrafts,
    getDocumentDraftCount,
    () => 0,
  );
  const [view, setView] = useState<View>('editor');
  const [libraryTab, setLibraryTab] = useState<'project' | 'all' | 'memory'>('project');
  const [group, setGroup] = useState<ToolGroup>('light');
  const [previousTools, setPreviousTools] = useState<ToolGroup[]>([]);
  const [toolOverview, setToolOverview] = useState(false);
  const sourceForTools = rawEditor.getSourceIdentity();
  useEffect(() => {
    setPreviousTools([]);
    setToolOverview(false);
  }, [sourceForTools]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const aiOpenRef = useRef(aiOpen);
  aiOpenRef.current = aiOpen;
  const [inspectorVisited, setInspectorVisited] = useState(false);
  const [aiVisited, setAiVisited] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [collaborationVisited, setCollaborationVisited] = useState(false);
  const panelNavigationFocus = useRef<PanelSection | null>(null);
  useEffect(() => {
    if (inspectorOpen) setInspectorVisited(true);
  }, [inspectorOpen]);
  useEffect(() => {
    if (aiOpen) setAiVisited(true);
  }, [aiOpen]);
  useEffect(() => {
    if (collaborationOpen || view === 'collaborate') setCollaborationVisited(true);
  }, [collaborationOpen, view]);
  const [aiActivity, setAiActivity] = useState<AIActivity>(IDLE_AI_ACTIVITY);
  const accountActivity = useRef({ ai: false, voice: false });
  accountActivity.current = {
    ai: aiActivity.callActive || aiActivity.requestActive,
    voice: teamVoice.state !== 'idle',
  };
  const [comparing, setComparing] = useState(false);
  const [ops, setOps] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const accountPageOpen = dialog === 'auth' || dialog === 'account' || dialog === 'accountReady';
  const accountPagePending =
    isAccountSiteRoute(siteRoute) && (booting || entryHandled.current !== entryRequest?.key);
  const workspaceVisible = !accountPageOpen && !accountPagePending;
  activeRef.current = active && workspaceVisible;
  const accountRouteRef = useRef(false);
  accountRouteRef.current = isAccountSiteRoute(siteRoute);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [noticeContainer, setNoticeContainer] = useState<HTMLDivElement | null>(null);
  const [canvasStatusContainer, setCanvasStatusContainer] = useState<HTMLDivElement | null>(null);
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
  const projectRefresh = useRef(0);
  const saveAfterProject = useRef(false);
  const saveLock = useRef(false);
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = project?.id ?? null;
  const notify = useCallback(
    (message: string, tone: Notice['tone'] = 'info') => setNotice({ message, tone }),
    [],
  );
  const dismissNotice = useCallback(() => setNotice(null), []);
  const closeDialog = useCallback(() => {
    setDialog(null);
    if (accountRouteRef.current) {
      onEntryComplete?.();
      restoreAccountFocus();
    }
  }, [onEntryComplete]);
  useEffect(() => {
    if (active) return;
    if (dialogRef.current === 'auth' && !authCompleted.current) void reconcileSession();
    postLoginRoute.current = 'studio';
    setDialog(null);
    setSidebarOpen(false);
    entryAuth.current = false;
  }, [active]);
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
        : Promise.reject(new Error(t('项目已改变，请重新打开作品。'))),
    resolveReferences: resolveLayerReferences,
  });
  const editor = collaboration.editor;
  const sourceIdentity = editor.getSourceIdentity();
  const visualScope = JSON.stringify([session.user?.id, project?.id, artwork?.id, sourceIdentity]);
  const visualScopeRef = useRef(visualScope);
  visualScopeRef.current = visualScope;
  const visualAttachment = visualDraft?.scope === visualScope ? visualDraft.attachment : null;
  useEffect(() => {
    setVisualDraft((draft) => (draft?.scope === visualScope ? draft : null));
  }, [visualScope]);
  const confirmation = useConfirmation();
  const navigationScope = useRef({
    actor: session.user?.id,
    spaceId,
    projectId: project?.id,
    artworkId: artwork?.id,
    version: artwork?.headVersion,
    view,
    documentDirty,
  });
  navigationScope.current = {
    actor: session.user?.id,
    spaceId,
    projectId: project?.id,
    artworkId: artwork?.id,
    version: artwork?.headVersion,
    view,
    documentDirty,
  };
  async function confirmNavigation(
    description: string,
    labels?: { title: string; confirmLabel: string; cancelLabel?: string },
  ) {
    const result = await confirmStableScope(
      () => ({
        ...navigationScope.current,
        sessionEpoch: sessionFence.snapshot().epoch,
        documentDraft: documentDrafts.get(
          sessionFence.snapshot().actor,
          navigationScope.current.projectId ?? '',
        )?.revision,
        retainedDocuments: getDocumentDraftCount(sessionFence.snapshot().actor),
        source: editor.getSourceIdentity(),
        recipe: editor.getRecipe(),
        request: projectRequest.current,
        saving: saveLock.current,
      }),
      () => confirmation.confirm({ ...labels, description }),
    );
    if (result === 'changed') notify(t('工作区已更新，请核对当前内容后重新操作。'));
    return result === 'confirmed';
  }
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
      throw new Error(t('画面还在更新，请就绪后共享当前图片。'));
    const before = editor.getRecipe(),
      identity = editor.getSourceIdentity();
    if (JSON.stringify(before) !== JSON.stringify(editor.renderedRecipe))
      throw new Error(t('最新编辑还没有完成渲染，请稍后再共享。'));
    const imageDataUrl = await captureRenderedImage(editor.rendered);
    if (
      identity !== editor.getSourceIdentity() ||
      before !== editor.getRecipe() ||
      artworkRef.current?.id !== current.id ||
      artworkRef.current.headVersion !== current.headVersion
    )
      throw new Error(t('共享期间画面已变化，请重新获取上下文。'));
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

  function clearCloudWorkspace() {
    ++projectRequest.current;
    editor.cancelPendingLoad();
    setOpening(false);
    setProjects([]);
    setSharedProjects([]);
    setEntitlements(null);
    setProject(null);
    setAssets([]);
    setArtworks([]);
    setArtwork(null);
    setAsset(null);
    setRevision(null);
    setSavedRecipe(null);
    uploadedLayerAliases.current.clear();
    uploadedBaseAssets.current.clear();
    // The local photo remains visible. Keep its cloud provenance so a later
    // account/project save must still use the server-authorized copy path.
    saveAfterProject.current = false;
    setOps(false);
    setAiOpen(false);
    setCollaborationOpen(false);
    setSidebarOpen(false);
  }

  function showSession(next: Session, previousActor: string | null) {
    const changed = previousActor !== (next.user?.id ?? null);
    if (changed) registeredActor.current = null;
    const previousMembership = sessionRef.current.spaces.find(
      (space) => space.id === navigationScope.current.spaceId,
    );
    const nextMembership = next.spaces.find((space) => space.id === previousMembership?.id);
    const lostMembership = !changed && !!previousMembership && !nextMembership;
    if (changed || lostMembership) clearCloudWorkspace();
    if (lostMembership) notify(t('当前空间的访问权限已变化。照片仍在本机，请选择可访问的空间。'));
    else if (
      previousMembership &&
      nextMembership &&
      previousMembership.role !== nextMembership.role
    ) {
      ++projectRequest.current;
      ++projectRefresh.current;
      editor.cancelPendingLoad();
      setOpening(false);
      setRefreshToken((value) => value + 1);
    }
    sessionRef.current = next;
    setSession(next);
    setSpaceId((current) =>
      !changed && next.spaces.some((space) => space.id === current)
        ? current
        : (next.spaces.find((space) => space.kind === 'personal')?.id ?? null),
    );
    setLoggingOut(false);
  }

  function replaceSession(next: Session) {
    const previousActor = sessionFence.snapshot().actor;
    sessionFence.replace(next.user?.id ?? null);
    showSession(next, previousActor);
  }

  async function reconcileSession() {
    const owner = sessionFence.read();
    if (!owner) return null;
    try {
      const next = await api<unknown>('/session');
      if (!isAuthSession(next)) throw new Error(t('账号状态暂时无法确认，请稍后重试。'));
      if (!sessionFence.acceptRead(owner, next.user?.id ?? null)) return null;
      showSession(next, owner.actor);
      if (owner.actor && !next.user) {
        notify(
          getDocumentDraftCount(owner.actor) > 0
            ? t(
                '登录已失效。未保存文档已在本页临时保留，重新登录原账号并打开项目即可恢复；请勿关闭页面。',
              )
            : t('登录已失效。当前照片仍在本机，可以导出或重新登录。'),
        );
      }
      return next;
    } catch (error) {
      if (sessionFence.ownsRead(owner)) setCloudError(errorMessage(error));
      return null;
    }
  }

  function rememberAccountFocus() {
    const target = document.activeElement;
    if (target instanceof HTMLElement && target.closest('.site-workspace-frame'))
      accountReturnFocus.current = target;
  }
  function restoreAccountFocus() {
    const target = accountReturnFocus.current;
    requestAnimationFrame(() => {
      if (target?.isConnected && !target.closest('[hidden], [inert]'))
        target.focus({ preventScroll: true });
    });
  }
  function openAuth(mode: AuthMode = 'password', fromRoute = false) {
    if (sessionFence.busy) return;
    rememberAccountFocus();
    sessionFence.invalidateReads();
    authOwner.current = sessionFence.snapshot();
    authCompleted.current = false;
    postAuthDialog.current = null;
    setAuthEntry({ mode, key: ++authIntent.current });
    setSidebarOpen(false);
    setLogoutError(null);
    setDialog('auth');
    if (!fromRoute) {
      postLoginRoute.current = 'studio';
      onPageNavigate?.(mode === 'register' || mode === 'reset' ? mode : 'login');
    }
  }

  function closeAuth(intent: number) {
    if (intent !== authIntent.current || dialogRef.current !== 'auth') return;
    const destination = postAuthDialog.current ?? (pendingImport ? 'importSettings' : null);
    postAuthDialog.current = null;
    setDialog(destination);
    entryAuth.current = false;
    // A reset whose response was lost may already have revoked this session.
    if (!authCompleted.current) {
      void reconcileSession();
      postLoginRoute.current = 'studio';
      onEntryCancel?.();
    } else if (destination === 'accountReady') {
      onPageNavigate?.('welcome', true);
    } else if (postLoginRoute.current !== 'studio') {
      onPageNavigate?.(postLoginRoute.current, true);
      postLoginRoute.current = 'studio';
    } else {
      onEntryComplete?.();
    }
    restoreAccountFocus();
  }

  function openAccount(tab: typeof accountEntry.tab = 'overview', fromRoute = false) {
    if (!sessionRef.current.user) return openAuth();
    rememberAccountFocus();
    setAccountEntry((entry) => ({ tab, key: entry.key + 1 }));
    setSidebarOpen(false);
    setLogoutError(null);
    setDialog('account');
    if (!fromRoute) onPageNavigate?.('account');
  }
  async function openPasswordReset() {
    if (saveLock.current || accountActivity.current.ai || accountActivity.current.voice) {
      setLogoutError(t('请先完成保存或结束当前请求，再重置密码。'));
      return;
    }
    if (
      (documentDirty || getDocumentDraftCount(sessionFence.snapshot().actor) > 0) &&
      !(await confirmNavigation(
        t(
          '重置密码会使该手机号对应账号的旧登录失效。未保存文档仅临时保留在本页；请先保存或导出，或在重置后重新登录原账号恢复。关闭页面会丢失未导出的草稿。',
        ),
        {
          title: t('重置密码前保留草稿'),
          confirmLabel: t('继续重置'),
          cancelLabel: t('返回工作区'),
        },
      ))
    )
      return;
    if (saveLock.current || accountActivity.current.ai || accountActivity.current.voice) return;
    openAuth('reset');
  }

  useEffect(() => {
    let live = true;
    const owner = sessionFence.read();
    Promise.allSettled([api<PublicConfig>('/public-config'), api<Session>('/session')]).then(
      (results) => {
        if (!live) return;
        const c = results[0],
          s = results[1];
        if (c.status === 'fulfilled') setConfig(c.value);
        else setCloudError(errorMessage(c.reason));
        if (s.status === 'fulfilled') {
          if (
            owner &&
            isAuthSession(s.value) &&
            sessionFence.acceptRead(owner, s.value.user?.id ?? null)
          )
            showSession(s.value, owner.actor);
          else if (owner && sessionFence.ownsRead(owner))
            setCloudError(t('账号状态暂时无法确认，请重试登录。'));
        } else if (owner && sessionFence.ownsRead(owner)) setCloudError(errorMessage(s.reason));
        setBooting(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const reconcileSessionRef = useRef(reconcileSession);
  reconcileSessionRef.current = reconcileSession;
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  useEffect(() => {
    let lastCheck = 0;
    const check = () => {
      if (
        document.visibilityState !== 'visible' ||
        dialogRef.current === 'auth' ||
        sessionFence.busy
      )
        return;
      if (Date.now() - lastCheck < 10_000) return;
      lastCheck = Date.now();
      void reconcileSessionRef.current();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [sessionFence]);
  useEffect(() => {
    if (!active || !workspaceVisible) return;
    document.title = brand + ' · ' + (project?.title ?? t('创作工作台'));
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
    active,
    workspaceVisible,
    locale,
  ]);
  useEffect(() => {
    if (!session.user || !spaceId) {
      setProjects([]);
      setEntitlements(null);
      return;
    }
    let live = true;
    setCloudError(null);
    setProjects([]);
    setEntitlements(null);
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
      if (
        !activeRef.current ||
        e.defaultPrevented ||
        document.querySelector('dialog[open]') ||
        e.isComposing ||
        e.keyCode === 229
      )
        return;
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
        if (CSS.supports('selector(:popover-open)') && document.querySelector(':popover-open'))
          return;
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
    if (!dirty && !documentDirty && retainedDocumentCount === 0) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, documentDirty, retainedDocumentCount]);

  useEffect(() => {
    if (!project?.id || !refreshToken) return;
    void refreshProject(project.id).catch((e) => setCloudError(errorMessage(e)));
  }, [refreshToken, project?.id]);

  function receiveSession(next: Session, meta: AuthSessionMeta | undefined, intent: number) {
    if (
      intent !== authIntent.current ||
      !sessionFence.isCurrent(authOwner.current) ||
      sessionFence.busy
    ) {
      notify(t('账号状态已变化，请重新核对当前登录。'));
      return;
    }
    replaceSession(next);
    authOwner.current = sessionFence.snapshot();
    authCompleted.current = true;
    entryAuth.current = false;
    if (meta?.method === 'register') registeredActor.current = next.user?.id ?? null;
    postAuthDialog.current = pendingImport
      ? 'importSettings'
      : meta?.method === 'register'
        ? 'accountReady'
        : null;
    setCloudError(null);
    setLogoutError(null);
    if (meta?.method !== 'register') notify(t('已登录，可以把作品保存到云端。'), 'success');
  }
  async function receivePasswordReset(intent: number) {
    if (intent !== authIntent.current || !sessionFence.isCurrent(authOwner.current)) return;
    // Reset targets the submitted phone, which need not own this browser session.
    // Keep all drafts, observe the cookie once, and never infer a logout from {ok:true}.
    authCompleted.current = false;
    postAuthDialog.current = null;
    sessionFence.invalidateReads();
    const owner = sessionFence.read();
    if (!owner) return;
    try {
      const observed = await api<unknown>('/session');
      if (intent !== authIntent.current || !sessionFence.ownsRead(owner)) return;
      if (!isAuthSession(observed)) throw new Error(t('密码已重置，当前登录状态暂时无法确认。'));
      if (!sessionFence.acceptRead(owner, observed.user?.id ?? null)) return;
      // Update the active form owner in the same turn as the accepted session.
      // Switching from the reset result to login must not inherit an obsolete epoch.
      authOwner.current = sessionFence.snapshot();
      authCompleted.current = true;
      showSession(observed, owner.actor);
      setCloudError(null);
      if (owner.actor !== (observed.user?.id ?? null)) setView('editor');
    } catch {
      if (intent !== authIntent.current || !sessionFence.ownsRead(owner)) return;
      setCloudError(
        t('密码已重置，当前登录状态尚未确认。草稿保留在本页，关闭此窗口后会再次核对。'),
      );
    }
  }
  async function logout() {
    if (sessionFence.busy || !sessionRef.current.user) return;
    if (saveLock.current) {
      notify(t('作品正在保存，请稍等片刻。'));
      return;
    }
    if (accountActivity.current.ai || accountActivity.current.voice) {
      setLogoutError(t('请先返回并结束当前 AI 请求或语音通话，再退出登录。退出不会代替任务取消。'));
      return;
    }
    const owner = sessionFence.beginLogout();
    if (!owner) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const detail = [
        t('账号、云端作品和服务点会保留。再次使用时，直接登录即可。'),
        ...(getDocumentDraftCount(owner.actor) > 0
          ? [
              t('本页面保留了 {v0} 份未保存文档草稿，退出后将清除。请先保存或导出。', {
                v0: getDocumentDraftCount(owner.actor),
              }),
            ]
          : documentDirty
            ? [t('文档仍有未保存的修改；退出后这些修改会丢失。')]
            : []),
        ...(editor.file ? [t('当前照片和本地编辑会留在此页面，关闭页面前请导出。')] : []),
        t('已经提交到云端的任务不会因退出而自动取消。'),
      ].join('\n\n');
      if (
        !(await confirmNavigation(detail, {
          title: t('退出当前账号？'),
          confirmLabel: t('退出登录'),
          cancelLabel: t('继续使用'),
        }))
      )
        return;
      if (!sessionFence.ownsLogout(owner)) return;
      if (saveLock.current || accountActivity.current.ai || accountActivity.current.voice) {
        setLogoutError(t('工作区状态已变化，请先完成保存或结束正在进行的请求。'));
        return;
      }
      let confirmed: Session = { user: null, spaces: [] };
      try {
        const receipt = await api<{ ok?: unknown }>('/auth/logout', jsonRequest('POST'));
        if (receipt?.ok !== true) throw new SyntaxError(t('退出结果暂时无法确认。'));
      } catch (failure) {
        if (!sessionFence.ownsLogout(owner)) return;
        // The cookie may already have been cleared: observe once, never repeat the mutation.
        try {
          const observed = await api<unknown>('/session');
          if (!sessionFence.ownsLogout(owner)) return;
          if (!isAuthSession(observed)) throw new Error(t('账号状态响应不完整。'));
          if (observed.user?.id === owner.actor) {
            setLogoutError(t('尚未退出登录。{v0} 可以稍后重试。', { v0: errorMessage(failure) }));
            return;
          }
          confirmed = observed;
        } catch {
          if (!sessionFence.ownsLogout(owner)) return;
          setLogoutError(t('暂时无法确认是否已退出。当前页面保留原状态，请恢复连接后重试。'));
          return;
        }
      }
      if (!sessionFence.finishLogout(owner, confirmed.user?.id ?? null)) return;
      if (owner.actor) clearDocumentDraftsForActor(owner.actor);
      showSession(confirmed, owner.actor);
      setDocumentDirty(false);
      setView('editor');
      setDialog(null);
      onEntryComplete?.();
      restoreAccountFocus();
      notify(
        confirmed.user
          ? t('当前登录已在其他窗口改变，已同步账号状态。')
          : editor.file
            ? t('已退出登录。照片与编辑仍在本机，关闭页面前请导出。')
            : t('已退出登录。账号与云端作品已保留。'),
      );
    } finally {
      if (sessionFence.releaseLogout(owner)) setLoggingOut(false);
    }
  }
  async function selectSpace(space: Space | null) {
    if (documentDirty && !(await confirmNavigation(t('文档还有未保存的修改，确定切换空间吗？'))))
      return;
    if (saveLock.current) {
      notify(t('作品正在保存，请稍等片刻。'));
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
    setCollaborationOpen(false);
  }
  async function loadProject(next: Project) {
    if (documentDirty && !(await confirmNavigation(t('文档还有未保存的修改，确定切换项目吗？'))))
      return;
    if (saveLock.current) {
      notify(t('作品正在保存，请稍等片刻。'));
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
      setCollaborationOpen(false);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      if (req === projectRequest.current) setOpening(false);
    }
  }
  async function refreshProject(id: string) {
    const owner = sessionFence.snapshot();
    const context = projectRequest.current;
    const sequence = ++projectRefresh.current;
    const current = () =>
      sessionFence.isCurrent(owner) &&
      context === projectRequest.current &&
      sequence === projectRefresh.current &&
      projectIdRef.current === id;
    try {
      const result = await api<{ project: Project; assets: Asset[]; artworks: Artwork[] }>(
        `/projects/${id}`,
      );
      if (!current()) return;
      setProject(result.project);
      setAssets(result.assets);
      setArtworks(result.artworks);
    } catch (error) {
      if (current()) throw error;
    }
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
          notify(t('加载期间你继续修改了当前图片，已保留这些编辑。准备好后可重新打开目标图片。'));
        return false;
      },
    };
  }
  async function importFile(
    file?: File,
    initialRecipe?: EditorRecipe,
    entryIsCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    if (!entryIsCurrent()) return false;
    if (saveLock.current) {
      notify(t('作品正在保存，请稍等片刻。'));
      return false;
    }
    if (!file) {
      fileInput.current?.click();
      return false;
    }
    if (
      documentDirty &&
      !(await confirmNavigation(t('文档还有未保存的修改。打开照片会离开文档，确定继续吗？')))
    )
      return false;
    if (
      isEditorDirty() &&
      !(await confirmNavigation(t('当前还有未保存的编辑。打开新图片将替换本地编辑，确认继续吗？')))
    )
      return false;
    if (!entryIsCurrent()) return false;
    // Close the previous source's panel before decoding. A tool explicitly opened
    // while the new image becomes visible must not be closed by the late load completion.
    // Leave a confirmed document now, so no new document edits can be lost while decoding.
    setView('editor');
    setInspectorOpen(false);
    const load = beginSourceLoad();
    try {
      const loaded = await editor.loadFile(
        file,
        initialRecipe,
        () => load.isCurrent() && entryIsCurrent(),
      );
      if (!entryIsCurrent()) return false;
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
      return true;
    } catch (e) {
      if (!entryIsCurrent()) return false;
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
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(t('云端作品包含不可解析的合成素材引用。'));
      if (!isCurrent()) return references;
      const response = await fetch(`/v1/assets/${id}/file`, { credentials: 'include' });
      if (!isCurrent()) return references;
      if (!response.ok) throw new Error(t('无法读取作品引用的合成素材，请确认项目访问权限。'));
      const blob = await response.blob();
      if (!isCurrent()) return references;
      references.set(
        id,
        new File([blob], `${id}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type }),
      );
    }
    return references;
  }
  async function openArtwork(
    next: Artwork | string,
    acceptedDraft?: EditorRecipe,
  ): Promise<boolean> {
    if (saveLock.current) {
      notify(t('作品正在保存，请稍等片刻。'));
      return false;
    }
    if (
      navigationScope.current.documentDirty &&
      !(await confirmNavigation(t('文档还有未保存的修改。打开作品会离开文档，确定继续吗？')))
    )
      return false;
    if (
      isEditorDirty() &&
      editor.getRecipe() !== acceptedDraft &&
      !(await confirmNavigation(
        t('当前还有未保存的编辑。打开云端作品前，请确认已导出或不再需要这些修改。继续打开吗？'),
      ))
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
        throw new Error(t('当前作品来源与版本不一致，请刷新后重试。'));
      const response = await fetch(data.asset.url, { credentials: 'include' });
      if (!response.ok) throw new Error(t('暂时无法读取这张图片，请检查项目访问权限后重试。'));
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
      notify(
        t('已打开「{v0}」版本 {v1}。', { v0: data.artwork.title, v1: data.artwork.headVersion }),
        'success',
      );
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
      documentDirty &&
      !(await confirmNavigation(t('文档还有未保存的修改。打开素材会离开文档，继续吗？')))
    )
      return;
    if (saveLock.current) {
      notify(t('作品正在保存，请稍等片刻。'));
      return;
    }
    if (
      isEditorDirty() &&
      !(await confirmNavigation(t('当前还有未保存的编辑。打开素材原图会替换本地草稿，继续吗？')))
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
      if (!response.ok) throw new Error(t('无法读取素材，请刷新当前项目权限后重试。'));
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
      notify(t('原始素材已打开。保存时会建立独立作品，不会改写已有版本。'), 'success');
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

  async function replaceCurrentSource(
    next: Pick<Asset, 'id' | 'projectId'>,
    expected: Artwork,
    mode: 'reset' | 'carry-color',
  ) {
    if (saveLock.current || opening) throw new Error(t('请等当前图片操作完成。'));
    const basis = editor.getRecipe();
    const source = editor.getSourceIdentity();
    const session = sessionFence.snapshot();
    const current = () =>
      artworkRef.current?.id === expected.id &&
      artworkRef.current.headVersion === expected.headVersion &&
      expected.projectId === next.projectId &&
      editor.getRecipe() === basis &&
      editor.getSourceIdentity() === source &&
      sessionFence.snapshot().epoch === session.epoch;
    if (!current()) throw new Error(t('当前作品或版本已变化，请重新选择底图。'));
    saveLock.current = true;
    let prepared = false;
    try {
      await collaboration.beforeExternalWrite();
      prepared = true;
      if (!current()) throw new Error(t('当前作品或版本已变化，请重新选择底图。'));
      await api(
        `/artworks/${expected.id}/source`,
        jsonRequest('POST', {
          assetId: next.id,
          expectedVersion: expected.headVersion,
          mode,
        }),
      );
      setRefreshToken((value) => value + 1);
    } finally {
      saveLock.current = false;
      if (prepared)
        void collaboration
          .afterExternalWrite()
          .catch((error) => notify(errorMessage(error), 'error'));
    }
    if (current()) await openArtwork(expected.id, basis);
    else notify(t('底图已保存为新版本，当前工作区的改动仍可继续编辑。'));
  }

  async function createCutout(guides: import('./editor/PortraitControls').CutoutGuides) {
    const analysis = editor.portrait.analysis;
    const frame = editor.getSourceFrame();
    if (!frame || !editor.file) throw new Error(t('请先导入图片。'));
    const recipe = editor.getRecipe();
    const regions = recipe.schemaVersion >= 3 && 'regionEdits' in recipe ? recipe.regionEdits : [];
    const guide = (id: string) => {
      if (!id) return undefined;
      const mask = regions.find((region) => region.id === id && region.enabled)?.mask;
      if (!mask) throw new Error(t('抠图选区已变化，请重新选择。'));
      return mask;
    };
    const foreground = guide(guides.foregroundId),
      background = guide(guides.backgroundId);
    const subject =
      analysis?.frame.contentHash === frame.contentHash &&
      analysis.frame.width === frame.width &&
      analysis.frame.height === frame.height
        ? analysis.segmentation?.subject
        : undefined;
    const identity = editor.getSourceIdentity();
    const context = projectRequest.current;
    const alphaPrior =
      subject && (await editor.portrait.prepareCutoutPrior(subject, guides.method));
    if (
      editor.getSourceIdentity() !== identity ||
      editor.isLoading() ||
      projectRequest.current !== context
    )
      throw new Error(t('图片已切换，请重新运行抠图。'));
    if (guides.method === 'fine' && !alphaPrior)
      throw new Error(t('发丝与边缘抠图暂不可用，可以切回标准抠图。'));
    const selection = alphaPrior ?? subject ?? foreground;
    if (!selection) throw new Error(t('请先识别人像或选择前景。'));
    const settings: CutoutSettings = {
      algorithm: alphaPrior ? 'continuous-alpha-v1' : 'guided-v5',
      selection,
      ...(foreground && subject ? { foreground } : {}),
      ...(background ? { background } : {}),
      radius: guides.radius,
      decontaminate: guides.decontaminate,
    };
    const name = `${filenameBase(editor.file.name).slice(0, 106)}-${guides.method === 'fine' ? t('发丝与边缘') : '抠图'}.png`;
    const sourceAsset = cloudBaseSources.current.get(identity);
    if (
      asset &&
      project &&
      sourceAsset?.id === asset.id &&
      project.id === asset.projectId &&
      ['owner', 'admin', 'editor'].includes(project.role) &&
      asset.width === frame.width &&
      asset.height === frame.height
    ) {
      const key = JSON.stringify([
        session.user?.id,
        project.id,
        asset.id,
        identity,
        name,
        settings,
      ]);
      if (cutoutAttempt.current?.key !== key) cutoutAttempt.current = { key, id: secureUuid() };
      await api(
        `/projects/${project.id}/derived-assets`,
        jsonRequest('POST', {
          kind: 'cutout',
          requestId: cutoutAttempt.current.id,
          name,
          sourceAssetId: asset.id,
          settings,
        }),
      );
      setRefreshToken((value) => value + 1);
      return t('透明 PNG 已保存到项目素材。');
    }
    const blob = await editor.exportImage('png', 0.94, false, settings);
    if (editor.getSourceIdentity() !== identity || editor.isLoading())
      throw new Error(t('图片已切换，请重新运行抠图。'));
    downloadBlob(blob, name);
    return t('透明 PNG 已下载。');
  }

  async function copyCloudAsset(sourceAssetId: string, targetProjectId: string): Promise<Asset> {
    if (!session.user) throw new Error(t('请先登录再复制云端素材。'));
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
    const assertCurrent = () => {
      if (savedSource !== rawEditor.getSourceIdentity() || savedContext !== projectRequest.current)
        throw new Error(t('图片或账号范围已变化，未继续上传图层。'));
    };
    assertCurrent();
    if (
      (snapshot.schemaVersion === 3 || snapshot.schemaVersion === 4) &&
      snapshot.imageLayers.length
    ) {
      const mapping = new Map<string, string>(),
        files = rawEditor.getLayerFiles();
      for (const sourceId of new Set(snapshot.imageLayers.map((layer) => layer.sourceId))) {
        assertCurrent();
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
          if (!layerFile) throw new Error(t('缺少合成素材原文件，无法保存完整作品。'));
          const layerFormat = layerFile.type.split('/')[1];
          if (
            layerFormat === 'bmp' ||
            (config?.media && !config.media.serverImport.includes(layerFormat ?? ''))
          )
            layerFile = await normalizeImageSourceFile(layerFile);
          assertCurrent();
          if (layerFile.size > (config?.limits.maxUploadBytes ?? 20 * 1024 * 1024))
            throw new Error(t('合成素材超出服务器上传预算。'));
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
          throw new Error(t('上传期间作品已切换，素材保留于原项目。'));
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
        notify(t('当前调整已同步为云端版本。'), 'success');
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
      notify(t('图片正在准备中，请加载完成后再保存。'));
      return;
    }
    let snapshot = structuredClone(editor.getRecipe());
    const savedFile = editor.file;
    const savedSource = editor.getSourceIdentity();
    const savedContext = projectRequest.current;
    const savedOwner = sessionFence.snapshot();
    const savedIntent = authIntent.current;
    const savedDialog = dialogRef.current;
    const stillCurrent = () =>
      sessionFence.isCurrent(savedOwner) &&
      savedSource === editor.getSourceIdentity() &&
      savedContext === projectRequest.current;
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
              t(
                '原图超过当前服务端像素预算。本地编辑与导出仍可继续，请明确准备较小副本再保存云端。',
              ),
            );
          const uploadFile = await editor.getCloudUploadFile(
            !!config?.media && !config.media.serverImport.includes(editor.sourceFormat),
          );
          if (!stillCurrent()) return;
          if (uploadFile.size > (config?.limits.maxUploadBytes ?? 20 * 1024 * 1024))
            throw new Error(
              t('上传文件超过当前云端 {v0} MiB 上限，本地作品仍然保留。', {
                v0: Math.floor((config?.limits.maxUploadBytes ?? 20 * 1024 * 1024) / 1024 / 1024),
              }),
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
        if (!stillCurrent())
          throw new Error(t('源图片或项目已切换，本次素材保留在原项目，未绑定到当前画面。'));
        uploadedBaseAssets.current.set(`${target.id}:${savedSource}`, currentAsset);
      }
      snapshot = await persistRecipeLayers(snapshot, target, savedSource, savedContext);
      if (!stillCurrent()) return;
      const result =
        artwork && !asNew && artwork.projectId === target.id
          ? await api<{ artwork: Artwork; revision: Revision }>(
              `/artworks/${artwork.id}/revisions`,
              jsonRequest('POST', {
                expectedVersion: artwork.headVersion,
                recipe: snapshot,
                label: t('手动编辑'),
              }),
            )
          : await api<{ artwork: Artwork; revision: Revision }>(
              `/projects/${target.id}/artworks`,
              jsonRequest('POST', {
                assetId: currentAsset.id,
                title: boundedTitle(filenameBase(savedFile.name), asNew ? t(' · 独立分支') : ''),
                recipe: snapshot,
              }),
            );
      if (!stillCurrent()) return;
      setAsset(currentAsset);
      cloudBaseSources.current.set(savedSource, currentAsset);
      setArtwork(result.artwork);
      setRevision(result.revision);
      setSavedRecipe(JSON.stringify(snapshot));
      await refreshProject(target.id);
      if (!stillCurrent()) return;
      setRefreshToken((v) => v + 1);
      if (savedIntent === authIntent.current && savedDialog === dialogRef.current) setDialog(null);
      notify(
        t('版本 {v0} 已保存到「{v1}」。', { v0: result.artwork.headVersion, v1: target.title }),
        'success',
      );
    } catch (e) {
      if (!stillCurrent() || savedIntent !== authIntent.current) return;
      if (
        e instanceof ApiError &&
        e.code === 'VERSION_CONFLICT' &&
        savedDialog === dialogRef.current
      )
        setDialog('conflict');
      else notify(errorMessage(e), 'error');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function serverImport() {
    if (!pendingImport || !project) throw new Error(t('请先选择文件和保存项目。'));
    const incoming = pendingImport;
    const destination = project;
    const guard = createSourceLoadGuard(() => ({
      context: projectRequest.current,
      source: editor.getSourceIdentity(),
      recipe: editor.getRecipe(),
    }));
    if (incoming.size > (config?.media?.maxUploadBytes ?? config?.limits.maxUploadBytes ?? 0))
      throw new Error(
        t('这份文件超过当前服务端上传上限。没有上传，请使用较小副本或调整服务配置。'),
      );
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
        t('规范化素材与新作品已保存到「{v0}」，当前工作区已改变，因此未自动打开。', {
          v0: destination.title,
        }),
        'success',
      );
      return;
    }
    setPendingImport(null);
    setImportReason(null);
    await refreshProject(destination.id);
    if (!guard.isCurrent()) {
      notify(
        t('规范化素材与新作品已保存到「{v0}」。上传期间的新编辑已保留，可从项目中打开该作品。', {
          v0: destination.title,
        }),
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
          ? t(
              '规范化PNG与新作品已保存到项目。原图超过当前工作台的16.8MP / 单边8192px编辑上限，请明确准备较小副本；提高设备预算不会改变此工作台上限。',
            )
          : t(
              '规范化PNG与新作品已保存到项目。当前设备预算不足，可在16.8MP引擎上限内调整预算或使用较小副本。',
            ),
        'success',
      );
    }
  }
  function save() {
    if (editor.isLoading() || opening) {
      notify(t('图片正在准备中，请加载完成后再保存。'));
      return;
    }
    if (!editor.file) {
      notify(t('先打开一张照片，再保存到项目。'));
      return;
    }
    if (!session.user) {
      openAuth();
      return;
    }
    if (!project) {
      saveAfterProject.current = true;
      setDialog('project');
      return;
    }
    void saveToProject(project);
  }
  async function openCreateProject() {
    if (saveLock.current) {
      notify(t('作品正在保存，请稍等片刻。'));
      return;
    }
    if (!session.user) {
      openAuth();
      return;
    }
    if (
      documentDirty &&
      !(await confirmNavigation(t('文档还有未保存的修改。新建项目后会离开当前文档，确定继续吗？')))
    )
      return;
    saveAfterProject.current = false;
    setDialog('project');
  }
  async function createProject(title: string) {
    if (saveLock.current) throw new Error(t('作品正在保存，请稍等片刻。'));
    if (!spaceId) throw new Error(t('请先选择一个创作空间。'));
    const context = ++projectRequest.current;
    editor.cancelPendingLoad();
    setOpening(false);
    const result = await api<{ project: Project }>(
      '/projects',
      jsonRequest('POST', { spaceId, title }),
    );
    if (context !== projectRequest.current) {
      setRefreshToken((value) => value + 1);
      notify(t('项目已创建，可在相应空间查看。'));
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
    } else notify(t('项目已创建，打开照片开始创作。'), 'success');
  }
  async function createTeam(name: string) {
    const owner = sessionFence.snapshot();
    if (!owner.actor || sessionFence.busy) throw new Error(t('请先完成当前账号操作。'));
    const result = await api<{ space: Space }>('/spaces', jsonRequest('POST', { name }));
    if (!sessionFence.isCurrent(owner) || sessionFence.busy)
      throw new Error(t('账号已改变，团队结果可在原账号中查看。'));
    const next = await reconcileSession();
    if (
      !next ||
      !sessionFence.isCurrent(owner) ||
      !next.spaces.some((space) => space.id === result.space.id)
    )
      throw new Error(t('团队已创建，暂时无法确认当前空间。请刷新账号状态后查看。'));
    await selectSpace(result.space);
    if (sessionFence.isCurrent(owner)) notify(t('团队空间已创建。可以邀请队友加入。'), 'success');
  }
  async function joinTeam(code: string) {
    const owner = sessionFence.snapshot();
    if (!owner.actor || sessionFence.busy) throw new Error(t('请先完成当前账号操作。'));
    const result = await api<{ space: Space }>(
      '/invitations/accept',
      jsonRequest('POST', { code }),
    );
    if (!sessionFence.isCurrent(owner) || sessionFence.busy)
      throw new Error(t('账号已改变，请在原账号中核对加入结果。'));
    const next = await reconcileSession();
    if (
      !next ||
      !sessionFence.isCurrent(owner) ||
      !next.spaces.some((space) => space.id === result.space.id)
    )
      throw new Error(t('已提交加入团队，请刷新账号状态后核对结果。'));
    await selectSpace(result.space);
    if (sessionFence.isCurrent(owner)) notify(t('已加入团队空间。'), 'success');
  }
  async function changeView(next: View) {
    if (
      view === 'docs' &&
      next !== view &&
      documentDirty &&
      !(await confirmNavigation(t('文档还有未保存的修改，确定离开文档吗？')))
    )
      return false;
    setView(next);
    setCollaborationOpen(false);
    setInspectorOpen(false);
    setAiOpen(false);
    if (siteRoute === 'usage' && next !== 'usage') onPageNavigate?.('studio', true);
    return true;
  }
  async function openRevision(next: Pick<Revision, 'id' | 'version'>) {
    const current = artworkRef.current;
    if (!current || saveLock.current || opening) return;
    if (isEditorDirty() && !(await confirmNavigation(t('查看历史会替换本地未保存草稿，继续吗？'))))
      return;
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
      if (!response.ok) throw new Error(t('无法读取这个历史版本的底图。'));
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
      notify(
        t('历史版本 {v0} 的底图、合成素材与配方已打开，保存将建立独立作品。', { v0: next.version }),
      );
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
  async function restoreRevision(next: Pick<Revision, 'id' | 'version'>) {
    const current = artworkRef.current;
    if (!current || isEditorDirty() || saveLock.current || opening)
      throw new Error(t('请先保存当前草稿再恢复历史。'));
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
      } else notify(t('历史已在云端恢复成新版本，当前继续编辑的草稿已保留。'));
      setRefreshToken((v) => v + 1);
    } finally {
      collaboration.afterExternalWrite();
      saveLock.current = false;
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!active || booting || !entryRequest || entryHandled.current === entryRequest.key) return;
    if (entryRequest.mode === 'sample') {
      const controller = new AbortController();
      const capturedRequest = entryRequest.key;
      const isCurrent = () =>
        !controller.signal.aborted && activeRef.current && entryKey.current === capturedRequest;
      const sampleImage = getSampleImage(entryRequest.sample);
      void fetch(sampleImage, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(t('示例图片暂时无法加载。'));
          const blob = await response.blob();
          if (!isCurrent()) return;
          const imported = await importFile(
            new File([blob], sampleImage.split('/').pop() ?? 'sample.webp', { type: 'image/webp' }),
            createSampleRecipe(entryRequest.sample),
            isCurrent,
          );
          if (!isCurrent()) return;
          entryHandled.current = capturedRequest;
          if (imported) onEntryComplete?.();
        })
        .catch((error) => {
          if (isCurrent() && (error as Error).name !== 'AbortError')
            notify(errorMessage(error), 'error');
        });
      return () => controller.abort();
    }
    entryHandled.current = entryRequest.key;
    if (entryRequest.mode === 'studio') {
      if (dialogRef.current === 'auth' && !authCompleted.current) void reconcileSession();
      postLoginRoute.current = 'studio';
      entryAuth.current = false;
      if (
        dialogRef.current === 'auth' ||
        dialogRef.current === 'account' ||
        dialogRef.current === 'accountReady'
      ) {
        setDialog(null);
        restoreAccountFocus();
      }
      return;
    }
    if (
      entryRequest.mode === 'account' ||
      entryRequest.mode === 'welcome' ||
      entryRequest.mode === 'usage'
    ) {
      if (!sessionRef.current.user) {
        postLoginRoute.current = entryRequest.mode === 'welcome' ? 'studio' : entryRequest.mode;
        openAuth('password', true);
        onPageNavigate?.('login', true);
      } else if (entryRequest.mode === 'usage') {
        void changeView('usage').then((changed) => {
          if (changed) setDialog(null);
          else onEntryComplete?.();
        });
      } else if (entryRequest.mode === 'welcome') {
        if (registeredActor.current === sessionRef.current.user.id) setDialog('accountReady');
        else onPageNavigate?.('account', true);
      } else if (dialogRef.current !== 'account') openAccount('overview', true);
      return;
    }
    if (dialogRef.current === 'auth' && authEntry.mode === entryRequest.mode) return;
    if (sessionRef.current.user && entryRequest.mode !== 'reset') {
      onEntryComplete?.();
      return;
    }
    entryAuth.current = true;
    openAuth(entryRequest.mode, true);
  }, [active, booting, entryRequest?.key]);
  useEffect(() => {
    if (!active || booting || session.user || (dialog !== 'account' && dialog !== 'accountReady'))
      return;
    // An expired session cannot leave an empty account page behind. Retain the
    // local editor and send this page through the same real authentication owner.
    postLoginRoute.current = dialog === 'account' ? 'account' : 'studio';
    openAuth('password', true);
    onPageNavigate?.('login', true);
  }, [active, booting, session.user?.id, dialog]);
  useEffect(() => {
    onRegisterLeaveGuard?.((next) => {
      if (
        sessionFence.busy ||
        (dialogRef.current === 'auth' && authExitGuard.current?.() === false)
      ) {
        notify(accountPageCopy(locale).waiting);
        return false;
      }
      if (
        next !== 'about' ||
        (!accountActivity.current.ai && !accountActivity.current.voice && !saveLock.current)
      )
        return true;
      notify(t('请先完成保存或结束当前请求，再返回介绍页。'));
      return false;
    });
    return () => onRegisterLeaveGuard?.(null);
  }, [onRegisterLeaveGuard, locale, sessionFence, notify]);

  const requireProject = (
    <EmptyState
      icon={<UsersThree size={36} />}
      title={t('选择项目')}
      description={
        session.user
          ? t('先选择或创建项目，讨论、文档和任务就会围绕同一份作品展开。')
          : t('登录后创建项目，可以邀请团队一起整理作品与意见。')
      }
      action={
        <button className="button button-primary" onClick={openCreateProject}>
          {session.user ? t('创建项目') : t('登录创作空间')}
          <ArrowRight size={17} />
        </button>
      }
    />
  );

  const activePanelId =
    workspaceLayout.focused || view !== 'editor'
      ? null
      : aiOpen
        ? 'ai'
        : collaborationOpen
          ? 'collaboration'
          : inspectorOpen
            ? 'inspector'
            : null;
  const activePanel = activePanelId
    ? workspaceLayout.panel(activePanelId === 'collaboration' ? 'inspector' : activePanelId)
    : null;
  const mobileAssistantPage =
    workspaceLayout.view.bucket === 'phone' ||
    (workspaceLayout.view.width < 1000 &&
      workspaceLayout.view.height <= 500 &&
      navigator.maxTouchPoints > 0);
  const mobileAssistantOpen = mobileAssistantPage && activePanelId === 'ai';
  const inspectorPresence = usePresence(activePanelId === 'inspector', 'panel-frame');
  const aiPresence = usePresence(activePanelId === 'ai', 'panel-frame');
  const collaborationPresence = usePresence(
    activePanelId === 'collaboration' || view === 'collaborate',
    'panel-frame',
  );
  const keepAIActive = aiActivity.callActive || aiActivity.requestActive;
  const lastDialog = useRef<Dialog>(null);
  const modalDialog = accountPageOpen ? null : dialog;
  if (modalDialog) lastDialog.current = modalDialog;
  const dialogPresence = usePresence(
    !!modalDialog,
    modalMotionRoleForDialog(modalDialog ?? lastDialog.current),
  );
  const renderedDialog = accountPageOpen
    ? dialog
    : (modalDialog ?? (dialogPresence.present ? lastDialog.current : null));
  const canvasInsets = workspaceCanvasInsets(
    mobileAssistantOpen ? null : activePanel,
    workspaceLayout.view,
    workspaceLayout.focused,
  );
  const selectInspectorTool = (tool: ToolGroup) => {
    setToolOverview(false);
    if (tool === group) return;
    setPreviousTools((items) => [...items, group].slice(-16));
    setGroup(tool);
  };
  const backToTool = () => {
    const previous = previousTools.at(-1);
    editor.commitCurrent(t('完成当前调节'));
    if (previous) {
      setPreviousTools((items) => items.slice(0, -1));
      setGroup(previous);
    } else setToolOverview(true);
    setSampling(false);
  };
  const openInspector = (tool: ToolGroup) => {
    workspaceLayout.setFocused(false);
    setCollaborationOpen(false);
    selectInspectorTool(tool);
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
    if (group === tool && inspectorOpen && !aiOpen && !toolOverview) {
      setInspectorOpen(false);
      setSampling(false);
    } else openInspector(tool);
  };
  const resetWorkspace = () => {
    workspaceLayout.reset();
    setCollaborationOpen(false);
    setInspectorOpen(false);
    setAiOpen(false);
    setSidebarOpen(false);
    notify(t('已恢复当前屏幕的默认布局。'));
  };
  const showAI = () => {
    if (!aiOpen) restoreInspectorAfterAI.current = inspectorOpen;
    editor.commitCurrent(t('完成当前调节'));
    workspaceLayout.setFocused(false);
    setCollaborationOpen(false);
    setAiOpen(true);
    setInspectorOpen(false);
    setSampling(false);
    if (workspaceLayout.panel('ai').presentation === 'collapsed')
      workspaceLayout.updatePanel('ai', { ...workspaceLayout.panel('ai'), presentation: 'normal' });
  };
  const openAI = async () => {
    if (view !== 'editor' && !(await changeView('editor'))) return;
    showAI();
  };
  const closeAI = () => {
    setAiOpen(false);
    if (!mobileAssistantPage) return;
    if (restoreInspectorAfterAI.current) setInspectorOpen(true);
    requestAnimationFrame(() =>
      workspaceSurface.current
        ?.querySelector<HTMLButtonElement>('[data-dock-tool=ai]')
        ?.focus({ preventScroll: true }),
    );
  };
  const openAIFromEditor = async () => {
    if (capturingWorkspace.current) return;
    const workspace = workspaceSurface.current;
    const recipe = editor.getRecipe();
    if (
      !mobileAssistantPage ||
      !workspace ||
      !editor.file ||
      referenceFile ||
      keepAIActive ||
      visualAttachment?.kind === 'sketch' ||
      (visualAttachment && visualDraft?.recipe === recipe)
    ) {
      showAI();
      return;
    }
    if (
      !editor.rendered ||
      editor.isLoading() ||
      editor.rendering ||
      JSON.stringify(recipe) !== JSON.stringify(editor.renderedRecipe)
    ) {
      notify(t('最新编辑还没有完成渲染，请稍后再共享。'));
      return;
    }
    capturingWorkspace.current = true;
    try {
      const attachment = await captureWorkspaceVisual(workspace, editor.rendered);
      if (
        !workspace.isConnected ||
        !activeRef.current ||
        navigationScope.current.view !== 'editor' ||
        visualScopeRef.current !== visualScope ||
        editor.getSourceIdentity() !== sourceIdentity
      )
        return;
      if (editor.getRecipe() !== recipe) {
        notify(t('共享期间画面已变化，请重新获取上下文。'));
        return;
      }
      setVisualDraft({ scope: visualScope, recipe, attachment });
      showAI();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      capturingWorkspace.current = false;
    }
  };
  const openCollaborationPanel = () => {
    editor.commitCurrent(t('完成当前调节'));
    workspaceLayout.setFocused(false);
    setCollaborationOpen(true);
    setInspectorOpen(false);
    setAiOpen(false);
    setSampling(false);
    if (workspaceLayout.panel('inspector').presentation === 'collapsed')
      workspaceLayout.updatePanel('inspector', {
        ...workspaceLayout.panel('inspector'),
        presentation: 'normal',
      });
  };
  const returnToAdjustments = async () => {
    if (view !== 'editor' && !(await changeView('editor'))) return;
    openInspector(
      group === 'history'
        ? (previousTools
            .slice()
            .reverse()
            .find((tool) => tool !== 'history') ?? 'light')
        : group,
    );
  };
  const panelNavigation = (
    <PanelNavigation
      focusRequest={panelNavigationFocus}
      selected={
        activePanelId === 'ai'
          ? 'assistant'
          : activePanelId === 'collaboration'
            ? 'collaboration'
            : group === 'history'
              ? 'history'
              : 'adjustments'
      }
      items={[
        {
          id: 'adjustments',
          label: t('调整'),
          icon: <SlidersHorizontal size={15} />,
          onSelect: returnToAdjustments,
        },
        {
          id: 'assistant',
          label: t('AI 助手'),
          icon: <StudioGlyph name="ai" size={17} />,
          onSelect: () => void openAI(),
        },
        {
          id: 'collaboration',
          label: t('协作'),
          icon: <UsersThree size={15} />,
          onSelect: openCollaborationPanel,
        },
        {
          id: 'history',
          label: t('记录'),
          icon: <ClockCounterClockwise size={15} />,
          onSelect: () => openInspector('history'),
        },
      ]}
    />
  );
  const retryCloudRead = () => {
    setCloudNoticeDismissed(false);
    setCloudError(null);
    refreshConfig();
    if (dialogRef.current !== 'auth') void reconcileSession();
    setRefreshToken((value) => value + 1);
  };
  const commands: StudioCommand[] = [
    ...toolGroups.map((tool) => ({
      id: 'tool-' + tool.id,
      label: t(tool.label),
      description: t(tool.description),
      keywords: tool.id,
      section: t('精修工具'),
      icon: tool.icon,
      run: async () => {
        if (!(await changeView('editor'))) return;
        openInspector(tool.id);
      },
    })),
    {
      id: 'ai',
      label: t('AI 助手'),
      description: t('图片、文字、语音与创作助手'),
      keywords: 'ai agent chat',
      section: t('创作空间'),
      icon: <Sparkle size={20} />,
      run: () => {
        void openAI();
      },
    },
    ...views
      .filter((item) => item.id !== 'editor')
      .map((item) => ({
        id: 'view-' + item.id,
        label: item.id === 'compare' ? t('对比与云端版本') : t(item.label),
        description: t('打开{name}工作视图', { name: t(item.label) }),
        keywords: item.id,
        section: t('创作空间'),
        icon: item.icon,
        run: () => {
          changeView(item.id);
        },
      })),
    {
      id: 'import',
      label: t('打开照片'),
      description: t('从设备选择图片，在本地开始编辑'),
      keywords: 'open import',
      section: t('常用操作'),
      icon: <Plus size={20} />,
      run: () => {
        void importFile();
      },
    },
    {
      id: 'draw',
      label: t('画一张草图'),
      description: t('自由画板，也可作为 AI 生图参考'),
      keywords: 'draw sketch',
      section: t('常用操作'),
      icon: <PencilSimple size={20} />,
      run: () => setDialog('drawing'),
    },
    {
      id: 'export',
      label: t('导出图片'),
      description: editor.file ? t('选择格式与质量，下载编辑结果') : t('先打开一张图片'),
      keywords: 'download export png jpeg webp',
      section: t('常用操作'),
      icon: <DownloadSimple size={20} />,
      disabled: !editor.file || opening || editor.loading,
      disabledReason: !editor.file ? t('请先打开照片') : t('照片仍在载入，请稍候'),
      run: () => setDialog('export'),
    },
    {
      id: 'save',
      label: t('保存版本'),
      description: editor.file ? t('保存到当前创作空间') : t('先打开一张图片'),
      keywords: 'save cloud',
      section: t('常用操作'),
      icon: <CloudArrowUp size={20} />,
      disabled: !editor.file || saving || opening || editor.loading,
      disabledReason: !editor.file
        ? t('请先打开照片')
        : saving
          ? t('当前版本正在保存')
          : t('照片仍在载入，请稍候'),
      run: () => {
        void save();
      },
    },
    {
      id: 'focus',
      label: t('专注画面'),
      description: t('暂时收起工具，按 F 返回'),
      keywords: 'focus',
      section: t('常用操作'),
      icon: <CornersOut size={20} />,
      run: () => workspaceLayout.setFocused(true),
    },
    {
      id: 'account',
      label: session.user ? t('账号与使用') : t('登录或注册'),
      description: session.user ? t('账号安全、服务点与退出') : t('保存项目、同步作品与团队协作'),
      keywords: 'account login register billing credits logout 付费 注销 退出',
      section: t('常用操作'),
      icon: <ShieldCheck size={20} />,
      run: () => openAccount(),
    },
    {
      id: 'help',
      label: t('使用说明'),
      description: t('编辑、协作与格式的实际能力'),
      keywords: 'help',
      section: t('常用操作'),
      icon: <Info size={20} />,
      run: () => setDialog('help'),
    },
  ];
  return (
    <>
      <div className="site-workspace-frame" hidden={!workspaceVisible} inert={!workspaceVisible}>
        {ops && session.user?.isOperator ? (
          <Suspense
            fallback={
              <div className="content-view">
                <button type="button" className="text-button" onClick={() => setOps(false)}>
                  {t('返回创作')}
                </button>
                <FeatureSkeleton profile="operations" label={t('正在打开运营管理')} />
              </div>
            }
          >
            <OpsDashboard
              key={session.user.id}
              onBack={() => setOps(false)}
              onConfigChanged={refreshConfig}
            />
          </Suspense>
        ) : (
          <div
            className={`app-shell canvas-workspace studio-workspace view-${view} theme-${studioTheme.theme} ${workspaceLayout.focused ? 'is-focused' : ''}`}
            data-has-image={!!editor.file}
            data-mobile-ai-page={mobileAssistantOpen || undefined}
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
              onAuth={() => openAuth()}
              onAccount={() => openAccount()}
              onLogout={() => openAccount('data')}
              onOps={async () => {
                if (
                  aiActivity.callActive ||
                  aiActivity.requestActive ||
                  teamVoice.state !== 'idle'
                ) {
                  notify(t('请先结束当前 AI 请求或语音通话，再打开运营管理。'));
                  return;
                }
                if (
                  documentDirty &&
                  !(await confirmNavigation(t('文档还有未保存的修改，确定进入运营管理吗？')))
                )
                  return;
                setOps(true);
              }}
            />
            <div className="workspace" ref={workspaceSurface}>
              <header className="floating-topbar" data-motion="topbar">
                <div className="workspace-identity">
                  <IconButton label={t('打开空间与项目')} onClick={() => setSidebarOpen(true)}>
                    <List size={21} />
                  </IconButton>
                  <button
                    type="button"
                    className="workspace-home-link"
                    aria-label={introduction.homeLabel}
                    onClick={async () => {
                      if (!onAbout) return;
                      if (
                        accountActivity.current.ai ||
                        accountActivity.current.voice ||
                        saveLock.current
                      ) {
                        notify(t('请先完成保存或结束当前请求，再返回介绍页。'));
                        return;
                      }
                      if (documentDirty) {
                        if (
                          !(await confirmNavigation(
                            t('文档仍在本页保留。返回介绍页后，请勿关闭页面。'),
                            {
                              title: t('返回介绍页'),
                              confirmLabel: t('返回介绍页'),
                              cancelLabel: t('继续编辑'),
                            },
                          ))
                        )
                          return;
                      }
                      onAbout();
                    }}
                  >
                    <Brand name={brand} logoUrl={brandLogoUrl(config?.brand)} compact />
                  </button>
                  {(artwork || project || editor.file) && (
                    <div className="workspace-project-title">
                      <strong title={artwork?.title ?? project?.title ?? editor.file?.name}>
                        {artwork?.title ?? project?.title ?? editor.file?.name}
                      </strong>
                      {view === 'editor' && editor.file && (
                        <span
                          className="workspace-save-state"
                          data-state={saving ? 'saving' : artwork && !dirty ? 'saved' : 'draft'}
                          role="status"
                        >
                          {saving
                            ? t('正在保存')
                            : artwork && !dirty
                              ? t('版本 {v0} 已保存', { v0: artwork.headVersion })
                              : t('本地草稿')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <WorkspaceViewTabs
                  value={view}
                  onChange={changeView}
                  menuOpen={dialog === 'navigation'}
                  onOpenMenu={() => setDialog('navigation')}
                />
                <div className="workspace-top-actions">
                  {cloudError && cloudNoticeDismissed && (
                    <IconButton
                      label={interactionText('showCloud')}
                      className="cloud-status-trigger"
                      onClick={() => setCloudNoticeDismissed(false)}
                    >
                      <Info size={18} />
                    </IconButton>
                  )}
                  <IconButton
                    label={t('搜索工具与操作（Ctrl / ⌘ K）')}
                    className="studio-search-trigger"
                    onClick={() => setDialog('commands')}
                  >
                    <MagnifyingGlass size={19} />
                  </IconButton>
                  <IconButton
                    label={studioTheme.theme === 'light' ? t('切换深色模式') : t('切换浅色模式')}
                    className="theme-toggle"
                    onClick={studioTheme.toggle}
                  >
                    <StudioGlyph name={studioTheme.theme === 'light' ? 'moon' : 'sun'} />
                  </IconButton>
                  <IconButton
                    label={t('专注画面（F）')}
                    className="focus-toggle"
                    onClick={() => workspaceLayout.setFocused(true)}
                  >
                    <CornersOut size={20} />
                  </IconButton>
                  <IconButton
                    label={t('布局与工作台设置')}
                    className="workspace-settings-trigger"
                    aria-haspopup="dialog"
                    onClick={() => setDialog('settings')}
                  >
                    <StudioGlyph name="settings" />
                  </IconButton>
                  <button
                    className="button button-secondary top-save"
                    aria-label={t('保存')}
                    disabled={!editor.file || saving || opening || editor.loading}
                    onClick={save}
                  >
                    {saving ? <Busy label="" /> : <CloudArrowUp size={20} />}
                    <span>{t('保存')}</span>
                  </button>
                  <button
                    className="button button-primary top-export"
                    aria-label={t('导出')}
                    disabled={!editor.file || opening || editor.loading}
                    onClick={() => setDialog('export')}
                  >
                    <StudioGlyph name="export" size={20} />
                    <span>{t('导出')}</span>
                  </button>
                  <button
                    type="button"
                    className={`studio-account ${session.user ? 'is-signed-in' : ''}`}
                    aria-label={
                      session.user
                        ? t('账户：{v0}', { v0: session.user.displayName })
                        : t('登录创作空间')
                    }
                    onClick={() => openAccount()}
                  >
                    {session.user ? session.user.displayName.slice(0, 1) : t('登录')}
                  </button>
                </div>
              </header>
              {cloudError && !cloudNoticeDismissed && (
                <div className="cloud-status" role="status">
                  <Info size={16} aria-hidden />
                  <span>{t('云端暂不可用，本地编辑可以继续。')}</span>
                  <button type="button" onClick={retryCloudRead}>
                    {t('重试')}
                  </button>
                  <IconButton
                    className="cloud-status-dismiss"
                    label={interactionText('dismissCloud')}
                    onClick={() => setCloudNoticeDismissed(true)}
                  >
                    <X size={16} />
                  </IconButton>
                </div>
              )}
              {view !== 'editor' && teamVoice.state !== 'idle' && (
                <TeamVoiceBanner room={teamVoice} onReturn={() => changeView('editor')} />
              )}
              {keepAIActive && activePanelId !== 'ai' && (
                <div className="ai-activity-banner" role="status">
                  <StudioGlyph name={aiActivity.callActive ? 'voice' : 'ai'} size={18} />
                  <span>
                    {aiActivity.callState === 'connecting'
                      ? t('AI 语音正在连接')
                      : aiActivity.callState === 'closing'
                        ? t('AI 通话正在结束')
                        : aiActivity.callState === 'active'
                          ? aiActivity.muted
                            ? t('AI 麦克风已静音')
                            : t('AI 通话进行中')
                          : t('AI 正在处理请求')}
                  </span>
                  {aiActivity.callActive && (
                    <div className="ai-activity-controls">
                      <IconButton
                        label={aiActivity.muted ? t('开启麦克风') : t('静音麦克风')}
                        aria-pressed={aiActivity.muted}
                        disabled={aiActivity.callState !== 'active' || !aiActivity.onMute}
                        onClick={aiActivity.onMute}
                      >
                        {aiActivity.muted ? (
                          <MicrophoneSlash size={18} />
                        ) : (
                          <Microphone size={18} />
                        )}
                      </IconButton>
                      <IconButton
                        label={t('结束实时通话')}
                        className="voice-end"
                        disabled={aiActivity.callState === 'closing' || !aiActivity.onEnd}
                        onClick={aiActivity.onEnd}
                      >
                        <PhoneDisconnect size={18} />
                      </IconButton>
                    </div>
                  )}
                  <button type="button" className="ai-activity-return" onClick={openAI}>
                    {t('返回 AI 助手')}
                  </button>
                </div>
              )}
              <div
                className="workspace-canvas-status"
                ref={setCanvasStatusContainer}
                hidden={view !== 'editor' || mobileAssistantOpen}
                inert={view !== 'editor' || mobileAssistantOpen}
              />
              <div className="workspace-notice-anchor" ref={setNoticeContainer} />
              <div className="workspace-body">
                <MotionSwitch
                  switchKey={view}
                  className="workspace-view-transition"
                  data-motion-pixels="true"
                  inert={mobileAssistantOpen}
                >
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
                            <IconButton
                              label={t('打开另一张图片')}
                              onClick={() => void importFile()}
                            >
                              <Plus size={20} />
                            </IconButton>
                            <IconButton
                              label={t('打开草图板')}
                              data-action="open-sketch"
                              onClick={() => setDialog('drawing')}
                            >
                              <PencilSimple size={19} />
                            </IconButton>
                          </div>
                        )}
                        {(collaboration.enabled || teamVoiceArtwork) && (
                          <CollaborationStatus
                            collaboration={collaboration}
                            onReload={() => void openArtwork(artwork!.id)}
                            onFork={() => project && void saveToProject(project, true)}
                            teamVoice={teamVoiceArtwork ? teamVoice : undefined}
                            captureVoiceContext={captureCurrentImage}
                          />
                        )}
                        <CanvasStage
                          editor={editor}
                          statusContainer={canvasStatusContainer}
                          collaboration={collaboration}
                          group={group}
                          onImport={(file) => void importFile(file)}
                          onAI={openAI}
                          onDraw={() => setDialog('drawing')}
                          accountState={booting ? 'loading' : session.user ? 'signed-in' : 'guest'}
                          onSignIn={() => openAuth()}
                          onRegister={() => openAuth('register')}
                          comparing={comparing}
                          setComparing={setComparing}
                          sampling={sampling}
                          onSample={(color) => {
                            setPickedColor(color);
                            setSampling(false);
                            selectInspectorTool('color');
                            setInspectorOpen(true);
                            notify(t('已取色 {v0}', { v0: color }));
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
                            if (aiOpen) closeAI();
                            else void openAIFromEditor();
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
                            aria-label={t('素材视图')}
                            data-motion="context-navigation"
                          >
                            <RubberSegment
                              label={t('素材视图')}
                              value={libraryTab}
                              onChange={setLibraryTab}
                              options={[
                                { value: 'project', label: t('项目作品'), icon: <Images size={17} /> },
                                { value: 'all', label: t('跨空间查找'), icon: <MagnifyingGlass size={17} /> },
                                { value: 'memory', label: t('长期素材'), icon: <BookmarkSimple size={17} /> },
                              ]}
                            />
                            <button
                              type="button"
                              className="library-original-action"
                              aria-label={t('原片与专业格式')}
                              onClick={() => {
                                if (!session.user) openAuth();
                                else if (!project) openCreateProject();
                                else setDialog('mediaImport');
                              }}
                            >
                              <FileImage size={18} />
                              <span>{t('原片与专业格式')}</span>
                            </button>
                          </nav>
                          {libraryTab === 'project' ? (
                            <AssetLibrary
                              onLoadBack={() => {
                                void changeView('editor');
                              }}
                              project={project}
                              artworks={artworks}
                              space={currentSpace}
                              projects={projects}
                              refreshToken={refreshToken}
                              onSelectProject={(item) => void loadProject(item)}
                              onOpenAsset={(item) => void openLibraryAsset(item)}
                              replacementTarget={
                                artwork &&
                                project?.id === artwork.projectId &&
                                ['owner', 'admin', 'editor'].includes(project.role)
                                  ? artwork
                                  : null
                              }
                              replacementHasDraft={dirty}
                              onReplaceSource={replaceCurrentSource}
                              onOpen={(item) => void openArtwork(item)}
                              onImport={() => void importFile()}
                              onCreate={openCreateProject}
                              onCopy={() => setDialog('copy')}
                              onShare={() => setDialog('share')}
                            />
                          ) : !session.user ? (
                            <EmptyState
                              icon={<StudioGlyph name="works" size={30} />}
                              title={t('登录后查找素材')}
                              description={t('浏览你有权限访问的项目、图片与长期素材。')}
                              action={
                                <button
                                  className="button button-primary"
                                  onClick={() => openAuth()}
                                >
                                  {t('登录')}
                                </button>
                              }
                            />
                          ) : (
                            <ResourceSearch
                              onLoadBack={() => {
                                void changeView('editor');
                              }}
                              key={`${session.user.id}:${libraryTab}`}
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
                          onLoadBack={() => {
                            void changeView('editor');
                          }}
                          editor={editor}
                          artwork={artwork}
                          onOpenRevision={openRevision}
                          isDirty={dirty}
                          onRestoreRevision={restoreRevision}
                          currentUserId={session.user?.id}
                          onForkCreated={async (created) => {
                            setRefreshToken((value) => value + 1);
                            return openArtwork(created.artworkId);
                          }}
                          canRestore={
                            !!project && ['owner', 'admin', 'editor'].includes(project.role)
                          }
                        />
                      )}{' '}
                      {view === 'collaborate' && !project && requireProject}
                      {view === 'docs' &&
                        (project ? (
                          <DocumentsView
                            onLoadBack={() => {
                              void changeView('editor');
                            }}
                            key={`${session.user?.id ?? 'guest'}:${project.id}`}
                            actorId={session.user?.id ?? null}
                            project={project}
                            refreshToken={refreshToken}
                            onDirtyChange={setDocumentDirty}
                          />
                        ) : (
                          requireProject
                        ))}{' '}
                      {view === 'deliver' && (
                        <DeliveryView
                          onLoadBack={() => {
                            void changeView('editor');
                          }}
                          editor={editor}
                          artwork={artwork}
                          sourcePending={opening || editor.loading}
                          onExport={() => setDialog('export')}
                          onRecipeImport={() => recipeInput.current?.click()}
                        />
                      )}
                      {view === 'usage' && (
                        <div className="content-view">
                          {session.user ? (
                            <UsageDashboard
                              onLoadBack={() => {
                                void changeView('editor');
                              }}
                              key={`${session.user.id}:${currentSpace?.id ?? 'personal'}`}
                              space={currentSpace}
                              spaces={session.spaces}
                              currentUserId={session.user.id}
                              refreshToken={refreshToken}
                            />
                          ) : (
                            <EmptyState
                              icon={<StudioGlyph name="usage" size={30} />}
                              title={t('登录后查看用量')}
                              description={t('查看服务点余额，以及任务、模型和成员的使用明细。')}
                              action={
                                <button
                                  className="button button-primary"
                                  onClick={() => openAuth()}
                                >
                                  {t('登录')}
                                </button>
                              }
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </MotionSwitch>
                {(['inspector', 'ai'] as const)
                  .filter((id) =>
                    id === 'ai'
                      ? aiPresence.present || keepAIActive || aiVisited
                      : inspectorPresence.present || inspectorVisited,
                  )
                  .map((shownPanelId) => (
                    <FloatingPanel
                      key={shownPanelId}
                      panelKey={shownPanelId}
                      displayMode={shownPanelId === 'ai' && mobileAssistantPage ? 'page' : 'panel'}
                      open={activePanelId === shownPanelId}
                      motionState={(shownPanelId === 'ai' ? aiPresence : inspectorPresence).phase}
                      title={
                        shownPanelId === 'ai'
                          ? t('AI 助手')
                          : toolOverview
                            ? interactionText('toolOverview')
                            : t(toolGroups.find((tool) => tool.id === group)?.label ?? '调整')
                      }
                      label={shownPanelId === 'ai' ? t('AI可移动面板') : t('可移动编辑面板')}
                      geometry={workspaceLayout.panel(shownPanelId)}
                      viewport={workspaceLayout.view}
                      onGeometry={(next, change) =>
                        workspaceLayout.updatePanel(shownPanelId, next, change)
                      }
                      onUndoGeometry={
                        workspaceLayout.canUndoPanel(shownPanelId)
                          ? () => workspaceLayout.undoPanel(shownPanelId)
                          : undefined
                      }
                      onBack={
                        shownPanelId === 'ai'
                          ? returnToAdjustments
                          : toolOverview
                            ? undefined
                            : backToTool
                      }
                      backLabel={
                        shownPanelId === 'ai'
                          ? interactionText('backToEditing')
                          : previousTools.length
                            ? t('返回上一步工具')
                            : interactionText('backToTools')
                      }
                      onClose={() => {
                        setInspectorOpen(false);
                        setAiOpen(false);
                        setSampling(false);
                      }}
                      navigation={panelNavigation}
                      compactAdjustment={
                        shownPanelId === 'inspector' &&
                        !!editor.file &&
                        !toolOverview &&
                        (ADJUSTMENT_GROUPS.includes(group) ||
                          (group === 'crop' && editor.recipe.schemaVersion >= 3))
                      }
                    >
                      {shownPanelId === 'inspector' ? (
                        <>
                          {toolOverview && (
                            <ToolOverview
                              current={group}
                              onSelect={(tool) => {
                                setPreviousTools([]);
                                setGroup(tool);
                                setToolOverview(false);
                              }}
                            />
                          )}
                          <div
                            className="inspector-retained"
                            hidden={toolOverview}
                            inert={toolOverview}
                          >
                            <ToolInspector
                              editor={editor}
                              group={group}
                              onGroupChange={selectInspectorTool}
                              onCutout={createCutout}
                              mobileOpen
                              onClose={() => setInspectorOpen(false)}
                              pickedColor={pickedColor}
                              onColorChange={setPickedColor}
                              sampling={sampling}
                              onSample={() => {
                                setSampling(!sampling);
                                if (workspaceLayout.view.bucket === 'phone')
                                  setInspectorOpen(false);
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <AIPanelFeature
                          key={(session.user?.id ?? 'local') + ':' + (project?.id ?? 'none')}
                          visible={activePanelId === 'ai'}
                          mobilePage={mobileAssistantPage}
                          visualAttachment={visualAttachment}
                          onClearVisualAttachment={(attachment) =>
                            setVisualDraft((draft) => (draft?.attachment === attachment ? null : draft))
                          }
                          onActivityChange={setAiActivity}
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
                          previewActive={editor.hasUncommittedPreview}
                          onConfirmPreview={() => editor.commitCurrent(t('确认 AI 调整'))}
                          onCancelPreview={editor.cancelPreview}
                          captureCurrentImage={captureCurrentImage}
                          onUseCanvasSource={
                            project && ['owner', 'admin', 'editor'].includes(project.role)
                              ? (item) => {
                                  const current = artworkRef.current;
                                  if (
                                    !current ||
                                    item.projectId !== current.projectId ||
                                    current.assetId === item.id
                                  )
                                    return;
                                  const description = isEditorDirty()
                                    ? t(
                                        '将 {v0} 保存为当前作品的新底图。继续会离开未保存的编辑。',
                                        { v0: item.title || item.name },
                                      )
                                    : t('将 {v0} 保存为当前作品的新底图。', {
                                        v0: item.title || item.name,
                                      });
                                  void confirmNavigation(description, {
                                    title: t('替换当前底图'),
                                    confirmLabel: t('替换底图'),
                                  })
                                    .then((approved) =>
                                      approved
                                        ? replaceCurrentSource(
                                            { id: item.id, projectId: current.projectId },
                                            current,
                                            'reset',
                                          )
                                        : undefined,
                                    )
                                    .catch((error) => notify(errorMessage(error), 'error'));
                                }
                              : undefined
                          }
                          captureReferenceCanvas={
                            editor.file
                              ? async () => {
                                  const identity = editor.getSourceIdentity(),
                                    recipe = editor.getRecipe();
                                  const blob = await editor.exportImage('png');
                                  if (
                                    identity !== editor.getSourceIdentity() ||
                                    recipe !== editor.getRecipe()
                                  )
                                    throw new Error(t('参考图生成期间画面已变化，请重新选择。'));
                                  return new File([blob], 'canvas-reference.png', {
                                    type: 'image/png',
                                  });
                                }
                              : undefined
                          }
                          onBeforeArtworkWrite={collaboration.beforeExternalWrite}
                          onAfterArtworkWrite={collaboration.afterExternalWrite}
                          isDirty={dirty}
                          onDecisionApplied={async (id, action) => {
                            setRefreshToken((value) => value + 1);
                            if (
                              navigationScope.current.view !== 'editor' ||
                              navigationScope.current.documentDirty ||
                              isEditorDirty() ||
                              artworkRef.current?.id !== id
                            ) {
                              notify(
                                t('云端已采用AI结果，当前本地草稿继续保留，可稍后从作品中打开。'),
                              );
                              return;
                            }
                            if (await openArtwork(id)) {
                              if (
                                mobileAssistantPage &&
                                aiOpenRef.current &&
                                (action === 'replace' || action === 'layer')
                              )
                                closeAI();
                              if (action === 'replace')
                                notify(t('已替换底图，可在「对比」中恢复上一版本。'));
                            }
                          }}
                          config={config}
                          initialOperation={initialAIOperation}
                          referenceFile={referenceFile}
                          onClearReference={() => setReferenceFile(null)}
                          onDraw={() => setDialog('drawing')}
                          onCreateProject={openCreateProject}
                          onOpenArtwork={(id) => {
                            void openArtwork(id).then((opened) => {
                              if (opened) closeAI();
                            });
                          }}
                          onTaskChanged={() => setRefreshToken((value) => value + 1)}
                          onClose={closeAI}
                          onPreview={(next) => {
                            editor.preview(next);
                            if (mobileAssistantPage && aiOpenRef.current) closeAI();
                            notify(
                              navigationScope.current.view === 'editor'
                                ? t('建议已进入预览，可以继续调整、取消或保存。')
                                : t('AI 建议已在编辑器中准备好，当前页面和未保存内容已保留。'),
                            );
                          }}
                          onSave={save}
                          isLoggedIn={!!session.user}
                          onAuth={() => openAuth()}
                        />
                      )}
                    </FloatingPanel>
                  ))}
                {(collaborationVisited || collaborationOpen || view === 'collaborate') && (
                  <FloatingPanel
                    panelKey="inspector"
                    identity="collaboration"
                    displayMode={view === 'collaborate' ? 'page' : 'panel'}
                    open={view === 'collaborate' || activePanelId === 'collaboration'}
                    motionState={collaborationPresence.phase}
                    title={t('协作')}
                    label={interactionText('collaborationPanel')}
                    geometry={workspaceLayout.panel('inspector')}
                    viewport={workspaceLayout.view}
                    onGeometry={(next, change) =>
                      workspaceLayout.updatePanel('inspector', next, change)
                    }
                    onBack={returnToAdjustments}
                    backLabel={interactionText('backToEditing')}
                    onClose={() => setCollaborationOpen(false)}
                    navigation={panelNavigation}
                  >
                    <div
                      className="collaboration-retained"
                      data-mode={view === 'collaborate' ? 'page' : 'panel'}
                    >
                      {project ? (
                        <CollaborateView
                          key={`${session.user?.id ?? 'guest'}:${project.id}`}
                          embedded={view !== 'collaborate'}
                          onExpand={() => void changeView('collaborate')}
                          onReturnToEditor={() => void returnToAdjustments()}
                          onLoadBack={returnToAdjustments}
                          currentUserId={session.user?.id}
                          project={project}
                          artwork={artwork}
                          revision={revision}
                          refreshToken={refreshToken}
                          onShare={() => setDialog('share')}
                        />
                      ) : (
                        requireProject
                      )}
                    </div>
                  </FloatingPanel>
                )}
                {workspaceLayout.focused && (
                  <div className="focus-exit">
                    <button onClick={() => workspaceLayout.setFocused(false)}>
                      <CornersOut size={18} />
                      {t('退出专注')}
                      <kbd>F</kbd>
                    </button>
                  </div>
                )}
                {opening && (
                  <div className="workspace-busy">
                    <FeatureSkeleton profile="gallery" label={t('正在打开项目与作品…')} compact />
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
          aria-label={t('选择照片')}
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
          aria-label={t('选择配方文件')}
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file)
              editor
                .importRecipe(file)
                .then(() => notify(t('配方已应用到本地编辑。'), 'success'))
                .catch((error) => notify(errorMessage(error), 'error'));
          }}
        />
      </div>
      {accountPagePending && !accountPageOpen && (
        <AccountPageFrame
          title={
            siteRoute === 'register'
              ? t('注册账号')
              : siteRoute === 'reset'
                ? t('重置密码')
                : siteRoute === 'account'
                  ? t('账号与使用')
                  : t('登录工作空间')
          }
          config={config}
          onBack={() => onEntryCancel?.()}
          onHome={onAbout}
          wide={siteRoute === 'account'}
        >
          <div className="account-page-loading" role="status" aria-live="polite">
            <i aria-hidden />
            <i aria-hidden />
            <i aria-hidden />
            <p>{accountCopy.loading}</p>
          </div>
        </AccountPageFrame>
      )}
      <DialogMotionContext.Provider value={{ open: !!dialog, phase: dialogPresence.phase }}>
        {renderedDialog === 'navigation' && (
          <WorkspaceNavigation
            view={view}
            onClose={closeDialog}
            onView={async (next) => {
              if (await changeView(next)) closeDialog();
            }}
          />
        )}
        {renderedDialog === 'settings' && (
          <WorkspaceSettings
            preference={studioTheme.preference}
            onPreference={studioTheme.setPreference}
            onClose={closeDialog}
            onImportSettings={() => setDialog('importSettings')}
            onReset={() => {
              resetWorkspace();
              closeDialog();
            }}
            onFocus={() => {
              workspaceLayout.setFocused(true);
              closeDialog();
            }}
            onHelp={() => setDialog('help')}
            available={session.user && entitlements ? entitlements.available : undefined}
            onUsage={async () => {
              if (await changeView('usage')) closeDialog();
            }}
          />
        )}
        {renderedDialog === 'commands' && <CommandMenu commands={commands} onClose={closeDialog} />}
        {renderedDialog === 'drawing' && (
          <Suspense
            fallback={
              <Modal title={t('准备草图板')} onClose={closeDialog}>
                <FeatureSkeleton profile="drawing" label={t('准备草图板')} compact />
              </Modal>
            }
          >
            <DrawingBoard
              initialColor={pickedColor}
              projectImages={project ? assets.filter((item) => item.projectId === project.id) : []}
              readProjectImage={
                project
                  ? async (id) => {
                      const selected = assets.find(
                        (item) => item.id === id && item.projectId === project.id,
                      );
                      const scope = projectRequest.current;
                      if (!selected) throw new Error(t('无法打开草图素材'));
                      const response = await fetch(
                        `/v1/assets/${encodeURIComponent(selected.id)}/file`,
                        { credentials: 'include' },
                      );
                      if (!response.ok || scope !== projectRequest.current) {
                        await response.body?.cancel();
                        throw new Error(t('无法打开草图素材'));
                      }
                      if (Number(response.headers.get('content-length')) > 64 * 1024 * 1024) {
                        await response.body?.cancel();
                        throw new Error(t('合成素材单文件上限为 64MiB。'));
                      }
                      const bytes = await response.blob();
                      if (scope !== projectRequest.current) throw new Error(t('无法打开草图素材'));
                      return new File([bytes], selected.name, { type: bytes.type });
                    }
                  : undefined
              }
              readCurrentImage={
                editor.file
                  ? async () => {
                      const identity = editor.getSourceIdentity();
                      const blob = await editor.exportImage('png');
                      if (identity !== editor.getSourceIdentity() || editor.isLoading())
                        throw new Error(t('图片已切换，请重新添加。'));
                      return new File([blob], t('当前画布') + '.png', { type: 'image/png' });
                    }
                  : undefined
              }
              onClose={closeDialog}
              onUse={(file) => importFile(file)}
              onReference={async (file) => {
                if (!(await changeView('editor'))) return false;
                if (mobileAssistantPage && !aiOpen && !keepAIActive) {
                  const attachment = await captureSketchVisual(file);
                  if (visualScopeRef.current !== visualScope) return false;
                  setReferenceFile(null);
                  setVisualDraft({ scope: visualScope, recipe: editor.getRecipe(), attachment });
                  showAI();
                  return true;
                }
                setReferenceFile(file);
                setReferenceSource('sketch');
                setInitialAIOperation('generate-image');
                setVisualDraft(null);
                showAI();
                notify(t('草图已作为本地参考。确认提交生图时才会上传。'));
                return true;
              }}
            />
          </Suspense>
        )}
        {renderedDialog === 'importSettings' && (
          <ImportSettings
            budget={editor.pixelBudget}
            recipeVersion={editor.recipe.schemaVersion}
            onBudget={editor.setPixelBudget}
            file={pendingImport}
            reason={importReason}
            config={config}
            project={project}
            loggedIn={!!session.user}
            onAuth={() => openAuth()}
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
            key={authEntry.key}
            config={config}
            cooldowns={authCooldowns}
            initialMode={authEntry.mode}
            onHome={onAbout}
            onRegisterExitGuard={registerAuthExitGuard}
            backToAbout={accountBackToAbout}
            onModeChange={(mode) => {
              setAuthEntry((current) => ({ ...current, mode }));
              onPageNavigate?.(mode === 'register' || mode === 'reset' ? mode : 'login');
            }}
            onSession={(next, meta) => receiveSession(next, meta, authEntry.key)}
            onReset={() => {
              void receivePasswordReset(authEntry.key);
            }}
            onClose={() => closeAuth(authEntry.key)}
          />
        )}
        {renderedDialog === 'accountReady' && session.user && (
          <AccountReady
            session={session}
            config={config}
            onHome={onAbout}
            hasImage={!!editor.file}
            onContinue={() => {
              void changeView('editor').then((changed) => {
                if (changed) closeDialog();
              });
            }}
            onImport={() => {
              closeDialog();
              void importFile();
            }}
            onProject={() => {
              onEntryComplete?.();
              void openCreateProject();
            }}
          />
        )}
        {renderedDialog === 'account' && session.user && (
          <Suspense
            fallback={
              <AccountPageFrame
                title={t('账号与使用')}
                config={config}
                onBack={closeDialog}
                onHome={onAbout}
                wide
              >
                <FeatureSkeleton profile="account" label={t('正在读取账号信息')} compact />
              </AccountPageFrame>
            }
          >
            <AccountCenter
              key={`${session.user.id}:${accountEntry.key}`}
              session={session}
              config={config}
              spaceId={spaceId}
              initialTab={accountEntry.tab}
              hasImage={!!editor.file}
              hasUnsavedChanges={
                dirty || documentDirty || getDocumentDraftCount(session.user.id) > 0
              }
              activity={accountActivity.current}
              loggingOut={loggingOut}
              logoutError={logoutError}
              onClose={closeDialog}
              onHome={onAbout}
              onResetPassword={() => void openPasswordReset()}
              onUsage={() => {
                void changeView('usage').then((changed) => {
                  if (changed) {
                    setDialog(null);
                    onPageNavigate?.('usage');
                  }
                });
              }}
              onExport={() => {
                onEntryComplete?.();
                setDialog('export');
              }}
              onLogout={logout}
              onReturnToActivity={() => {
                void changeView('editor').then((changed) => {
                  if (!changed) return;
                  closeDialog();
                  if (accountActivity.current.ai) showAI();
                });
              }}
              onStartProject={() => {
                onEntryComplete?.();
                void openCreateProject();
              }}
              onImport={() => {
                closeDialog();
                void importFile();
              }}
              onSessionExpired={() => {
                void reconcileSession();
              }}
            />
          </Suspense>
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
              void reconcileSession().then((current) => {
                if (current?.user) setRefreshToken((n) => n + 1);
              });
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
              notify(t('独立副本已创建。'), 'success');
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
            title={t('云端已经有了更新')}
            profile="danger"
            subtitle={t('你的本地编辑仍然保留，没有覆盖队友的新版本。')}
            onClose={closeDialog}
          >
            <p className="dialog-copy">
              {t('可以先保留当前编辑，也可以把这份修改保存为独立作品，再到项目中比较两份结果。')}
            </p>
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={closeDialog}>
                {t('保留本地编辑')}
              </button>
              <button
                className="button button-primary"
                disabled={saving}
                onClick={() => {
                  if (project) void saveToProject(project, true);
                }}
              >
                {saving ? <Busy /> : t('另存为独立分支')}
              </button>
            </div>
          </Modal>
        )}
        {renderedDialog === 'quota' && entitlements && (
          <Modal
            title={t('你的服务点')}
            profile="billing"
            subtitle={currentSpace?.name ?? t('当前空间')}
            onClose={closeDialog}
          >
            <div className="quota-balance">
              <Sparkle size={30} />
              <strong>{entitlements.available}</strong>
              <span>{t('可用服务点')}</span>
            </div>
            <div className="quota-detail">
              <div>
                <span>{t('免费权益可用')}</span>
                <strong>{entitlements.freeAvailable}</strong>
              </div>
              <div>
                <span>{t('购买权益可用')}</span>
                <strong>{entitlements.purchasedAvailable}</strong>
              </div>
              <div>
                <span>{t('任务占用')}</span>
                <strong>{entitlements.held}</strong>
              </div>
            </div>
            <p className="form-hint">
              {t(
                '点数用于已开放的云端能力，本地手动编辑不消耗服务点。团队额度与个人额度分别计算。',
              )}
            </p>
            <button
              className="button button-secondary"
              onClick={async () => {
                if (await changeView('usage')) closeDialog();
              }}
            >
              <ChartBar size={17} />
              {t('查看用量历史与趋势')}
            </button>
          </Modal>
        )}
        {renderedDialog === 'help' && (
          <Modal title={t('工作台帮助')} profile="detail" onClose={closeDialog}>
            <div className="help-list">
              <section>
                <SlidersHorizontal size={24} />
                <div>
                  <h3>{t('编辑照片')}</h3>
                  <p>
                    {t(
                      '先在照片下方选择调节、人像、局部或构图，再展开需要的工具。支持多区域、曲线、四角透视、绘制、修复和图层合成；照片先在本机处理。',
                    )}
                  </p>
                </div>
              </section>
              <section>
                <CloudArrowUp size={24} />
                <div>
                  <h3>{t('保存与版本')}</h3>
                  <p>
                    {t(
                      '登录后把作品保存到项目。进入已保存的作品后，每次确认调整会同步为新版本；冲突时保留本地草稿，可以另存分支。',
                    )}
                  </p>
                </div>
              </section>
              <section>
                <UsersThree size={24} />
                <div>
                  <h3>{t('团队协作')}</h3>
                  <p>
                    {t(
                      '创建团队、邀请成员，在同一张作品上查看队员游标和编辑范围。相同区域会先取得编辑权；也可以在项目里讨论、写文档和跟进任务。',
                    )}
                  </p>
                </div>
              </section>
              <section>
                <ShieldCheck size={24} />
                <div>
                  <h3>{t('图片与 AI 授权')}</h3>
                  <p>
                    {t(
                      '打开本地照片不会自动上传。AI 默认使用你提交的文字和参数；主动开启共享画面后会发送当前图片预览，选择参考图或开始语音也会发送对应内容。模型、服务点与能力在执行前显示。',
                    )}
                  </p>
                </div>
              </section>
            </div>
            <p className="fine-print">
              {t(
                '本地格式以头部检查与浏览器解码为准，PNG / JPEG / WebP / BMP / 静态 GIF / AVIF 可按实际支持导入；TIFF 可明确上传规范化。当前本机预算',
              )}{' '}
              {(editor.pixelBudget / 1e6).toFixed(1)}{' '}
              {t(
                '百万像素，可在设置中修改；云端另有服务限制。细节滤镜请在导出的原尺寸图片上复核。',
              )}
            </p>
          </Modal>
        )}
      </DialogMotionContext.Provider>
      {confirmation.dialog}
      <Toast
        notice={notice}
        dismiss={dismissNotice}
        container={workspaceVisible ? noticeContainer : null}
      />
    </>
  );
}
