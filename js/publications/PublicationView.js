import { getLocale, t } from "../i18n/index.js?v=1.8.0";
import { linkTargetTooltip, linkTargetVisualState } from "../links/LinkTarget.js?v=1.5.9";
import { showCardDeleteConfirmation } from "../core/CardDeleteConfirmation.js?v=1.5.9";
import { richTextToPlain } from "../core/RichText.js?v=1.5.9";
import { isPublicationDeleteAvailable, publicationDeleteHoursLeft } from "../telegram/PublicationService.js?v=1.7.14";

export class PublicationView {
  constructor({
    root, telegramCore, runtime, navigation = null, events = null, notifications = null,
    layoutPreferences = null, draftSession = null, projectStore = null, documents = null, projectPublications = null
  } = {}) {
    this.root = root;
    this.telegramCore = telegramCore;
    this.runtime = runtime;
    this.navigation = navigation;
    this.events = events;
    this.notifications = notifications;
    this.layoutPreferences = layoutPreferences;
    this.draftSession = draftSession;
    this.projectStore = projectStore;
    this.documents = documents;
    this.projectPublications = projectPublications;
    this.filter = "all";
    this.statusFilter = "all";
    this.sourceFilter = "all";
    this.timeFilter = "all";
    this.dateRange = { from: "", to: "" };
    this.targets = [];
    this.publications = [];
    this.selectedTargetId = null;
    this.selectedPublicationId = null;
    this.publicationSelectionDismissed = false;
    this.linkTargetSlotKey = "";
    this.linkedTargets = {};
    this.session = null;
    this.unsubscribers = [];
  }

  async initialize() {
    if (!this.root) return;
    this.unsubscribers.push(
      this.events?.on?.("telegram:publication-targets", targets => { this.targets = targets || []; this.render(); }),
      this.events?.on?.("telegram:publication-binding", session => { this.session = session?.status === "idle" ? null : session; this.render(); }),
      this.events?.on?.("telegram:publications-changed", rows => { this.publications = rows || []; this.render(); }),
      this.events?.on?.("project:publication", () => this.render()),
      this.events?.on?.("draft:session-changed", () => this.render()),
      this.events?.on?.("publication:draft-requested", draft => this.#showPublishDraftDialog(draft)),
      this.events?.on?.("publication:draft-schedule-requested", draft => this.#showScheduleDraftDialog(draft)),
      this.events?.on?.("telegram:draft-publication-schedule-error", ({ record, message } = {}) => {
        this.notifications?.show?.({
          message: t("publications.publicationView.failedToPublish", { 0: record?.source?.title || t("publications.publicationView.delayedDraft"), 1: message || t("publications.publicationView.retryInAMinute") }),
          type: "error",
          duration: 7000
        });
      }),
      this.events?.on?.("links:target-slot-changed", ({ targetKey = "" } = {}) => {
        if (targetKey === this.linkTargetSlotKey) return;
        this.linkTargetSlotKey = targetKey;
        this.render();
      }),
      this.events?.on?.("links:relation-targets-changed", ({ linkedTargets = {} } = {}) => {
        this.linkedTargets = linkedTargets;
        this.render();
      })
    );
    this.events?.emit?.("links:state-requested");
    [this.targets, this.session, this.publications] = await Promise.all([
      this.telegramCore.publications.listTargets(),
      this.telegramCore.publications.getBindingSession(),
      this.telegramCore.publications.list()
    ]);
    const incompleteChannels = this.targets.filter(target =>
      target.type === "channel" && target.commentsEnabled && !target.linkedDiscussionTitle
    );
    if (incompleteChannels.length) {
      await Promise.all(incompleteChannels.map(target =>
        this.telegramCore.publications.refreshTarget(target.chatId).catch(() => null)
      ));
      this.targets = await this.telegramCore.publications.listTargets();
    }
    this.render();
  }

  stop() { for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.(); }

  requestDraftPublication(draft) { return this.#showPublishDraftDialog(draft); }
  requestDraftSchedule(draft) { return this.#showScheduleDraftDialog(draft); }
  requestProjectPublication(project) { return this.#showPublishProjectDialog(project); }
  requestProjectPostPublication(project, post) { return this.#showPublishProjectDialog(project, post); }
  requestProjectPostSchedule(project, post) { return this.#showScheduleProjectPostDialog(project, post); }

  render() {
    if (!this.root) return;
    this.root.innerHTML = "";
    const shell = el("div", "publication-shell");
    const sidebar = el("aside", "publication-sidebar");
    const add = button(t("publications.publicationView.addChannelGroup"), () => this.#startBinding(), "primary publication-add-target");
    const filters = el("div", "publication-filters");
    for (const [value, label] of [["all", t("editor.blockPalette.all")], ["channel", t("publications.publicationView.channels")], ["group", t("publications.publicationView.groups")]]) {
      const chip = button(label, () => { this.filter = value; this.render(); }, "publication-filter-chip");
      chip.classList.toggle("active", this.filter === value);
      chip.setAttribute("aria-pressed", String(this.filter === value));
      filters.append(chip);
    }
    sidebar.append(add, filters);
    if (this.session?.code) sidebar.append(this.#bindingCard());

    const visible = this.targets.filter(target => this.filter === "all" || target.type === this.filter);
    const list = el("div", "publication-target-list");
    if (!visible.length) list.append(el("div", "publication-target-empty", t("publications.publicationView.noConnectedChannelsAndGroupsYet")));
    for (const target of visible) list.append(this.#targetCard(target));
    sidebar.append(list);

    const content = el("section", "publication-content");
    content.append(el("h1", "", t("publications.publicationView.posts")));
    const filterPanel = el("div", "publication-content-filters");
    filterPanel.append(this.#contentFilterRow(t("project.projectLibraryView.status"), [
      ["all", t("editor.blockPalette.all")], ["published", t("publications.publicationView.published")], ["scheduled", t("publications.publicationView.scheduled")]
    ], this.statusFilter, value => { this.statusFilter = value; this.render(); }));
    filterPanel.append(this.#contentFilterRow(t("gallery.galleryView.source"), [
      ["all", t("editor.blockPalette.all")], ["draft", t("editor.draftListView.drafts")], ["project", t("project.projectLibraryView.projects")]
    ], this.sourceFilter, value => { this.sourceFilter = value; this.render(); }));
    filterPanel.append(this.#contentFilterRow(t("publications.publicationView.period"), [
      ["all", t("publications.publicationView.allTime")], ["today", t("publications.publicationView.today")], ["7d", t("publications.publicationView.7Days")], ["month", t("publications.publicationView.month")], ["custom", t("publications.publicationView.customRange")]
    ], this.timeFilter, value => { this.timeFilter = value; this.render(); }));
    if (this.timeFilter === "custom") filterPanel.append(this.#dateRangeEditor());
    content.append(filterPanel);
    const publications = this.#filteredPublications();
    const selectedPublication = this.#normalizePublicationSelection(publications);
    const publicationList = el("div", "publication-record-list");
    if (!publications.length) publicationList.append(el("p", "publication-content-empty", t("publications.publicationView.noPostsForTheSelectedFiltersYet")));
    for (const record of publications) publicationList.append(this.#publicationCard(record));
    content.append(publicationList);
    const leftSplitter = el("div", "layout-splitter publication-splitter");
    leftSplitter.title = t("publications.publicationView.changeTheWidthOfTheChannelsAnd");
    leftSplitter.dataset.publicationSplitter = "left";
    const rightSplitter = el("div", "layout-splitter publication-splitter");
    rightSplitter.title = t("publications.publicationView.changeTheWidthOfTheSelectedPost");
    rightSplitter.dataset.publicationSplitter = "right";
    shell.append(sidebar, leftSplitter, content, rightSplitter, this.#publicationPostPanel(selectedPublication));
    this.root.append(shell);
    this.layoutPreferences?.bindSplitter?.(leftSplitter, { key: "publicationsLeft", edge: "left" });
    this.layoutPreferences?.bindSplitter?.(rightSplitter, { key: "publicationsRight", edge: "right" });
  }

  #filteredPublications() {
    const now = Date.now();
    const from = this.timeFilter === "today" ? new Date().setHours(0, 0, 0, 0)
      : this.timeFilter === "7d" ? now - 7 * 86400000
        : this.timeFilter === "month" ? now - 30 * 86400000
          : this.timeFilter === "custom" && this.dateRange.from ? new Date(this.dateRange.from).getTime() : 0;
    const to = this.timeFilter === "custom" && this.dateRange.to ? new Date(`${this.dateRange.to}T23:59:59`).getTime() : Infinity;
    return this.publications.filter(record => {
      if (this.selectedTargetId && Number(record.chatId) !== Number(this.selectedTargetId)) return false;
      if (this.sourceFilter !== "all" && record.source?.kind !== this.sourceFilter) return false;
      if (this.statusFilter === "published" && record.scheduledAt) return false;
      if (this.statusFilter === "scheduled" && !record.scheduledAt) return false;
      return this.timeFilter === "all" || (Number(record.publishedAt || record.scheduledAt) >= from && Number(record.publishedAt || record.scheduledAt) <= to);
    });
  }

  #normalizePublicationSelection(publications) {
    let selected = publications.find(record => record.id === this.selectedPublicationId) || null;
    if (!selected && !this.publicationSelectionDismissed) selected = publications[0] || null;
    this.selectedPublicationId = selected?.id || null;
    return selected;
  }

  #publicationCard(record) {
    const selected = record.id === this.selectedPublicationId;
    const editingInEditor = this.#isEditingPublication(record);
    const projectPost = record.source?.kind === "project";
    const scheduled = Boolean(record.scheduledAt);
    const card = el("article", `publication-record-card${selected ? " selected" : ""}${editingInEditor ? " editor-active" : ""}${projectPost ? " project-publication" : ""}`);
    card.dataset.publicationId = String(record.id || "");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(selected));
    const head = el("div", "publication-record-head");
    const identity = el("div", "publication-record-identity");
    identity.append(el("strong", "", record.source?.title || t("editor.draftListView.publication")));
    identity.append(el("span", "", `${record.target?.title || record.chatId} · ${formatPublicationDate(record.scheduledAt || record.publishedAt)}`));
    if (projectPost) identity.append(el("span", "publication-record-origin project", t("publications.publicationView.project", { 0: record.source?.projectTitle || t("publications.publicationView.untitled") })));
    else if (scheduled) identity.append(el("span", "publication-record-origin", t("publications.publicationView.draftScheduledPost")));
    const tools = el("div", "publication-record-tools");
    const edit = button("✎", () => this.#editPublication(record), "publication-record-edit");
    edit.title = projectPost ? t("publications.publicationView.openProjectPostInEditor") : scheduled ? t("publications.publicationView.editScheduledPostInEditor") : t("publications.publicationView.editPostInEditor");
    const linkTarget = {
      kind: "publication",
      id: record.id,
      title: record.source?.title || record.target?.title || t("editor.draftListView.publication")
    };
    const link = createLinkTargetButton(linkTarget, {
      targetKey: this.linkTargetSlotKey,
      linkedTargets: this.linkedTargets,
      onSelect: target => this.events?.emit?.("links:target-selected", target),
      onOpenLinkedSource: target => this.#openLinkedSource(target)
    });
    const pin = button("📌", () => this.#togglePinned(record, pin), "publication-record-pin");
    pin.classList.toggle("active", Boolean(record.pinned));
    pin.title = scheduled ? t("publications.publicationView.postNotYetPublished") : record.pinned ? t("publications.publicationView.unpinPost") : t("publications.publicationView.pinPost");
    if (!scheduled && record.commentsEnabled && record.discussionMessageId) {
      pin.title = record.pinned ? t("publications.publicationView.unpinPostAndComments") : t("publications.publicationView.pinPostAndComments");
    }
    const discussionPending = !record.pinned && record.commentsEnabled && !record.discussionMessageId;
    if (discussionPending) pin.title = t("publications.publicationView.messageExpectedInDiscussionGroup");
    pin.setAttribute("aria-label", pin.title);
    pin.setAttribute("aria-pressed", String(Boolean(record.pinned)));
    pin.disabled = scheduled || discussionPending;
    const open = button("👁", () => this.#openMessage(record), "publication-record-open");
    open.title = scheduled ? t("publications.publicationView.postNotYetPublished") : t("publications.publicationView.openMessageInTelegram");
    open.disabled = scheduled;
    const remove = button("🗑", () => this.#requestPublicationRemoval(card, record, remove), "publication-record-delete");
    remove.title = scheduled
      ? t("project.projectPostCard.cancelTheScheduledPublication")
      : isPublicationDeleteAvailable(record)
      ? (projectPost ? t("publications.publicationView.deleteProjectPostFromTelegramAndReturn") : t("publications.publicationView.deleteMessageFromTelegram"))
      : t("publications.publicationView.checkPublicationAndIfNecessaryRemoveLocal");
    tools.append(edit, link, pin, open, remove);
    head.append(identity, tools);
    const reactionRow = el("div", "publication-reaction-row");
    const stats = el("div", "publication-record-stats");
    for (const reaction of record.reactions || []) {
      const count = Number(reaction.total_count || 0);
      if (!count) continue;
      const badge = el("span", "publication-reaction-badge", `${reactionEmoji(reaction.type)} ${count}`);
      badge.title = reactionTitle(reaction.type, count);
      reactionRow.append(badge);
    }
    if (record.commentsEnabled) {
      const comments = button("💬", () => this.#openDiscussion(record), "publication-comment-badge");
      comments.title = record.discussionMessageId ? t("publications.publicationView.openDiscussion") : t("publications.publicationView.messageExpectedInDiscussionGroup");
      comments.setAttribute("aria-label", comments.title);
      comments.disabled = !record.discussionMessageId;
      stats.append(comments);
    }
    card.append(head);
    if (reactionRow.childElementCount) card.append(reactionRow);
    card.append(stats);
    const select = () => {
      if (this.selectedPublicationId === record.id) return;
      this.selectedPublicationId = record.id;
      this.publicationSelectionDismissed = false;
      this.render();
    };
    card.onclick = event => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      select();
    };
    card.onkeydown = event => {
      if (!["Enter", " "].includes(event.key) || event.target.closest("button, a, input, textarea, select")) return;
      event.preventDefault();
      select();
    };
    return card;
  }

  #isEditingPublication(record) {
    const draft = this.draftSession?.draft;
    return Boolean(
      this.draftSession?.isActive?.()
      && draft?.source?.kind === "publication"
      && String(draft.source.publicationId || "") === String(record?.id || "")
    );
  }

  #publicationPostPanel(record) {
    const panel = el("aside", `publication-post-panel${record ? " visible" : ""}`);
    panel.setAttribute("aria-label", t("publications.publicationView.dataOfSelectedPost"));
    if (!record) {
      const empty = el("div", "post-detail-panel-empty");
      empty.append(el("strong", "", t("publications.publicationView.selectAPost")), el("span", "", t("project.projectLibraryView.dataOfTheSelectedPostWillAppear")));
      panel.append(empty);
      return panel;
    }

    const head = el("div", "post-detail-panel-head");
    const heading = el("div", "post-detail-panel-heading");
    const projectPost = record.source?.kind === "project";
    heading.append(
      el("span", "post-detail-panel-kicker", projectPost ? t("editor.projectPostListView.projectPost") : record.scheduledAt ? t("publications.publicationView.scheduledDraft") : t("editor.draftListView.publication")),
      el("h2", "", record.source?.title || record.target?.title || t("editor.draftListView.publication")),
      el("span", `post-detail-panel-state ${record.scheduledAt ? "scheduled" : "published"}`, record.scheduledAt ? t("publications.publicationView.scheduled2") : t("publications.publicationView.published2"))
    );
    const close = button("×", () => {
      this.selectedPublicationId = null;
      this.publicationSelectionDismissed = true;
      this.render();
    }, "post-detail-panel-close");
    close.title = t("publications.publicationView.closeSelectedPostPanel");
    close.setAttribute("aria-label", close.title);
    head.append(heading, close);

    const actions = el("div", "post-detail-panel-actions");
    const edit = button(projectPost ? t("project.projectLibraryView.openInEditor2") : t("publications.publicationView.edit"), () => this.#editPublication(record));
    const open = button(t("publications.publicationView.openInTelegram"), () => this.#openMessage(record), "primary");
    open.disabled = Boolean(record.scheduledAt);
    actions.append(edit, open);
    if (record.scheduledAt) {
      actions.append(button(t("project.projectPostCard.cancelTheScheduling"), () => this.#cancelScheduledPublication(record)));
    }
    if (record.commentsEnabled && record.discussionMessageId) {
      actions.append(button(t("publications.publicationView.discussion"), () => this.#openDiscussion(record)));
    }

    const data = el("dl", "post-detail-panel-data");
    if (projectPost) appendDetailData(data, t("project.projectLibraryView.project"), record.source?.projectTitle || "—");
    appendDetailData(data, t("publications.publicationView.channel"), record.target?.title || String(record.chatId || "—"));
    appendDetailData(data, t("gallery.galleryView.type2"), record.target?.type === "group" ? t("publications.publicationView.group") : t("publications.publicationView.channel"));
    appendDetailData(data, record.scheduledAt ? t("publications.publicationView.scheduled2") : t("publications.publicationView.published2"), formatPublicationDate(record.scheduledAt || record.publishedAt));
    appendDetailData(data, t("publications.publicationView.telegramId"), record.messageId ? String(record.messageId) : "—");
    appendDetailData(data, t("editor.editorWorkspaceView.blocks"), String(countAstBlocks(record.messageAst)));
    appendDetailData(data, t("publications.publicationView.reactions"), formatCount(record.reactionCount || reactionTotal(record.reactions)));
    appendDetailData(data, t("publications.publicationView.comments"), record.commentsEnabled ? formatCount(record.commentCount) : t("publications.publicationView.disabled"));
    const deleteHours = publicationDeleteHoursLeft(record);
    appendDetailData(data, t("publications.publicationView.deletion"), record.scheduledAt ? t("publications.publicationView.willAppearAfterPublication") : (deleteHours ? t("publications.publicationView.availableForAnotherH", { 0: deleteHours }) : t("publications.publicationView.unavailableAfter48H")));

    const content = el("section", "post-detail-panel-content publication-detail-content");
    content.append(el("h3", "", t("core.propertyRegistry.content")));
    content.append(el("p", "publication-detail-summary", summarizePublication(record.messageAst)));

    panel.append(head, actions, data, content);
    return panel;
  }

  #openMessage(record) {
    if (!record?.messageId) return false;
    return record.target?.username
      ? this.navigation?.openPublicMessage?.({ username: record.target.username, messageId: record.messageId })
      : this.navigation?.openPrivateMessage?.({ chatId: record.chatId, messageId: record.messageId });
  }

  #openLinkedSource(target) {
    this.events?.emit?.("links:open-linked-source-requested", target);
  }

  async #togglePinned(record, pinButton) {
    if (record?.scheduledAt || !record?.messageId || !this.telegramCore?.publications?.setPinned) return false;
    pinButton.disabled = true;
    try {
      const updated = await this.telegramCore.publications.setPinned(record.id, !record.pinned);
      this.notifications?.show?.({
        message: updated.pinned ? t("publications.publicationView.postPinned") : t("publications.publicationView.postUnpinned"),
        type: "success"
      });
      return true;
    } catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.pinning", { 0: error?.message || error }), type: "error" });
      return false;
    } finally {
      if (pinButton.isConnected) pinButton.disabled = false;
    }
  }

  async #editPublication(record) {
    try {
      if (record.source?.kind === "project") {
        if (!this.documents?.openProjectPost) throw new Error(t("publications.publicationView.editorCannotOpenProjectPost"));
        await this.documents.openProjectPost(record.source.projectId, record.source.postId);
        document.querySelector('[data-tab="editor"]')?.click?.();
        return true;
      }
      const draft = await this.telegramCore.publications.createEditDraft(record.id);
      await this.events?.emitAsync?.("publication:edit-draft-requested", draft);
      document.querySelector('[data-tab="editor"]')?.click?.();
    } catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.edit2", { 0: error?.message || error }), type: "error" });
    }
  }

  #openDiscussion(record) {
    if (!record.discussionChatId || !record.discussionMessageId) return false;
    return record.discussionUsername
      ? this.navigation?.openPublicMessage?.({ username: record.discussionUsername, messageId: record.discussionMessageId })
      : this.navigation?.openPrivateMessage?.({ chatId: record.discussionChatId, messageId: record.discussionMessageId });
  }

  async #deletePublication(record) {
    try {
      const projectMissing = await this.#isProjectSourceMissing(record);
      if (record.source?.kind === "project" && !projectMissing) {
        if (!this.projectPublications?.unpublishPost) throw new Error(t("publications.publicationView.deletionProjectPublicationNotConnected"));
        await this.projectPublications.unpublishPost(record.source.projectId, record.source.postId);
      } else {
        await this.telegramCore.publications.delete(record.id);
      }
      this.publications = await this.telegramCore.publications.list();
      this.render();
    }
    catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.delete", { 0: error?.message || error }), type: "error" });
      return false;
    }
  }

  async #requestPublicationRemoval(card, record, removeButton) {
    const projectMissing = await this.#isProjectSourceMissing(record);
    if (record.scheduledAt) {
      if (projectMissing) {
        showCardDeleteConfirmation(card, {
          message: t("publications.publicationView.projectForDelayedPublicationWasNotFound", { 0: record.source?.title || t("editor.blockInspector.post") }),
          confirmLabel: t("publications.publicationView.removeLocally"),
          onConfirm: () => this.#discardLocalPublication(record)
        });
        return;
      }
      showCardDeleteConfirmation(card, {
        message: t("publications.publicationView.cancelDelayedPublication", { 0: record.source?.title || t("editor.blockInspector.post") }),
        confirmLabel: t("publications.publicationView.cancel"),
        onConfirm: () => this.#cancelScheduledPublication(record)
      });
      return;
    }
    if (isPublicationDeleteAvailable(record)) {
      showCardDeleteConfirmation(card, {
        message: record.source?.kind === "project" && !projectMissing
          ? t("publications.publicationView.deleteProjectPostFromTelegram", { 0: record.source?.title || t("editor.blockInspector.post") })
          : t("publications.publicationView.deletePublicationFromTelegram", { 0: record.source?.title || t("editor.draftListView.publication") }),
        onConfirm: () => this.#deletePublication(record)
      });
      return;
    }

    removeButton.disabled = true;
    try {
      const result = record.source?.kind === "project" && !projectMissing
        ? await this.projectPublications?.checkExpiredUnpublish?.(record.source.projectId, record.source.postId)
        : await this.telegramCore.publications.checkExpiredDeletion?.(record.id);
      if (!result) throw new Error(t("publications.publicationView.publicationCheckNotConnected"));
      if (result.remoteState === "deleted") {
        this.publications = await this.telegramCore.publications.list();
        this.render();
        this.notifications?.show?.({ message: t("publications.publicationView.messageDeletedFromTelegramLocalProjectionCleared"), type: "success" });
        return;
      }
      this.#showExpiredRemovalConfirmation(card, record, result.remoteState);
    } catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.publicationCheck", { 0: error?.message || error }), type: "error" });
    } finally {
      if (removeButton.isConnected) removeButton.disabled = false;
    }
  }

  #showExpiredRemovalConfirmation(card, record, remoteState) {
    const projectPost = record.source?.kind === "project";
    const title = projectPost ? t("editor.projectPostListView.projectPost") : t("editor.draftListView.publication");
    const message = remoteState === "present"
      ? t("publications.publicationView.isStillInTelegramBut48Hours", { 0: title })
      : t("publications.publicationView.noLongerFoundInTelegramRemoveLocal", { 0: title });
    showCardDeleteConfirmation(card, {
      message,
      confirmLabel: t("publications.publicationView.removeLocally"),
      onConfirm: () => this.#discardLocalPublication(record)
    });
  }

  async #discardLocalPublication(record) {
    try {
      const projectMissing = await this.#isProjectSourceMissing(record);
      if (record.source?.kind === "project" && !projectMissing) {
        if (!this.projectPublications?.discardPostProjection) throw new Error(t("publications.publicationView.localProjectPublicationCleanupIsNotConnected"));
        await this.projectPublications.discardPostProjection(record.source.projectId, record.source.postId);
      } else {
        if (!this.telegramCore.publications.discardLocal) throw new Error(t("publications.publicationView.localPublicationCleanupIsNotConnected"));
        await this.telegramCore.publications.discardLocal(record.id);
      }
      this.publications = await this.telegramCore.publications.list();
      this.render();
      return true;
    } catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.localCleanup", { 0: error?.message || error }), type: "error" });
      return false;
    }
  }

  async #cancelScheduledPublication(record) {
    try {
      if (record.source?.kind === "project") {
        if (!this.projectPublications?.cancelPostSchedule) throw new Error(t("publications.publicationView.cancelOfPostponedProjectPublicationIsNot"));
        await this.projectPublications.cancelPostSchedule(record.source.projectId, record.source.postId);
      } else {
        if (!this.telegramCore.publications.cancelDraftSchedule) throw new Error(t("publications.publicationView.cancelOfPostponedDraftIsNotConnected"));
        await this.telegramCore.publications.cancelDraftSchedule(record.id);
      }
      this.publications = await this.telegramCore.publications.list();
      this.render();
      this.notifications?.show?.({
        message: record.source?.kind === "project" ? t("publications.publicationView.postponedPublicationCanceled") : t("publications.publicationView.delayCanceledMaterialReturnedToDrafts"),
        type: "success"
      });
      return true;
    } catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.postponedPublication", { 0: error?.message || error }), type: "error" });
      return false;
    }
  }

  async #isProjectSourceMissing(record) {
    if (record?.source?.kind !== "project" || !record.source?.projectId) return false;
    if (!this.projectStore?.getProject) return false;
    return !(await this.projectStore.getProject(record.source.projectId));
  }

  #showPublishDraftDialog(draft) {
    const targets = this.targets.filter(target => target.status === "ready");
    if (!targets.length) {
      this.notifications?.show?.({ message: t("publications.publicationView.firstConnectAnAvailableChannelOrGroup"), type: "warning" });
      return;
    }
    const dialog = document.createElement("dialog");
    dialog.className = "publication-draft-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const head = el("div", "dialog-head");
    head.append(el("strong", "", t("editor.draftListView.publishDraft")), button("×", () => dialog.close("cancel")));
    const body = el("div", "publication-draft-dialog-body");
    body.append(el("strong", "publication-draft-title", draft.title || t("editor.draftListView.draft")));
    const field = el("label", "publication-draft-target-field");
    field.append(el("span", "", t("publications.publicationView.channelOrGroup")));
    const select = document.createElement("select");
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = String(target.chatId);
      option.textContent = `${target.type === "channel" ? t("publications.publicationView.channel") : t("publications.publicationView.group")} · ${target.title}`;
      select.append(option);
    }
    field.append(select);
    const commentsField = el("label", "publication-comments-option");
    const comments = document.createElement("input");
    comments.type = "checkbox";
    comments.checked = true;
    commentsField.append(comments, el("span", "", t("publications.publicationView.commentsEnabled")));
    const syncComments = () => {
      const target = targets.find(item => Number(item.chatId) === Number(select.value));
      commentsField.hidden = !(target?.type === "channel" && target.commentsEnabled);
      comments.checked = !commentsField.hidden;
      comments.disabled = commentsField.hidden;
      commentsField.title = t("publications.publicationView.uncheckToRemoveThePostMessageFrom");
    };
    select.onchange = syncComments;
    syncComments();
    const actions = el("div", "format-config-actions");
    const cancel = button(t("core.cardDeleteConfirmation.cancel"), () => dialog.close("cancel"));
    const publish = button(t("editor.draftListView.publish"), async () => {
      publish.disabled = cancel.disabled = select.disabled = true;
      try {
        const targetChatId = Number(select.value);
        await this.telegramCore.publications.refreshTarget(targetChatId);
        const record = await this.telegramCore.publications.publishDraft(draft.id, targetChatId, { commentsEnabled: comments.checked });
        this.selectedTargetId = record.chatId;
        dialog.close("published");
        document.querySelector('[data-tab="publications"]')?.click?.();
        this.render();
        this.notifications?.show?.({ message: t("publications.publicationView.published3", { 0: draft.title }), type: "success" });
      } catch (error) {
        publish.disabled = cancel.disabled = select.disabled = false;
        syncComments();
        this.notifications?.show?.({ message: t("publications.publicationView.publication", { 0: error?.message || error }), type: "error" });
      }
    }, "primary");
    actions.append(cancel, publish);
    body.append(field, commentsField, actions);
    form.append(head, body);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  }

  #showScheduleDraftDialog(draft) {
    const targets = this.targets.filter(target => target.status === "ready");
    if (!this.telegramCore?.publications?.scheduleDraft) {
      this.notifications?.show?.({ message: t("publications.publicationView.postponedDraftPublicationIsNotConnected"), type: "error" });
      return;
    }
    if (!draft?.id || !targets.length) {
      this.notifications?.show?.({ message: t("publications.publicationView.firstConnectAnAvailableChannelOrGroup"), type: "warning" });
      return;
    }
    const dialog = document.createElement("dialog");
    dialog.className = "publication-draft-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const head = el("div", "dialog-head");
    head.append(el("strong", "", t("publications.publicationView.postponeDraft")), button("×", () => dialog.close("cancel")));
    const body = el("div", "publication-draft-dialog-body");
    body.append(el("strong", "publication-draft-title", draft.title || t("editor.draftListView.draft")));

    const targetField = el("label", "publication-draft-target-field");
    targetField.append(el("span", "", t("publications.publicationView.channelOrGroup")));
    const targetSelect = document.createElement("select");
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = String(target.chatId);
      option.textContent = `${target.type === "channel" ? t("publications.publicationView.channel") : t("publications.publicationView.group")} · ${target.title}`;
      targetSelect.append(option);
    }
    targetField.append(targetSelect);

    const timeField = el("label", "publication-draft-target-field");
    timeField.append(el("span", "", t("core.propertyRegistry.dateAndTime")));
    const time = document.createElement("input");
    time.type = "datetime-local";
    time.step = "60";
    time.min = datetimeLocalValue(Date.now() + 60_000);
    time.value = datetimeLocalValue(Date.now() + 10 * 60_000);
    timeField.append(time);

    const commentsField = el("label", "publication-comments-option");
    commentsField.append(el("span", "", t("publications.publicationView.comments")));
    const comments = document.createElement("select");
    comments.append(new Option(t("publications.publicationView.enabled"), "enabled"), new Option(t("publications.publicationView.disabled"), "disabled"));
    commentsField.append(comments);
    const syncComments = () => {
      const target = targets.find(item => Number(item.chatId) === Number(targetSelect.value));
      commentsField.hidden = !(target?.type === "channel" && target.commentsEnabled);
      comments.disabled = commentsField.hidden;
      commentsField.title = t("publications.publicationView.toDisableCommentsTheBotNeedsPermission");
    };
    targetSelect.onchange = syncComments;
    syncComments();

    const actions = el("div", "format-config-actions");
    const cancel = button(t("core.cardDeleteConfirmation.cancel"), () => dialog.close("cancel"));
    const schedule = button(t("editor.draftListView.postpone"), async () => {
      const scheduledAt = new Date(time.value).getTime();
      if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
        time.setCustomValidity(t("publications.publicationView.specifyAFutureTime"));
        time.reportValidity();
        return;
      }
      time.setCustomValidity("");
      schedule.disabled = cancel.disabled = targetSelect.disabled = time.disabled = comments.disabled = true;
      try {
        const targetChatId = Number(targetSelect.value);
        await this.telegramCore.publications.refreshTarget(targetChatId);
        const record = await this.telegramCore.publications.scheduleDraft(draft.id, targetChatId, {
          scheduledAt,
          commentsEnabled: comments.value !== "disabled"
        });
        this.selectedTargetId = record.chatId;
        this.selectedPublicationId = record.id;
        this.publicationSelectionDismissed = false;
        this.sourceFilter = "draft";
        this.statusFilter = "scheduled";
        dialog.close("scheduled");
        document.querySelector('[data-tab="publications"]')?.click?.();
        this.render();
        this.notifications?.show?.({ message: t("publications.publicationView.postponed", { 0: draft.title || t("editor.draftListView.draft") }), type: "success" });
      } catch (error) {
        schedule.disabled = cancel.disabled = targetSelect.disabled = time.disabled = false;
        syncComments();
        this.notifications?.show?.({ message: t("publications.publicationView.postponedPublication", { 0: error?.message || error }), type: "error", duration: 7000 });
      }
    }, "primary");
    actions.append(cancel, schedule);
    body.append(targetField, timeField, commentsField, actions);
    form.append(head, body);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    time.focus();
  }

  #showPublishProjectDialog(project, post = null) {
    const targets = this.targets.filter(target => target.status === "ready");
    if (!this.projectPublications) {
      this.notifications?.show?.({ message: t("publications.publicationView.productionProjectPublicationIsNotConnected"), type: "error" });
      return;
    }
    if (!targets.length) {
      this.notifications?.show?.({ message: t("publications.publicationView.firstConnectAnAvailableChannelOrGroup"), type: "warning" });
      return;
    }

    const productionChatIds = [...new Set((project?.posts || [])
      .map(post => Number(post.deployments?.production?.chatId || post.schedule?.chatId || 0))
      .filter(Boolean))];
    if (productionChatIds.length > 1) {
      this.notifications?.show?.({ message: t("publications.publicationView.theProjectAlreadyHasSeveralProductionChannels"), type: "error" });
      return;
    }
    const lockedTargetId = productionChatIds[0] || null;
    const dialog = document.createElement("dialog");
    dialog.className = "publication-draft-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const head = el("div", "dialog-head");
    const singlePost = Boolean(post?.id);
    head.append(el("strong", "", singlePost ? t("publications.publicationView.publishTheProjectPost") : t("project.projectLibraryView.publishProject")), button("×", () => dialog.close("cancel")));
    const body = el("div", "publication-draft-dialog-body");
    body.append(el("strong", "publication-draft-title", singlePost ? `${project?.title || t("project.projectLibraryView.project")} · ${post.title || t("editor.blockInspector.post")}` : (project?.title || t("project.projectLibraryView.project"))));
    body.append(el("p", "", singlePost
      ? t("publications.publicationView.whenPublishingTheLinkedPostMapWill")
      : t("publications.publicationView.postsWithAPostMapWillBe")));
    const field = el("label", "publication-draft-target-field");
    field.append(el("span", "", t("publications.publicationView.channelOrGroup")));
    const select = document.createElement("select");
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = String(target.chatId);
      option.textContent = `${target.type === "channel" ? t("publications.publicationView.channel") : t("publications.publicationView.group")} · ${target.title}`;
      option.selected = Number(target.chatId) === Number(lockedTargetId);
      select.append(option);
    }
    if (lockedTargetId) {
      const selectedTarget = targets.find(target => Number(target.chatId) === Number(lockedTargetId));
      if (!selectedTarget) {
        dialog.remove();
        this.notifications?.show?.({ message: t("publications.publicationView.theProjectProductionChannelIsNoLonger"), type: "error" });
        return;
      }
      select.disabled = true;
      field.append(el("span", "publication-project-target-lock", t("publications.publicationView.theChannelIsTiedToAlreadyPublished")));
    }
    field.append(select);
    const commentsField = el("label", "publication-comments-option");
    const disableComments = document.createElement("input");
    disableComments.type = "checkbox";
    commentsField.append(disableComments, el("span", "", t("publications.publicationView.disableComments")));
    const syncComments = () => {
      const target = targets.find(item => Number(item.chatId) === Number(select.value));
      commentsField.hidden = !(target?.type === "channel" && target.commentsEnabled);
      disableComments.checked = false;
      disableComments.disabled = commentsField.hidden;
      commentsField.title = t("publications.publicationView.theBotWillDeleteTechnicalPostMessages");
    };
    select.onchange = syncComments;
    syncComments();
    const actions = el("div", "format-config-actions");
    const cancel = button(t("core.cardDeleteConfirmation.cancel"), () => dialog.close("cancel"));
    const publish = button(lockedTargetId ? (singlePost ? t("publications.publicationView.publishPost") : t("publications.publicationView.continuePublishing")) : (singlePost ? t("publications.publicationView.publishPost") : t("project.projectLibraryView.publishProject")), async () => {
      publish.disabled = cancel.disabled = true;
      const wasDisabled = select.disabled;
      select.disabled = true;
      disableComments.disabled = true;
      try {
        const targetChatId = Number(select.value);
        await this.telegramCore.publications.refreshTarget(targetChatId);
        const result = singlePost
          ? await this.projectPublications.publishPost(project.id, post.id, targetChatId, { commentsEnabled: !disableComments.checked })
          : await this.projectPublications.publishProject(project.id, targetChatId, { commentsEnabled: !disableComments.checked });
        this.selectedTargetId = result.target.chatId;
        this.sourceFilter = "project";
        dialog.close("published");
        document.querySelector('[data-tab="publications"]')?.click?.();
        this.render();
        this.notifications?.show?.({ message: singlePost ? t("publications.publicationView.published4", { 0: post.title || t("editor.blockInspector.post") }) : t("publications.publicationView.projectPublished", { 0: project.title }), type: "success" });
      } catch (error) {
        publish.disabled = cancel.disabled = false;
        select.disabled = wasDisabled;
        syncComments();
        this.notifications?.show?.({ message: t("publications.publicationView.projectError", { 0: error?.message || error }), type: "error", duration: 7000 });
      }
    }, "primary");
    actions.append(cancel, publish);
    body.append(field, commentsField, actions);
    form.append(head, body);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  }

  #showScheduleProjectPostDialog(project, post) {
    const targets = this.targets.filter(target => target.status === "ready");
    if (!this.projectPublications?.schedulePost) {
      this.notifications?.show?.({ message: t("publications.publicationView.delayedProjectPublicationIsNotConnected"), type: "error" });
      return;
    }
    if (!project?.id || !post?.id || !targets.length) {
      this.notifications?.show?.({ message: t("publications.publicationView.firstConnectAnAvailableChannelOrGroup"), type: "warning" });
      return;
    }
    const targetChatIds = [...new Set((project.posts || [])
      .map(item => Number(item.deployments?.production?.chatId || item.schedule?.chatId || 0))
      .filter(Boolean))];
    if (targetChatIds.length > 1) {
      this.notifications?.show?.({ message: t("publications.publicationView.theProjectAlreadyHasSeveralProductionChannels"), type: "error" });
      return;
    }
    const lockedTargetId = targetChatIds[0] || null;
    const dialog = document.createElement("dialog");
    dialog.className = "publication-draft-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const head = el("div", "dialog-head");
    head.append(el("strong", "", t("publications.publicationView.delayPublication")), button("×", () => dialog.close("cancel")));
    const body = el("div", "publication-draft-dialog-body");
    body.append(el("strong", "publication-draft-title", `${project.title || t("project.projectLibraryView.project")} · ${post.title || t("editor.blockInspector.post")}`));

    const targetField = el("label", "publication-draft-target-field");
    targetField.append(el("span", "", t("publications.publicationView.channelOrGroup")));
    const targetSelect = document.createElement("select");
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = String(target.chatId);
      option.textContent = `${target.type === "channel" ? t("publications.publicationView.channel") : t("publications.publicationView.group")} · ${target.title}`;
      option.selected = Number(target.chatId) === Number(lockedTargetId);
      targetSelect.append(option);
    }
    if (lockedTargetId) {
      if (!targets.some(target => Number(target.chatId) === Number(lockedTargetId))) {
        dialog.remove();
        this.notifications?.show?.({ message: t("publications.publicationView.theProjectProductionChannelIsNoLonger"), type: "error" });
        return;
      }
      targetSelect.disabled = true;
      targetField.append(el("span", "publication-project-target-lock", t("publications.publicationView.theChannelIsTiedToOtherProject")));
    }
    targetField.append(targetSelect);

    const timeField = el("label", "publication-draft-target-field");
    timeField.append(el("span", "", t("core.propertyRegistry.dateAndTime")));
    const time = document.createElement("input");
    time.type = "datetime-local";
    time.step = "60";
    time.min = datetimeLocalValue(Date.now() + 60_000);
    time.value = datetimeLocalValue(Number(post?.schedule?.scheduledAt || Date.now() + 10 * 60_000));
    timeField.append(time);

    const commentsField = el("label", "publication-comments-option");
    commentsField.append(el("span", "", t("publications.publicationView.comments")));
    const comments = document.createElement("select");
    comments.append(new Option(t("publications.publicationView.enabled"), "enabled"), new Option(t("publications.publicationView.disabled"), "disabled"));
    commentsField.append(comments);
    const syncComments = () => {
      const target = targets.find(item => Number(item.chatId) === Number(targetSelect.value));
      commentsField.hidden = !(target?.type === "channel" && target.commentsEnabled);
      comments.disabled = commentsField.hidden;
      commentsField.title = t("publications.publicationView.toDisableCommentsTheBotNeedsPermission");
    };
    targetSelect.onchange = syncComments;
    syncComments();

    const actions = el("div", "format-config-actions");
    const cancel = button(t("core.cardDeleteConfirmation.cancel"), () => dialog.close("cancel"));
    const schedule = button(t("editor.draftListView.postpone"), async () => {
      const scheduledAt = new Date(time.value).getTime();
      if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
        time.setCustomValidity(t("publications.publicationView.specifyAFutureTime"));
        time.reportValidity();
        return;
      }
      time.setCustomValidity("");
      schedule.disabled = cancel.disabled = time.disabled = comments.disabled = true;
      const targetWasDisabled = targetSelect.disabled;
      targetSelect.disabled = true;
      try {
        const targetChatId = Number(targetSelect.value);
        await this.telegramCore.publications.refreshTarget(targetChatId);
        const result = await this.projectPublications.schedulePost(project.id, post.id, targetChatId, {
          scheduledAt,
          commentsEnabled: comments.value !== "disabled"
        });
        this.selectedTargetId = result.target.chatId;
        this.sourceFilter = "project";
        dialog.close("scheduled");
        this.render();
        this.notifications?.show?.({ message: t("publications.publicationView.postponed", { 0: post.title || t("editor.blockInspector.post") }), type: "success" });
      } catch (error) {
        schedule.disabled = cancel.disabled = time.disabled = false;
        targetSelect.disabled = targetWasDisabled;
        syncComments();
        this.notifications?.show?.({ message: t("publications.publicationView.postponedPublication", { 0: error?.message || error }), type: "error", duration: 7000 });
      }
    }, "primary");
    actions.append(cancel, schedule);
    body.append(targetField, timeField, commentsField, actions);
    form.append(head, body);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    time.focus();
  }

  #contentFilterRow(label, options, selected, onSelect) {
    const row = el("div", "publication-content-filter-row");
    row.append(el("span", "publication-content-filter-label", label));
    const chips = el("div", "publication-content-filter-chips");
    for (const [value, title] of options) {
      const chip = button(title, () => onSelect(value), "publication-content-filter-chip");
      chip.classList.toggle("active", selected === value);
      chip.setAttribute("aria-pressed", String(selected === value));
      chips.append(chip);
    }
    row.append(chips);
    return row;
  }

  #dateRangeEditor() {
    const range = el("div", "publication-date-range");
    for (const [key, label] of [["from", t("publications.publicationView.from")], ["to", t("publications.publicationView.to")]]) {
      const field = el("label", "publication-date-field");
      field.append(el("span", "", label));
      const input = document.createElement("input");
      input.type = "date";
      input.value = this.dateRange[key];
      input.onchange = () => { this.dateRange[key] = input.value; };
      field.append(input);
      range.append(field);
    }
    return range;
  }

  #bindingCard() {
    const card = el("div", "publication-binding-card");
    card.append(el("strong", "", t("publications.publicationView.connectionCode")));
    card.append(el("span", "", t("publications.publicationView.sendThisCodeAsAMessageOn")));
    const code = el("code", "", this.session.code);
    const actions = el("div", "publication-binding-actions");
    actions.append(
      button(t("publications.publicationView.copy"), async () => {
        await navigator.clipboard?.writeText?.(this.session.code);
        this.notifications?.show?.({ message: t("publications.publicationView.connectionCodeCopied"), type: "success" });
      }),
      button(t("core.cardDeleteConfirmation.cancel"), () => this.telegramCore.publications.cancelBinding())
    );
    card.append(code, actions);
    return card;
  }

  #targetCard(target) {
    const selected = Number(this.selectedTargetId) === Number(target.chatId);
    const card = el("article", `publication-target-card ${target.status || "unavailable"}${selected ? " selected" : ""}`);
    card.dataset.chatId = String(target.chatId);
    const head = el("div", "publication-target-head");
    head.append(el("strong", "", target.title || String(target.chatId)));
    const badges = el("div", "publication-target-badges");
    badges.append(el("span", "publication-target-kind", target.type === "channel" ? t("publications.publicationView.channel") : t("publications.publicationView.group")));
    if (target.type === "channel") {
      const visibility = target.visibility || (target.username ? "public" : "private");
      badges.append(el(
        "span",
        `publication-target-visibility ${visibility}`,
        visibility === "public" ? t("publications.publicationView.public") : t("publications.publicationView.private")
      ));
    }
    head.append(badges);
    const meta = el("div", "publication-target-meta");
    meta.append(el("span", "", target.status === "ready" ? t("publications.publicationView.botReadyForPublishing") : t("publications.publicationView.unavailable", { 0: target.reason || t("publications.publicationView.noPermissions") })));
    const metrics = el("div", "publication-target-metrics");
    const members = el("span", "publication-target-metric publication-target-members", `👥 ${formatCount(target.memberCount)}`);
    members.title = target.memberCount === null ? t("publications.publicationView.numberOfParticipantsUnknown") : t("publications.publicationView.participants", { 0: target.memberCount });
    members.setAttribute("aria-label", members.title);
    metrics.append(members);
    if (target.type === "channel") {
      const comments = el(
        "span",
        `publication-target-metric publication-target-comments ${target.commentsEnabled ? "connected" : "disconnected"}`,
        "💬"
      );
      comments.title = target.commentsEnabled ? t("publications.publicationView.commentGroupConnected") : t("publications.publicationView.commentGroupNotConnected");
      comments.setAttribute("aria-label", comments.title);
      metrics.append(comments);
      if (target.commentsEnabled) {
        const discussion = el("span", "publication-target-discussion", `↳ ${target.linkedDiscussionTitle || t("publications.publicationView.discussionGroup")}`);
        discussion.title = t("publications.publicationView.linkedDiscussionGroup");
        meta.append(discussion);
      }
    }
    meta.append(metrics);
    const actions = el("div", "publication-target-actions");
    const cleanupEnabled = target.deleteServiceMessages === true;
    const cleanup = button(
      t("publications.publicationView.deleteService"),
      () => this.#toggleServiceMessageCleanup(target),
      `publication-target-cleanup${cleanupEnabled ? " active" : ""}`
    );
    cleanup.setAttribute("aria-pressed", String(cleanupEnabled));
    cleanup.title = cleanupEnabled
      ? t("publications.publicationView.deletingServiceMessagesEnabled")
      : t("publications.publicationView.deletingServiceMessagesDisabled");
    actions.append(cleanup, button(t("publications.publicationView.check"), () => this.#refresh(target.chatId)));
    card.append(head, meta, actions);
    card.onclick = event => {
      if (event.target.closest("button")) return;
      this.selectedTargetId = selected ? null : target.chatId;
      this.render();
    };
    return card;
  }

  async #startBinding() {
    try {
      if (!this.runtime.getStatus().running) await this.runtime.start();
      this.session = await this.telegramCore.publications.startBinding();
      this.render();
    } catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.connection", { 0: error?.message || error }), type: "error" });
    }
  }

  async #refresh(chatId) {
    try { await this.telegramCore.publications.refreshTarget(chatId); }
    catch (error) { this.notifications?.show?.({ message: t("publications.publicationView.check2", { 0: error?.message || error }), type: "error" }); }
  }

  async #toggleServiceMessageCleanup(target) {
    const enabled = target.deleteServiceMessages !== true;
    try {
      await this.telegramCore.publications.setServiceMessageCleanup(target.chatId, enabled);
      this.notifications?.show?.({
        message: enabled ? t("publications.publicationView.deletingServiceMessagesEnabled") : t("publications.publicationView.deletingServiceMessagesDisabled"),
        type: "success"
      });
    } catch (error) {
      this.notifications?.show?.({ message: t("publications.publicationView.serviceMessages", { 0: error?.message || error }), type: "error" });
    }
  }
}

function formatCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? count.toLocaleString(getLocale()) : "—";
}

function reactionEmoji(type = {}) {
  if (type.type === "emoji" && type.emoji) return type.emoji;
  if (type.type === "paid") return "⭐";
  if (type.type === "custom_emoji") return "◆";
  return "•";
}

function reactionTitle(type, count) {
  if (type?.type === "custom_emoji") return t("publications.publicationView.customEmojiCount", { 0: count });
  if (type?.type === "paid") return t("publications.publicationView.paidReactions", { 0: count });
  return t("publications.publicationView.reactions2", { 0: type?.emoji || "", 1: count });
}

function appendDetailData(list, label, value) {
  list.append(el("dt", "", label), el("dd", "", value || "—"));
}

function formatPublicationDate(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime()) || !Number(value)) return "—";
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "short", timeStyle: "short" }).format(date);
}

function datetimeLocalValue(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function countAstBlocks(ast) {
  let count = 0;
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type && node.type !== "document") count += 1;
    for (const child of node.children || []) visit(child);
  };
  visit(ast);
  return count;
}

function reactionTotal(reactions) {
  return (reactions || []).reduce((sum, item) => sum + Number(item?.total_count || 0), 0);
}

function summarizePublication(ast) {
  const lines = [];
  const visit = node => {
    if (!node || typeof node !== "object" || lines.length >= 4) return;
    const props = node.props || {};
    const text = richTextToPlain(props.text ?? props.caption).replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
    else if (["photo", "video", "document"].includes(node.type)) {
      lines.push(node.type === "photo" ? t("app.appNotifications.photo") : node.type === "video" ? t("app.appNotifications.video") : t("project.projectPostCard.document"));
    }
    for (const child of node.children || []) visit(child);
  };
  visit(ast);
  const summary = lines.join("\n").trim();
  return summary || t("publications.publicationView.localCopyOfThePostContentIs");
}

function createLinkTargetButton(target, { targetKey, linkedTargets, onSelect, onOpenLinkedSource }) {
  const state = linkTargetVisualState(target, { targetKey, linkedTargets });
  const action = state === "linked" ? onOpenLinkedSource : onSelect;
  const item = button("↙", () => action?.(target), `publication-record-link-target link-target-button is-${state}`);
  item.dataset.linkTargetState = state;
  item.title = linkTargetTooltip(target, state, linkedTargets);
  item.setAttribute("aria-label", item.title);
  item.setAttribute("aria-pressed", String(state === "selected"));
  return item;
}

function button(text, handler, className = "") {
  const item = el("button", className, text);
  item.type = "button";
  item.onclick = handler;
  return item;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}
