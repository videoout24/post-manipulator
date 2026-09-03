import { t } from "../i18n/index.js?v=1.8.2";
import { richTextToPlain } from "../core/RichText.js?v=1.5.9";
import { showCardDeleteConfirmation } from "../core/CardDeleteConfirmation.js?v=1.5.9";

export class TreeView {
  constructor({ root, tree, registry, validator = null, controller, dragState = null, mediaBinder = null, gallery = null, thumbnails = null, inlineInspector = null, onCollapseChange = null, autoCollapseInactive = false }) {
    this.root = root;
    this.tree = tree;
    this.registry = registry;
    this.validator = validator;
    this.controller = controller;
    this.mediaBinder = mediaBinder;
    this.gallery = gallery;
    this.thumbnails = thumbnails;
    this.inlineInspector = inlineInspector;
    this.onCollapseChange = onCollapseChange;
    this.autoCollapseInactive = Boolean(autoCollapseInactive);
    this.dragState = dragState || { nodeId: "", type: "", source: "", galleryAssetId: "", galleryType: "" };
    this.renderGeneration = 0;
    // Canvas-only collapse state. It is deliberately not stored in the Rich Message AST.
    this.collapsedNodes = new Set();
    this.installExternalDeleteDnD();
  }

  render() {
    const nodeIds = new Set(this.#canvasNodeIds());
    for (const id of this.collapsedNodes) if (!nodeIds.has(id)) this.collapsedNodes.delete(id);
    const generation = ++this.renderGeneration;
    this.invalidNodeIds = this.validator?.invalidNodeIds?.(this.tree) || new Set();
    this.root.innerHTML = "";
    const container = document.createElement("div");
    container.className = "drop-root";
    this.renderChildren(container, this.tree.root, generation);

    // Free canvas space appends to the document root.
    container.ondragover = e => {
      const childType = this.draggedType(e);
      const movingId = this.draggedNodeId(e);
      if (!childType || !this.controller.canAccept("root", childType, movingId)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = movingId ? "move" : "copy";
      container.classList.add("drag-root");
    };
    container.ondragleave = e => {
      if (!container.contains(e.relatedTarget)) container.classList.remove("drag-root");
    };
    container.ondrop = e => {
      e.preventDefault();
      container.classList.remove("drag-root");
      this.drop(e, "root", Infinity);
    };

    this.root.append(container);
    this.onCollapseChange?.(this.collapseState());
  }

  renderDocumentContextPlaceholder() {
    this.renderGeneration += 1;
    this.invalidNodeIds = new Set();
    this.collapsedNodes.clear();
    this.root.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "canvas-document-context-empty";
    const title = document.createElement("strong");
    title.textContent = t("editor.treeView.openADraftOrProject");
    const hint = document.createElement("span");
    hint.textContent = t("editor.treeView.selectADraftOnTheRightOr");
    empty.append(title, hint);
    this.root.append(empty);
    this.onCollapseChange?.({ total: 0, collapsed: 0, allCollapsed: false });
  }

  updateSelection() {
    for (const el of this.root.querySelectorAll(".block[data-node-id]")) {
      el.classList.toggle("selected", this.controller.selection.has(el.dataset.nodeId));
    }
  }

  updateValidation() {
    this.invalidNodeIds = this.validator?.invalidNodeIds?.(this.tree) || new Set();
    for (const el of this.root.querySelectorAll(".block[data-node-id]")) {
      el.classList.toggle("validation-invalid", this.invalidNodeIds.has(String(el.dataset.nodeId)));
    }
  }

  renderChildren(parentEl, parentNode, generation = this.renderGeneration) {
    const children = parentNode.children || [];

    children.forEach((node, index) => {
      parentEl.append(this.makeDropZone(parentNode.id, index));

      const el = document.createElement("div");
      el.className = "block"
        + (this.controller.selection.has(node.id) ? " selected" : "")
        + (this.invalidNodeIds.has(String(node.id)) ? " validation-invalid" : "");
      el.dataset.nodeId = node.id;
      el.onclick = e => {
        e.stopPropagation();
        const additive = e.ctrlKey || e.metaKey;
        if (additive || !this.controller.selection.has(node.id)) this.controller.select(node.id, additive);
        // Keep the active card visible while browsing the Canvas. Form controls retain
        // their native focus behaviour and Cmd/Ctrl-click remains multi-selection.
        // Native <summary> controls the disclosure state of every collapsible
        // property section. It must not trigger a Canvas focus/re-render, or the
        // browser toggles a detached <details> element and the section appears
        // unable to collapse.
        const isFormControl = e.target.closest("input, textarea, select, button, summary, [contenteditable='true'], [contenteditable='plaintext-only']");
        if (this.autoCollapseInactive && !additive && !isFormControl) this.focusNode(node.id);
      };
      el.ondblclick = e => {
        if (e.target.closest("input, textarea, select, button, [contenteditable='true'], [contenteditable='plaintext-only']")) return;
        e.preventDefault();
        e.stopPropagation();
        this.toggleCollapsed(node.id);
      };

      const head = document.createElement("div");
      head.className = "block-head drag-handle";
      const structureLocked = Boolean(this.controller.mutationError?.("move", { nodeId: node.id, node }));
      head.draggable = !structureLocked;
      head.title = structureLocked
        ? t("editor.treeView.structuralProjectBlockIsPinned")
        : t("editor.treeView.dragTheBlockToSortNestOr");
      head.ondragstart = e => {
        e.stopPropagation();
        this.dragState.nodeId = node.id;
        this.dragState.type = node.type;
        this.dragState.source = "canvas";
        document.body.classList.add("dragging-block");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-block-node-id", node.id);
        e.dataTransfer.setData("application/x-block-type", node.type);
        requestAnimationFrame(() => el.classList.add("dragging"));
      };
      head.ondragend = () => {
        el.classList.remove("dragging");
        this.finishDrag();
      };

      const titleWrap = document.createElement("span");
      titleWrap.className = "block-title";

      const name = document.createElement("span");
      const def = this.registry.get(node.type);
      name.textContent = ["block_quotation", "expandable_block_quotation", "pull_quotation"].includes(node.type)
        ? "Quotation"
        : ["collage", "slideshow"].includes(node.type)
          ? "Collage / Slideshow"
          : (def?.name || node.type);
      titleWrap.append(name);
      const typeSwitch = this.makeTypeSwitch(node);
      if (typeSwitch) titleWrap.append(typeSwitch);
      if (def?.kind === "meta") {
        const badge = document.createElement("span");
        badge.className = "meta-badge";
        badge.textContent = "META";
        titleWrap.append(badge);
      }

      const actions = document.createElement("div");
      actions.className = "block-actions";
      const spoiler = this.makeHeaderSpoiler(node);
      if (spoiler) actions.append(spoiler);
      const collapse = document.createElement("button");
      const isUiCollapsed = this.collapsedNodes.has(node.id);
      collapse.className = "canvas-collapse-toggle";
      collapse.textContent = isUiCollapsed ? "▸" : "▾";
      collapse.title = isUiCollapsed ? t("editor.treeView.expandBlockOnCanvas") : t("editor.treeView.collapseBlockOnCanvas");
      collapse.draggable = false;
      collapse.onclick = e => {
        e.stopPropagation();
        this.toggleCollapsed(node.id);
      };
      const info = document.createElement("button");
      info.textContent = "ⓘ";
      info.title = t("editor.treeView.blockServiceInformation");
      info.draggable = false;
      info.onclick = e => {
        e.stopPropagation();
        const current = el.querySelector(":scope > .block-info-popover");
        if (current) current.remove();
        else el.append(this.makeInfoPopover(node));
      };
      const duplicate = document.createElement("button");
      duplicate.textContent = "⧉";
      duplicate.title = t("editor.treeView.duplicateBlock");
      duplicate.draggable = false;
      duplicate.onclick = e => {
        e.stopPropagation();
        if (!this.controller.selection.has(node.id) || this.controller.selection.size() !== 1) this.controller.select(node.id);
        this.controller.duplicateSelected();
      };
      const up = document.createElement("button");
      up.textContent = "↑";
      up.title = t("editor.treeView.above");
      up.draggable = false;
      up.onclick = e => { e.stopPropagation(); this.move(node.id, -1); };
      const down = document.createElement("button");
      down.textContent = "↓";
      down.title = t("editor.treeView.below");
      down.draggable = false;
      down.onclick = e => { e.stopPropagation(); this.move(node.id, 1); };
      const remove = document.createElement("button");
      remove.textContent = "🗑";
      remove.title = t("editor.treeView.deleteBlock");
      remove.className = "block-remove-button";
      remove.draggable = false;
      remove.onclick = e => { e.stopPropagation(); this.requestDeleteBlock(node.id); };
      actions.append(collapse, info);
      if (!this.controller.mutationError?.("duplicate", { nodeId: node.id, node })) actions.append(duplicate);
      if (!structureLocked) actions.append(up, down);
      if (!this.controller.mutationError?.("remove", { nodeId: node.id, node })) actions.append(remove);
      head.append(titleWrap, actions);
      el.append(head);

      if (isUiCollapsed) {
        el.classList.add("canvas-block-collapsed");
        el.append(this.makeCollapsedSummary(node));
      } else {
        const bindings = this.registry.propertyBindings(def);
        const needsVisualPreview = this.mediaBinder?.supports(node) || this.mediaBinder?.isCollection(node) || !bindings.length;
        if (needsVisualPreview) el.append(this.makePreviewElement(node, generation));
        if (bindings.length && this.inlineInspector) {
          el.append(this.inlineInspector.renderInline(node));
        }
        if (node.children?.length) {
          const nested = document.createElement("div");
          nested.className = "children";
          this.renderChildren(nested, node, generation);
          el.append(nested);
        } else if (this.canHaveChildren(node)) {
          const emptyNested = document.createElement("div");
          emptyNested.className = "empty-children-drop";
          emptyNested.textContent = t("editor.treeView.dragBlockHere");
          this.attachExplicitInsideDrop(emptyNested, node);
          el.append(emptyNested);
        }
      }

      // Direct block drops use cursor position:
      // upper/lower edge = insert before/after, center = nest when allowed.
      el.ondragover = e => {
        e.stopPropagation();
        const galleryType = this.draggedGalleryType(e);
        if (galleryType) {
          if (this.collapsedNodes.has(node.id) || !this.mediaBinder?.accepts(node, galleryType)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          this.clearPositionClasses();
          el.classList.add("drag-media");
          return;
        }
        const target = this.blockDropTarget(e, node, parentNode.id, index);
        if (!target) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = this.draggedNodeId(e) ? "move" : "copy";
        this.clearPositionClasses();
        el.classList.add(target.mode === "inside" ? "drag-inside" : target.mode === "before" ? "drag-before" : "drag-after");
      };
      el.ondragleave = e => {
        if (!el.contains(e.relatedTarget)) {
          el.classList.remove("drag-inside", "drag-before", "drag-after", "drag-media");
        }
      };
      el.ondrop = async e => {
        e.stopPropagation();
        const galleryAssetId = this.draggedGalleryAssetId(e);
        const galleryType = this.draggedGalleryType(e);
        if (galleryAssetId && galleryType) {
          if (this.collapsedNodes.has(node.id) || !this.mediaBinder?.accepts(node, galleryType)) return;
          e.preventDefault();
          el.classList.remove("drag-media");
          try {
            await this.mediaBinder.assign(node.id, galleryAssetId);
          } catch (error) {
            this.controller.reportError(error?.message || String(error));
          }
          return;
        }
        e.preventDefault();
        const target = this.blockDropTarget(e, node, parentNode.id, index);
        el.classList.remove("drag-inside", "drag-before", "drag-after");
        if (!target) return;
        this.drop(e, target.parentId, target.index);
      };

      parentEl.append(el);
    });

    parentEl.append(this.makeDropZone(parentNode.id, children.length, true));
  }

  requestDeleteBlock(nodeId) {
    const node = this.tree.find(nodeId);
    const total = countSubtree(node);
    this.collapsedNodes.add(nodeId);
    this.render();
    const card = this.root.querySelector(`.block[data-node-id="${CSS.escape(String(nodeId))}"]`);
    showCardDeleteConfirmation(card, {
      message: total > 1
        ? t("editor.treeView.deleteBlockAndInsideTotalToBe", { 0: total - 1, 1: pluralBlocks(total - 1), 2: total })
        : t("editor.treeView.deleteThisBlock"),
      onConfirm: () => this.controller.removeBlock(nodeId)
    });
  }

  canHaveChildren(node) {
    if (node.id === "root") return true;
    return this.registry.get(node.type)?.children?.allowed !== false;
  }

  makeCollapsedSummary(node) {
    const wrap = document.createElement("div");
    wrap.className = "canvas-collapsed-summary";

    const main = document.createElement("span");
    main.className = "canvas-collapsed-main";
    const text = this.preview(node);
    main.textContent = text && text !== node.type ? text : t("editor.treeView.contentHiddenOnCanvas");
    wrap.append(main);

    const counts = this.descendantTypeCounts(node);
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (total) {
      const meta = document.createElement("div");
      meta.className = "canvas-collapsed-meta";
      const count = document.createElement("span");
      count.className = "details-child-count";
      count.textContent = `${total} ${this.blockWord(total)}`;
      meta.append(count);
      const icons = document.createElement("div");
      icons.className = "details-icons";
      for (const [type, amount] of counts) {
        const badge = document.createElement("span");
        badge.className = "details-icon-badge";
        badge.textContent = `${this.iconFor(type)} ${amount}`;
        badge.title = `${this.registry.get(type)?.name || type}: ${amount}`;
        icons.append(badge);
      }
      meta.append(icons);
      wrap.append(meta);
    }

    return wrap;
  }

  toggleCollapsed(nodeId) {
    if (this.collapsedNodes.has(nodeId)) this.collapsedNodes.delete(nodeId);
    else this.collapsedNodes.add(nodeId);
    this.render();
  }

  focusNode(nodeId) {
    const expandedPath = new Set();
    let current = this.tree?.find?.(nodeId);
    while (current?.id && current.id !== "root") {
      expandedPath.add(String(current.id));
      current = this.tree?.parentOf?.(current.id);
    }
    this.collapsedNodes = new Set(this.#canvasNodeIds().filter(id => !expandedPath.has(id)));
    this.render();
  }

  setAutoCollapseInactive(enabled) {
    const next = Boolean(enabled);
    const changed = this.autoCollapseInactive !== next;
    this.autoCollapseInactive = next;
    const selectedId = this.controller?.selectedId ?? this.controller?.selection?.primary?.();
    if (changed && next && selectedId) this.focusNode(selectedId);
  }

  collapseAll() {
    this.collapsedNodes = new Set(this.#canvasNodeIds());
    this.render();
  }

  expandAll() {
    this.collapsedNodes.clear();
    this.render();
  }

  collapseState() {
    const ids = this.#canvasNodeIds();
    const collapsed = ids.filter(id => this.collapsedNodes.has(id)).length;
    return { total: ids.length, collapsed, allCollapsed: ids.length > 0 && collapsed === ids.length };
  }

  #canvasNodeIds() {
    const ids = [];
    this.tree?.walk?.(node => { if (node?.id && node.id !== "root") ids.push(String(node.id)); });
    return ids;
  }

  attachExplicitInsideDrop(element, node) {
    element.ondragover = e => {
      if (this.collapsedNodes.has(node.id)) return;
      e.stopPropagation();
      const galleryType = this.draggedGalleryType(e);
      if (galleryType && this.mediaBinder?.accepts(node, galleryType)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        element.classList.add("active", "drag-media");
        return;
      }

      const childType = this.draggedType(e);
      const movingId = this.draggedNodeId(e);
      if (!childType || !this.controller.canAccept(node.id, childType, movingId)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = movingId ? "move" : "copy";
      element.classList.add("active");
    };
    element.ondragleave = e => {
      if (!element.contains(e.relatedTarget)) element.classList.remove("active", "drag-media");
    };
    element.ondrop = async e => {
      if (this.collapsedNodes.has(node.id)) return;
      e.stopPropagation();
      const galleryAssetId = this.draggedGalleryAssetId(e);
      const galleryType = this.draggedGalleryType(e);
      if (galleryAssetId && galleryType && this.mediaBinder?.accepts(node, galleryType)) {
        e.preventDefault();
        element.classList.remove("active", "drag-media");
        try {
          await this.mediaBinder.assign(node.id, galleryAssetId);
        } catch (error) {
          this.controller.reportError(error?.message || String(error));
        }
        return;
      }

      e.preventDefault();
      element.classList.remove("active", "drag-media");
      this.drop(e, node.id, Infinity);
    };
  }

  blockDropTarget(e, node, parentId, index) {
    const childType = this.draggedType(e);
    const movingId = this.draggedNodeId(e);
    if (!childType) return null;

    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
    // A collapsed Canvas block is a safe sorting target: before/after only.
    // Nesting is available again only after an explicit expand click.
    const canNest = !this.collapsedNodes.has(node.id) && this.controller.canAccept(node.id, childType, movingId);
    const canSibling = this.controller.canAccept(parentId, childType, movingId);

    if (canNest && ratio >= 0.28 && ratio <= 0.72) {
      return { parentId: node.id, index: Infinity, mode: "inside" };
    }
    if (!canSibling) return canNest ? { parentId: node.id, index: Infinity, mode: "inside" } : null;
    if (ratio < 0.5) return { parentId, index, mode: "before" };
    return { parentId, index: index + 1, mode: "after" };
  }

  makeDropZone(parentId, index, isLast = false) {
    const zone = document.createElement("div");
    zone.className = "drop-zone" + (isLast ? " drop-zone-last" : "");
    zone.title = t("editor.treeView.pasteBlockExactlyInThisPosition");

    zone.ondragover = e => {
      e.stopPropagation();
      const childType = this.draggedType(e);
      const movingId = this.draggedNodeId(e);
      if (!childType || !this.controller.canAccept(parentId, childType, movingId)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = movingId ? "move" : "copy";
      this.clearPositionClasses();
      zone.classList.add("active");
    };
    zone.ondragleave = () => zone.classList.remove("active");
    zone.ondrop = e => {
      e.stopPropagation();
      e.preventDefault();
      zone.classList.remove("active");
      this.drop(e, parentId, index);
    };
    return zone;
  }

  makeTypeSwitch(node) {
    let options = null;
    if (["block_quotation", "expandable_block_quotation", "pull_quotation"].includes(node.type)) {
      options = [["block_quotation", t("editor.treeView.normal")], ["expandable_block_quotation", t("editor.treeView.collapsible")], ["pull_quotation", t("blocks.registerCoreBlocks.pullQuotation")]];
    } else if (["collage", "slideshow"].includes(node.type)) {
      options = [["collage", t("blocks.registerCoreBlocks.collage")], ["slideshow", t("blocks.registerCoreBlocks.slideshow")]];
    }
    if (!options) return null;
    const select = document.createElement("select");
    select.className = "block-type-switch";
    select.title = t("editor.treeView.typeTelegramRichBlock");
    select.draggable = false;
    for (const [value, label] of options) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; select.append(option);
    }
    select.value = node.type;
    select.onclick = e => e.stopPropagation();
    select.onmousedown = e => e.stopPropagation();
    select.onchange = e => {
      e.stopPropagation();
      this.controller.changeNodeType(node.id, select.value);
    };
    return select;
  }

  makeHeaderSpoiler(node) {
    if (!["photo", "video", "animation"].includes(node.type)) return null;
    const def = this.registry.get(node.type);
    if (!this.registry.propertyBindings(def).some(binding => binding.property === "media.hasSpoiler")) return null;
    const label = document.createElement("label");
    label.className = "block-header-check";
    label.title = t("core.formattingRegistry.spoiler");
    label.onclick = e => e.stopPropagation();
    label.onmousedown = e => e.stopPropagation();
    const input = document.createElement("input");
    input.type = "checkbox"; input.checked = !!node.props?.hasSpoiler; input.draggable = false;
    input.onchange = e => {
      e.stopPropagation();
      this.controller.updateNodeProperty(node.id, "hasSpoiler", input.checked, { inspectorSource: true });
    };
    const text = document.createElement("span"); text.textContent = t("core.formattingRegistry.spoiler");
    label.append(input, text);
    return label;
  }

  makeInfoPopover(node) {
    const pop = document.createElement("div");
    pop.className = "block-info-popover";
    pop.onclick = e => e.stopPropagation();

    const title = document.createElement("div");
    title.className = "block-info-title";
    title.textContent = t("editor.treeView.serviceData");
    pop.append(title);

    const rows = [
      ["type", node.type],
      ["nodeId", node.id],
      ["galleryId", node.props?.galleryId],
      ["Telegram file_id", node.props?.fileId]
    ].filter(([, value]) => value !== undefined && value !== null && String(value) !== "");

    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "block-info-row";
      const key = document.createElement("span");
      key.textContent = label;
      const code = document.createElement("code");
      code.textContent = String(value);
      code.title = t("editor.treeView.clickToCopy");
      code.onclick = async e => {
        e.stopPropagation();
        try { await navigator.clipboard?.writeText?.(String(value)); } catch {}
      };
      row.append(key, code);
      pop.append(row);
    }
    return pop;
  }

  makePreviewElement(node, generation) {
    if (this.mediaBinder?.isCollection(node)) {
      const wrap = document.createElement("div");
      wrap.className = "block-preview media-collection-preview";
      const children = node.children || [];
      const photos = children.filter(child => child.type === "photo").length;
      const videos = children.filter(child => child.type === "video").length;
      const parts = [];
      if (photos) parts.push(t("editor.treeView.photo", { 0: photos }));
      if (videos) parts.push(t("editor.treeView.video", { 0: videos }));
      wrap.innerHTML = `<div class="media-collection-icon">${this.iconFor(node.type)}</div><div class="media-block-info"><strong>${children.length ? `${children.length} media` : t("editor.treeView.empty")}</strong><span>${escapeText(parts.join(" · ") || t("editor.treeView.dragPhotoVideoFromGallery"))}</span></div>`;
      return wrap;
    }
    if (this.mediaBinder?.supports(node)) {
      const wrap = document.createElement("div");
      wrap.className = "block-preview media-block-preview";
      const galleryId = node.props?.galleryId;
      if (!galleryId) {
        wrap.innerHTML = t("editor.treeView.selectAResourceOnTheLeftOr", { 0: this.iconFor(node.type) });
        return wrap;
      }
      wrap.innerHTML = `<div class="media-block-thumb"><span>${this.iconFor(node.type)}</span></div><div class="media-block-info"><strong>Gallery</strong><span>${escapeText(galleryId)}</span></div>`;
      this.hydrateMediaPreview(wrap, node, generation);
      return wrap;
    }
    const preview = document.createElement("div");
    preview.className = "block-preview";
    preview.textContent = this.preview(node);
    return preview;
  }

  async hydrateMediaPreview(wrap, node, generation) {
    try {
      const asset = await this.gallery?.getAsset?.(node.props?.galleryId);
      if (!asset || generation !== this.renderGeneration || !wrap.isConnected) return;
      const info = wrap.querySelector(".media-block-info");
      if (info) {
        const title = asset.caption || asset.fileName || this.registry.get(node.type)?.name || node.type;
        info.innerHTML = `<strong>${escapeText(title)}</strong><span>${escapeText(asset.fileName || asset.mimeType || asset.type)}</span>`;
      }
      const thumb = wrap.querySelector(".media-block-thumb");
      if (thumb && asset.telegram?.thumbnailFileId && this.thumbnails) {
        const url = await this.thumbnails.getUrl(asset);
        if (!url || generation !== this.renderGeneration || !wrap.isConnected) return;
        const img = document.createElement("img");
        img.alt = asset.caption || asset.fileName || asset.type;
        img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
        img.addEventListener("error", async () => {
          if (img.dataset.retry === "1") return;
          img.dataset.retry = "1";
          try { const fresh = await this.thumbnails.getUrl(asset, { forceRefresh: true }); if (fresh) img.src = fresh; } catch {}
        });
        img.src = url;
        thumb.replaceChildren(img);
      }
    } catch (error) {
      console.warn("Canvas media preview failed", error);
    }
  }

  preview(node) {
    const p = node.props || {};
    if (node.type === "details") return richTextToPlain(p.summary) || t("blocks.registerCoreBlocks.details");
    if (node.type === "anchor") {
      let links = 0;
      this.tree.walk(candidate => { if (candidate.type === "anchor_link" && candidate.props?.targetAnchorId === node.id) links += 1; });
      return `⚓ ${p.name || "anchor"}${links ? t("editor.treeView.links", { 0: links }) : ""}`;
    }
    if (node.type === "date_time") return p.dateTime ? `🕒 ${p.dateTime} · ${p.dateTimeFormat || "DT"}` : "Date / Time";
    if (node.type === "phone") return `☎ ${p.text || p.phoneNumber || "Phone"}`;
    if (node.type === "email") return `✉ ${p.text || p.email || "Email"}`;
    if (node.type === "hashtag") return String(p.hashtag || "#hashtag");
    if (node.type === "text_link") return `🔗 ${p.text || p.url || t("blocks.registerCoreBlocks.textLink")}`;
    if (node.type === "anchor_link") {
      const anchor = p.targetAnchorId ? this.tree.find(p.targetAnchorId) : null;
      return `⚓→ ${p.text || t("blocks.registerCoreBlocks.go")} → ${anchor?.props?.name || (p.targetAnchorId ? t("editor.treeView.deleted") : t("editor.treeView.top"))}`;
    }
    if (node.type === "button_row") return `▣ ${t("blocks.registerCoreBlocks.buttonRow")} · ${(node.children || []).length}/8`;
    if (node.type === "url_button") return `▣ ${p.text || t("blocks.registerCoreBlocks.open")} → ${p.url || "URL"}`;
    if (p.text) return richTextToPlain(p.text).slice(0, 180);
    if (p.summary) return richTextToPlain(p.summary);
    if (p.url) return p.url;
    if (p.caption) return richTextToPlain(p.caption).slice(0, 180);
    if (p.expression) return p.expression;
    return node.type;
  }

  move(id, delta) {
    const node = this.tree.find(id);
    const parent = this.tree.parentOf(id);
    if (!node || !parent) return;
    const i = parent.children.findIndex(n => n.id === id);
    const ni = i + delta;
    if (ni < 0 || ni >= parent.children.length) return;
    [parent.children[i], parent.children[ni]] = [parent.children[ni], parent.children[i]];
    this.controller.select(id);
    this.controller.events.emit("tree:changed");
  }

  drop(e, parentId, index = Infinity) {
    const nodeId = this.draggedNodeId(e);
    if (nodeId) {
      this.controller.moveBlock(nodeId, parentId, index);
      this.finishDrag();
      return;
    }

    const type = this.draggedType(e);
    if (type) this.controller.addBlock(type, parentId, index);
  }

  draggedGalleryAssetId(e) {
    return e.dataTransfer?.getData("application/x-gallery-asset-id") || this.dragState.galleryAssetId || "";
  }

  draggedGalleryType(e) {
    return e.dataTransfer?.getData("application/x-gallery-asset-type") || this.dragState.galleryType || "";
  }

  draggedNodeId(e) {
    return e.dataTransfer?.getData("application/x-block-node-id") || this.dragState.nodeId || "";
  }

  draggedType(e) {
    return e.dataTransfer?.getData("application/x-block-type") || this.dragState.type || "";
  }

  descendantTypeCounts(node) {
    const counts = new Map();
    const walk = current => {
      for (const child of current.children || []) {
        counts.set(child.type, (counts.get(child.type) || 0) + 1);
        walk(child);
      }
    };
    walk(node);
    return counts;
  }

  iconFor(type) {
    const icons = {
      paragraph: "¶",
      heading: "H",
      preformatted: "⌨",
      footer: "↳",
      divider: "—",
      mathematical_expression: "∑",
      anchor: "⚓",
      date_time: "🕒",
      phone: "☎",
      email: "✉",
      hashtag: "#",
      text_link: "🔗",
      anchor_link: "⚓→",
      button_row: "▣",
      url_button: "▣",
      list: "☷",
      block_quotation: "❝",
      expandable_block_quotation: "❯",
      pull_quotation: "❞",
      collage: "▦",
      slideshow: "▣",
      table: "▤",
      details: "▸",
      map: "⌖",
      animation: "▶",
      audio: "♪",
      document: "▤",
      photo: "▧",
      video: "▷",
      voice_note: "◉",
      thinking: "…"
    };
    return icons[type] || "◆";
  }

  blockWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return t("editor.metaBlockDialog.block");
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t("editor.metaBlockDialog.ofBlock");
    return t("editor.metaBlockDialog.blocks");
  }

  installExternalDeleteDnD() {
    document.addEventListener("dragover", e => {
      if (!this.dragState.nodeId || this.dragState.source !== "canvas") return;
      const outside = !this.root.contains(e.target);
      document.body.classList.toggle("drag-delete-active", outside);
      if (outside) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    }, true);

    document.addEventListener("drop", e => {
      if (!this.dragState.nodeId || this.dragState.source !== "canvas") return;
      if (this.root.contains(e.target)) return;

      const nodeId = this.dragState.nodeId;
      e.preventDefault();
      e.stopPropagation();
      this.controller.removeBlock(nodeId);
      this.finishDrag();
    }, true);

    document.addEventListener("dragend", () => {
      if (this.dragState.source === "canvas") this.finishDrag();
    }, true);
  }

  finishDrag() {
    this.clearDragClasses();
    document.body.classList.remove("dragging-block", "drag-delete-active");
    if (this.dragState.source === "canvas") {
      this.dragState.nodeId = "";
      this.dragState.type = "";
      this.dragState.source = "";
    }
  }

  clearPositionClasses() {
    this.root.querySelectorAll(".drag-inside, .drag-before, .drag-after, .drag-media, .drop-zone.active").forEach(el =>
      el.classList.remove("drag-inside", "drag-before", "drag-after", "drag-media", "active")
    );
  }

  clearDragClasses() {
    this.root.querySelectorAll(".dragging, .drag-inside, .drag-before, .drag-after, .drag-media, .drop-zone.active, .drag-root, .details-collapsed-summary.active, .empty-children-drop.active").forEach(el =>
      el.classList.remove("dragging", "drag-inside", "drag-before", "drag-after", "drag-media", "active", "drag-root")
    );
  }
}

function countSubtree(node) {
  return node ? 1 + (node.children || []).reduce((total, child) => total + countSubtree(child), 0) : 0;
}

function pluralBlocks(count) {
  const value = Math.abs(Number(count) || 0) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return t("editor.treeView.nestedBlocks");
  if (last === 1) return t("editor.treeView.nestedBlock");
  if (last > 1 && last < 5) return t("editor.treeView.nestedBlocks2");
  return t("editor.treeView.nestedBlocks");
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
