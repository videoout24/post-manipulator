import { EventBus } from "./core/EventBus.js?v=1.5.9";
import { Storage } from "./storage/Storage.js?v=1.7.0";
import { LayoutPreferences } from "./core/LayoutPreferences.js?v=1.5.9";
import { TelegramSettingsView } from "./telegram/TelegramSettingsView.js?v=1.7.0";
import { GalleryView } from "./gallery/GalleryView.js?v=1.6.5";
import { ProjectPreviewSync } from "./project/ProjectPreviewSync.js?v=1.5.9";
import { ProjectPublicationService } from "./project/ProjectPublicationService.js?v=1.5.9";
import { EditorDocumentCoordinator } from "./editor/EditorDocumentCoordinator.js?v=1.5.9";
import { EditorCanvasPreferences } from "./editor/EditorCanvasPreferences.js?v=1.5.9";
import { AppNotifications } from "./app/AppNotifications.js?v=1.5.9";
import { AppLifecycle } from "./app/AppLifecycle.js?v=1.5.9";
import { createTelegramDomain } from "./app/createTelegramDomain.js?v=1.7.1";
import { createProjectDomain } from "./app/createProjectDomain.js?v=1.5.9";
import { createGalleryDomain } from "./app/createGalleryDomain.js?v=1.5.9";
import { createEditorDomain } from "./app/createEditorDomain.js?v=1.7.0";
import { createEditorWorkspace } from "./app/createEditorWorkspace.js?v=1.5.9";
import { createEditorShell } from "./app/createEditorShell.js?v=1.6.5";
import { NetPanel } from "./app/NetPanel.js?v=1.5.9";
import { PublicationView } from "./publications/PublicationView.js?v=1.5.9";
import { TelegramBackupService } from "./storage/TelegramBackupService.js?v=1.7.1";
import { LinkingController } from "./links/LinkingController.js?v=1.5.9";
import { LinkRelationNavigator } from "./links/LinkRelationNavigator.js?v=1.5.9";
import { confirmDarkDialog } from "./core/DarkDialog.js?v=1.6.5";

/**
 * Builds the application only after js/bootstrap.js has admitted a verified
 * Telegram Mini App session. This module has no top-level runtime bootstrap.
 */
export async function startApplication({ appDb, token, verifiedBot = null, telegramContext = null } = {}) {
if (!appDb?.info || appDb.info.engine !== "indexeddb") throw new Error("Security bootstrap must open IndexedDB before application startup");
if (!String(token || "").trim()) throw new Error("Security bootstrap did not provide a verified token");
const events = new EventBus();
const persistentStorage = await Storage.create({ db: appDb });
const initialMetaBlocks = await appDb.get("settings", "editor.metaBlocks", []);
const layoutPreferences = new LayoutPreferences({ db: appDb, events });
const editorCanvasPreferences = new EditorCanvasPreferences({ db: appDb, events });
await editorCanvasPreferences.initialize();
const notifications = new AppNotifications({
  root: document.querySelector("#toast"),
  events,
  inlineWhen: () => document.querySelector('.top-tab[data-tab="editor"]')?.classList.contains("active") === true
}).start();
const editor = createEditorDomain({ db: appDb, events, storage: persistentStorage, initialMetaBlocks });
const {
  formatting,
  properties,
  registry,
  metaRegistry,
  storage,
  tree,
  validator,
  selection,
  controller,
  draftStore,
  draftSession,
  formulaTemplates,
  renderer: telegramRenderer,
  dragState,
  richTextContext
} = editor;

// Useful for extensions/debugging: one canonical catalog for every property/format.
window.richMessageRegistries = { properties, formatting, blocks: registry, meta: metaRegistry };

const project = createProjectDomain({ db: appDb, events, tree, storage, richMessageValidator: validator });
const {
  store: projectStore,
  index: projectIndex,
  session: projectSession,
  graphReconciler: projectGraphReconciler,
  compiler: projectCompiler,
  validator: projectValidator,
  buildPreviewTree: buildEditorPreviewTree
} = project;
controller.setMutationGuard?.(request => projectSession.structureMutationError?.(request));
controller.setDocumentContextResolver?.(() => projectSession.isProjectActive() || draftSession.isActive());
projectGraphReconciler.start();
const editorDocuments = new EditorDocumentCoordinator({
  projectSession,
  draftSession,
  drafts: draftStore,
  projects: projectStore,
  graphReconciler: projectGraphReconciler,
  tree,
  storage
});
const telegram = createTelegramDomain({
  db: appDb,
  events,
  renderer: telegramRenderer,
  validator,
  tree,
  treeProvider: buildEditorPreviewTree,
  drafts: draftStore,
  draftSession,
  documents: editorDocuments,
  initialToken: token,
  verifiedBot
});
const {
  client: telegramClient,
  botIdentity,
  navigation: telegramNavigation,
  ownerBinding,
  previewChannelBinding,
  publicationTargets,
  publications: publicationService,
  linkRelations,
  runtime: telegramRuntime,
  previewController,
  projectPreviewTransport,
  core: telegramCore
} = telegram;
const telegramBackups = new TelegramBackupService({ db: appDb, client: telegramClient, ownerBinding });
const backupRestoreDialog = document.querySelector("#telegramBackupRestoreDialog");
const backupRestoreTitle = document.querySelector("#telegramBackupRestoreTitle");
const backupRestoreHint = document.querySelector("#telegramBackupRestoreHint");
const backupRestoreFile = document.querySelector("#telegramBackupRestoreFile");
const backupState = document.querySelector("#telegramBackupState");
let discoveredPinnedBackup = null;
// initData was verified by the security gate before the application started,
// so it is the authoritative source for the local workspace owner.
const verifiedOwner = await ownerBinding.bindVerifiedMiniAppUser(telegramContext?.telegramUserId);
void checkPinnedBackup({ owner: verifiedOwner, automatic: true }).catch(error => {
  if (backupState) backupState.textContent = `Проверка закреплённой копии не удалась: ${error?.message || error}`;
  console.warn("Pinned backup discovery failed", error);
});
const projectPreviewSync = new ProjectPreviewSync({
  store: projectStore,
  compiler: projectCompiler,
  validator: projectValidator,
  transport: projectPreviewTransport,
  events,
  editorSession: projectSession
});
const projectPublicationService = new ProjectPublicationService({
  db: appDb,
  store: projectStore,
  compiler: projectCompiler,
  validator: projectValidator,
  client: telegramClient,
  renderer: telegramRenderer,
  targets: publicationTargets,
  events,
  editorSession: projectSession
});
await projectPublicationService.initialize();
projectSession.setBeforeOpenProject(async ({ reason }) => {
  if (reason !== "project-opened") return;
  await projectPreviewSync.clearAllDeployments();
});
let activeTelegramRequests = 0;
const showNetPanelNotice = payload => {
  const editorActive = document.querySelector('.top-tab[data-tab="editor"]')?.classList.contains("active") === true;
  notifications.show(editorActive ? { ...(payload || {}), silent: true } : payload);
};
const netPanel = new NetPanel({
  root: document.querySelector("#appNetPanel"),
  onPollingChange: enabled => {
    const operation = enabled ? telegramRuntime.start() : telegramRuntime.stop();
    operation.catch(error => showNetPanelNotice({ message: `Telegram runtime: ${error?.message || error}`, type: "error" }));
  },
  onOfflineClick: () => showNetPanelNotice({ message: "Нет подключения к сети", type: "warning" })
});
let browserOnline = navigator.onLine !== false;
let telegramConnectionAvailable = true;
const syncNetworkAvailability = () => netPanel.setAvailable(browserOnline && telegramConnectionAvailable);
window.addEventListener("online", () => {
  browserOnline = true;
  if (!netPanel.isPollingEnabled()) telegramConnectionAvailable = true;
  syncNetworkAvailability();
});
window.addEventListener("offline", () => {
  browserOnline = false;
  syncNetworkAvailability();
});
syncNetworkAvailability();
events.on("telegram:request-start", () => netPanel.setRequestActive(++activeTelegramRequests > 0));
events.on("telegram:request-end", () => netPanel.setRequestActive(--activeTelegramRequests > 0));
events.on("telegram:request-success", () => {
  telegramConnectionAvailable = true;
  syncNetworkAvailability();
});
events.on("telegram:request-network-error", () => {
  telegramConnectionAvailable = false;
  syncNetworkAvailability();
});
events.on("telegram:runtime-status", status => {
  const state = status?.state;
  if (["starting", "running", "retrying"].includes(state)) netPanel.setPollingEnabled(true);
  else if (state === "stopped") netPanel.setPollingEnabled(false);
  if (state === "running" || state === "stopped") telegramConnectionAvailable = true;
  else if (state === "retrying" || state === "error") telegramConnectionAvailable = false;
  syncNetworkAvailability();
});
const gallery = createGalleryDomain({
  db: appDb,
  events,
  telegramCore,
  client: telegramClient,
  projects: projectStore,
  drafts: draftStore,
  tree,
  projectSession,
  draftSession
});
const { store: galleryStore, thumbnails: thumbnailCache, core: galleryCore } = gallery;
const editorWorkspaceComposition = createEditorWorkspace({
  documentRoot: document,
  events,
  tree,
  registry,
  metaRegistry,
  controller,
  validator,
  formulaTemplates,
  richTextContext,
  projectSession,
  draftSession,
  dragState,
  gallery: galleryCore,
  thumbnails: thumbnailCache,
  notifications,
  editorCanvasPreferences
});
const {
  inlineProperties,
  palette,
  workspace: editorWorkspace,
  openAssetPickerButton
} = editorWorkspaceComposition;

const galleryRoot = document.querySelector("#galleryApp");
const galleryView = galleryRoot ? new GalleryView({
  root: galleryRoot,
  gallery: galleryCore,
  thumbnails: thumbnailCache,
  events,
  layoutPreferences
}) : null;

const telegramSettingsRoot = document.querySelector("#telegramSettings");
const telegramSettings = telegramSettingsRoot ? new TelegramSettingsView({
  root: telegramSettingsRoot,
  db: appDb,
  events,
  client: telegramClient,
  runtime: telegramRuntime,
  ownerBinding,
  previewChannelBinding,
  previewController,
  botIdentity,
  navigation: telegramNavigation,
  verifiedBot
}) : null;
telegramSettings?.setNetworkPanel(netPanel);

const publicationView = new PublicationView({
  root: document.querySelector("#publicationsApp"),
  telegramCore,
  runtime: telegramRuntime,
  navigation: telegramNavigation,
  events,
  notifications,
  layoutPreferences,
  draftSession,
  projectStore,
  documents: editorDocuments,
  projectPublications: projectPublicationService
});

const editorShell = createEditorShell({
  documentRoot: document,
  events,
  notifications,
  editor,
  project,
  telegram,
  gallery,
  workspace: editorWorkspaceComposition,
  documents: editorDocuments,
  projectPreviewSync,
  onPublishDraft: draft => publicationView.requestDraftPublication(draft),
  onApplyDraftChanges: draftId => telegramCore.publications.applyDraftChanges(draftId),
  onPublishProject: project => publicationView.requestProjectPublication(project),
  onPublishProjectPost: (project, post) => publicationView.requestProjectPostPublication(project, post),
  onScheduleProjectPost: (project, post) => publicationView.requestProjectPostSchedule(project, post),
  onCancelProjectPostSchedule: (projectId, postId) => projectPublicationService.cancelPostSchedule(projectId, postId),
  onApplyProjectChanges: (projectId, postId) => projectPublicationService.applyChanges(projectId, postId)
});
const {
  previewStatus: editorPreviewStatus,
  navigation,
  telegramControls: editorTelegramControls,
  projectLibrary,
  stoppables: editorShellStoppables
} = editorShell;
const linkingController = new LinkingController({
  events,
  tree,
  controller,
  linkRelations,
  draftSession,
  projectSession
}).start();
const linkRelationNavigator = new LinkRelationNavigator({
  events,
  linkRelations,
  documents: editorDocuments,
  publications: telegramCore.publications,
  navigation,
  controller
}).start();

const createTelegramBackupButton = document.querySelector("#createTelegramBackup");
createTelegramBackupButton?.addEventListener("click", async () => {
  if (createTelegramBackupButton.disabled) return;
  createTelegramBackupButton.disabled = true;
  try {
    const result = await telegramBackups.createAndPin();
    if (backupState) backupState.textContent = `Текущая копия создана ${formatBackupDate(result.createdAt)}.`;
    notifications.show({ message: `Резервная копия отправлена и закреплена (${formatBackupSize(result.backup.bytes.byteLength)}).`, type: "success" });
  } catch (error) {
    notifications.show({ message: `Резервная копия: ${error?.message || error}`, type: "error", duration: 7000 });
  } finally {
    createTelegramBackupButton.disabled = false;
  }
});
document.querySelector("#telegramBackupCheckPinned")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  try {
    const inspection = await checkPinnedBackup({ automatic: false });
    if (!inspection.backup) {
      notifications.show({ message: "Самая новая закреплённая запись не является резервной копией Post Manipulator.", type: "warning" });
    }
  } catch (error) {
    notifications.show({ message: `Проверка копии: ${error?.message || error}`, type: "error", duration: 7000 });
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#telegramBackupRestoreManual")?.addEventListener("click", () => {
  showBackupRestoreDialog({ manual: true });
});
document.querySelector("#telegramBackupRestoreOpen")?.addEventListener("click", () => {
  const username = telegramClient.hasToken() ? (telegramSettings?.bot?.username || verifiedBot?.username) : "";
  if (username) telegramNavigation.openBot(username);
});
document.querySelector("#telegramBackupRestoreSkip")?.addEventListener("click", () => backupRestoreDialog?.close());
document.querySelector("#telegramBackupRestoreApply")?.addEventListener("click", async () => {
  const button = document.querySelector("#telegramBackupRestoreApply");
  const file = backupRestoreFile?.files?.[0];
  if (!file) {
    notifications.show({ message: "Сначала выберите скачанный файл резервной копии.", type: "warning" });
    return;
  }
  if (!await confirmDarkDialog({
    title: "Заменить локальную базу?",
    message: "Все текущие проекты, черновики, настройки и локальные привязки будут заменены данными из выбранной резервной копии.",
    confirmLabel: "Восстановить",
    danger: true
  })) return;
  button.disabled = true;
  try {
    const sourceBackup = discoveredPinnedBackup &&
      String(file.name || "") === String(discoveredPinnedBackup.document?.file_name || "")
      ? discoveredPinnedBackup
      : null;
    await telegramBackups.restoreDownloadedFile(file, { sourceBackup });
    backupRestoreDialog?.close();
    window.location.reload();
  } catch (error) {
    notifications.show({ message: `Восстановление: ${error?.message || error}`, type: "error", duration: 7000 });
  } finally {
    button.disabled = false;
  }
});

async function checkPinnedBackup({ owner = null, automatic = false } = {}) {
  if (backupState) backupState.textContent = "Проверяем самую новую закреплённую копию…";
  const inspection = await telegramBackups.inspectPinnedBackup(owner);
  discoveredPinnedBackup = inspection.backup || null;
  renderBackupInspection(inspection);
  if (inspection.shouldOfferRestore || (!automatic && inspection.backup)) {
    showBackupRestoreDialog({ inspection });
  }
  return inspection;
}

function renderBackupInspection(inspection) {
  if (!backupState) return;
  const date = inspection.backup?.createdAt ? formatBackupDate(inspection.backup.createdAt) : "с неизвестной датой";
  const messages = {
    missing: "Самая новая закреплённая запись не является резервной копией Post Manipulator.",
    current: `Закреплённая копия от ${date} уже соответствует этой локальной базе.`,
    newer: `Закреплённая копия от ${date} новее локальной базы.`,
    "not-newer": `Локальная база не старее закреплённой копии от ${date}.`,
    "unknown-date": "Дата закреплённой копии недоступна; её можно восстановить вручную."
  };
  backupState.textContent = messages[inspection.status] || "Состояние резервной копии неизвестно.";
}

function showBackupRestoreDialog({ inspection = null, manual = false } = {}) {
  if (inspection?.backup) discoveredPinnedBackup = inspection.backup;
  if (manual && !discoveredPinnedBackup) {
    if (backupRestoreTitle) backupRestoreTitle.textContent = "Ручное восстановление";
    if (backupRestoreHint) backupRestoreHint.textContent = "Выберите ранее скачанную резервную копию Post Manipulator.";
  } else if (discoveredPinnedBackup) {
    const date = discoveredPinnedBackup.createdAt ? formatBackupDate(discoveredPinnedBackup.createdAt) : "неизвестно";
    if (backupRestoreTitle) backupRestoreTitle.textContent = inspection?.shouldOfferRestore ? "Найдена более свежая копия" : "Восстановление из закрепа";
    if (backupRestoreHint) backupRestoreHint.textContent = `Самая новая закреплённая копия: ${discoveredPinnedBackup.document.file_name || "backup.json"}; дата отправки — ${date}.`;
  }
  if (backupRestoreFile) backupRestoreFile.value = "";
  if (backupRestoreDialog && !backupRestoreDialog.open) backupRestoreDialog.showModal();
}

editorWorkspace.render();
navigation.activateTab(navigation.activeTab);
const lifecycle = new AppLifecycle({
  build: "1.7.1",
  notifications,
  layoutPreferences,
  telegramNavigation,
  projectSession,
  editorDocuments,
  editorTelegramControls,
  projectLibrary,
  galleryCore,
  telegramSettings,
  publicationView,
  galleryView,
  appDb,
  ownerBinding,
  previewChannelBinding,
  publicationTargets,
  telegramRuntime,
  telegramClient,
  telegramCore,
  editorPreviewStatus,
  stoppables: [notifications, publicationView, linkingController, linkRelationNavigator, publicationService, projectPublicationService, ...editorShellStoppables, projectGraphReconciler]
});
let started = false;
const handle = Object.freeze({
  telegramContext: telegramContext ? Object.freeze({ ...telegramContext }) : null,
  async start() {
    if (!started) {
      await lifecycle.start();
      await telegramRuntime.start().catch(error => notifications.show({
        message: `Telegram runtime: ${error?.message || error}`,
        type: "warning",
        duration: 7000
      }));
      started = true;
    }
    return handle;
  },
  stop() {
    lifecycle.stop();
    telegramClient.clearToken?.();
    started = false;
  }
});
return handle;

function formatBackupSize(bytes) {
  return `${(Number(bytes || 0) / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatBackupDate(value) {
  const date = new Date(Number(value || 0));
  return Number.isNaN(date.getTime()) ? "неизвестно" : date.toLocaleString("ru-RU");
}
}
