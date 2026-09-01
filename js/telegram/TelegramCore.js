export class TelegramCore {
  constructor({
    db,
    client,
    runtime,
    ownerBinding,
    previewChannelBinding,
    publicationTargets,
    publications,
    previewController,
    topics,
    projectPreview,
    events
  }) {
    this.db = db;
    this.client = client;
    this.runtime = runtime;
    this.owner = ownerBinding;
    this.previewChannelBinding = previewChannelBinding;
    this.publications = Object.freeze({
      listTargets: () => publicationTargets.list(),
      startBinding: options => publicationTargets.startBinding(options),
      cancelBinding: () => publicationTargets.cancelBinding(),
      getBindingSession: () => publicationTargets.getSession(),
      refreshTarget: chatId => publicationTargets.refresh(chatId),
      removeTarget: chatId => publicationTargets.remove(chatId),
      setServiceMessageCleanup: (chatId, enabled) => publicationTargets.setServiceMessageCleanup(chatId, enabled),
      onTargetsChanged: handler => events?.on("telegram:publication-targets", handler),
      list: () => publications.list(),
      publishDraft: (draftId, chatId, options) => publications.publishDraft(draftId, chatId, options),
      scheduleDraft: (draftId, chatId, options) => publications.scheduleDraft(draftId, chatId, options),
      cancelDraftSchedule: recordId => publications.cancelDraftSchedule(recordId),
      setPinned: (recordId, pinned) => publications.setPinned(recordId, pinned),
      createEditDraft: recordId => publications.createEditDraft(recordId),
      applyDraftChanges: draftId => publications.applyDraftChanges(draftId),
      delete: recordId => publications.delete(recordId),
      checkExpiredDeletion: recordId => publications.checkExpiredDeletion(recordId),
      discardLocal: recordId => publications.discardLocal(recordId),
      onChanged: handler => events?.on("telegram:publications-changed", handler)
    });
    this.events = events;

    this.editor = Object.freeze({
      preview: Object.freeze({
        schedule: options => previewController.schedule(options),
        sync: options => previewController.sync(options),
        setEnabled: value => previewController.setEnabled(value),
        isEnabled: () => previewController.isEnabled(),
        getMessage: () => previewController.getMessage(),
        getChannel: () => previewController.getChannel()
      })
    });

    this.project = Object.freeze({
      previewChannel: projectPreview
    });

    this.topics = Object.freeze({
      create: name => topics.create(name),
      rename: (threadId, name) => topics.rename(threadId, name),
      delete: threadId => topics.delete(threadId),
      onObserved: handler => events?.on("telegram:owner-topic-event", handler)
    });

    // Gallery will subscribe here; it never needs to parse raw Telegram Update.
    this.media = Object.freeze({
      onReceived: handler => events?.on("telegram:owner-media", handler)
    });
  }
}
