import { AppNavigation } from "./AppNavigation.js?v=1.5.9";
import { EditorPreviewStatusView } from "../editor/EditorPreviewStatusView.js?v=1.5.9";
import { EditorEventCoordinator } from "../editor/EditorEventCoordinator.js?v=1.5.9";
import { EditorTelegramControls } from "../editor/EditorTelegramControls.js?v=1.5.9";
import { EditorRightPanel } from "../editor/EditorRightPanel.js?v=1.7.13";
import { EditorSessionHistory } from "../editor/EditorSessionHistory.js?v=1.5.9";
import { ProjectLibraryView } from "../project/ProjectLibraryView.js?v=1.7.12";
import { EditorCommandController } from "../editor/EditorCommandController.js?v=1.5.9";
import { EditorToolController } from "../editor/EditorToolController.js?v=1.6.5";
import { showDarkMessage } from "../core/DarkDialog.js?v=1.6.5";

export function createEditorShell({
  documentRoot = document,
  events,
  notifications,
  editor,
  project,
  telegram,
  gallery,
  workspace: workspaceComposition,
  documents,
  projectPreviewSync,
  onPublishDraft = null,
  onScheduleDraft = null,
  onApplyDraftChanges = null,
  onPublishProject = null,
  onPublishProjectPost = null,
  onScheduleProjectPost = null,
  onCancelProjectPostSchedule = null,
  onApplyProjectChanges = null,
  promptFn = null,
  alertFn = message => { void showDarkMessage({ message }); }
} = {}) {
  const {
    tree,
    controller,
    selection,
    validator,
    renderer,
    draftStore,
    draftSession,
    metaRegistry,
    registry
  } = editor || {};
  const {
    store: projectStore,
    index: projectIndex,
    session: projectSession,
    graphReconciler,
    buildPreviewTree
  } = project || {};
  const { core: telegramCore, navigation: telegramNavigation } = telegram || {};
  const { core: galleryCore, thumbnails } = gallery || {};
  const {
    inlineProperties,
    palette,
    workspace,
    openAssetPickerButton
  } = workspaceComposition || {};
  const query = selector => documentRoot.querySelector(selector);
  const showToast = (payload, fallbackType = "info") => {
    const data = typeof payload === "string" ? { message: payload, type: fallbackType } : (payload || {});
    return notifications?.show?.({ ...data, silent: true }, fallbackType);
  };
  const editorNotifications = { show: showToast };

  const previewStatus = new EditorPreviewStatusView({
    root: query("#editorPreviewState"),
    events,
    projectSession,
    notifications: editorNotifications
  }).start();

  let projectLibrary = null;
  const navigation = new AppNavigation({
    root: documentRoot,
    onEditor: () => workspace?.render?.(),
    onProject: () => projectLibrary?.render?.()
  }).start();

  const eventCoordinator = new EditorEventCoordinator({
    events,
    projectSession,
    draftSession,
    telegramPreview: telegramCore?.editor?.preview,
    workspace,
    selection,
    textareaSizing: inlineProperties?.textareaSizing,
    projectIndex,
    previewStatus
  }).start();

  const history = new EditorSessionHistory({
    tree,
    events,
    selection,
    projectSession,
    draftSession,
    undoButton: query("#editorUndo"),
    redoButton: query("#editorRedo"),
    documentRoot
  }).start();

  const telegramControls = new EditorTelegramControls({
    manualButton: query("#editorOpenTelegram"),
    statusElement: query("#editorProjectSyncStatus"),
    deploymentButton: query("#editorProjectDeployment"),
    events,
    session: projectSession,
    previewSync: projectPreviewSync,
    livePreview: telegramCore?.editor?.preview,
    graphReconciler,
    navigation: telegramNavigation,
    onError: error => showToast({
      message: `Telegram/Project: ${error?.message || error}`,
      type: "error",
      duration: 7000
    }),
    onToast: payload => showToast(payload)
  });

  const rightPanel = new EditorRightPanel({
    root: query("#editorProjectPanel"),
    layout: query("#editorLayout"),
    session: projectSession,
    draftSession,
    drafts: draftStore,
    projects: projectStore,
    documents,
    events,
    onError: error => showToast({ message: `Editor panel: ${error?.message || error}`, type: "error" }),
    onToast: payload => showToast(payload),
    onPublishDraft,
    onScheduleDraft,
    onApplyDraftChanges,
    onPublishProjectPost,
    onScheduleProjectPost,
    onCancelProjectPostSchedule,
    onApplyProjectChanges
  });

  const projectLibraryRoot = query("#projectLibrary");
  projectLibrary = projectLibraryRoot ? new ProjectLibraryView({
    root: projectLibraryRoot,
    store: projectStore,
    session: projectSession,
    draftSession,
    graphReconciler,
    events,
    gallery: galleryCore,
    thumbnails,
    onOpenEditor: () => navigation.activateTab("editor"),
    onPublishProject,
    onPublishPost: onPublishProjectPost,
    onSchedulePost: onScheduleProjectPost,
    onCancelPostSchedule: onCancelProjectPostSchedule,
    onError: error => showToast({ message: `Project: ${error?.message || error}`, type: "error" })
  }) : null;

  rightPanel.start();
  const commands = new EditorCommandController({
    newButton: query("#newDoc"),
    openDraftsButton: query("#openDrafts"),
    projectSession,
    draftSession,
    draftStore,
    documents,
    tree,
    controller,
    selection,
    textareaSizing: inlineProperties?.textareaSizing,
    rightPanel,
    workspace,
    events,
    notifications: editorNotifications,
    promptFn
  }).start();

  const tools = new EditorToolController({
    documentRoot,
    navigation,
    tree,
    controller,
    selection,
    validator,
    renderer,
    projectSession,
    buildPreviewTree,
    palette,
    workspace,
    notifications: editorNotifications,
    metaRegistry,
    registry,
    metaDialogElement: query("#metaDialog"),
    openMetaButton: query("#saveMeta"),
    createMetaButton: query("#createMeta"),
    blockSearch: query("#blockSearch"),
    openAssetPickerButton,
    jsonDialog: query("#jsonDialog"),
    jsonOutput: query("#jsonOutput"),
    dialogTitle: query("#dialogTitle"),
    closeDialogButton: query("#closeDialog"),
    exportJsonButton: query("#exportJson"),
    previewTelegramButton: query("#previewTelegram"),
    alertFn
  }).start();

  const stoppables = Object.freeze([
    previewStatus,
    navigation,
    eventCoordinator,
    history,
    telegramControls,
    rightPanel,
    projectLibrary,
    commands,
    tools
  ].filter(Boolean));

  return Object.freeze({
    previewStatus,
    navigation,
    eventCoordinator,
    history,
    telegramControls,
    rightPanel,
    projectLibrary,
    commands,
    tools,
    stoppables
  });
}
