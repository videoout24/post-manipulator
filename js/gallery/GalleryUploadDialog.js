import { t } from "../i18n/index.js?v=1.12.6";
import { isBlobLike } from "../core/FileDrop.js?v=1.12.7";

export function requestGalleryUpload({
  gallery,
  events = null,
  files = [],
  topics = [],
  initialThreadId = null,
  textareaSizing = null,
  dialogId = "editorMediaUploadDialog",
  selectFiles = false,
  autoOpenFilePicker = false,
  accept = ""
} = {}) {
  let selectedFiles = Array.from(files || []).filter(isBlobLike);
  if (!selectedFiles.length && !selectFiles) return Promise.resolve(null);
  const pickerNeeded = Boolean(selectFiles);

  const previous = document.querySelector(`#${dialogId}`);
  if (previous?.open) previous.close();
  previous?.remove();

  const availableTopics = (topics || []).filter(topic => !topic?.telegramDeleted);
  const dialog = document.createElement("dialog");
  dialog.id = dialogId;
  dialog.className = "gallery-upload-dialog editor-media-upload-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  form.innerHTML = `
    <div class="dialog-head"><strong data-upload-title>${t("editor.galleryUploadDialog.title", { 0: selectedFiles.length })}</strong><button type="button" data-upload-close>×</button></div>
    <div class="gallery-upload-body">
      <label class="gallery-upload-field"><span>${t("editor.galleryUploadDialog.topic")}</span>
        <select data-upload-topic>
          ${availableTopics.map(topic => `<option value="${Number(topic.threadId)}">${escapeHtml(topic.name || `Topic ${topic.threadId}`)}</option>`).join("")}
          <option value="__new__">${t("gallery.galleryView.createNewTopic")}</option>
        </select>
      </label>
      <label class="gallery-upload-field" data-upload-new-topic ${availableTopics.length ? "hidden" : ""}><span>${t("gallery.galleryView.newTopicTitle")}</span><input data-upload-topic-name maxlength="128" placeholder="${escapeAttr(t("gallery.galleryView.mediaUploads"))}"></label>
      <label class="gallery-upload-field"><span>${t("gallery.galleryView.captionForEachFile")}</span><textarea data-upload-caption maxlength="1024" rows="1" placeholder="${escapeAttr(t("gallery.galleryView.theSameCaptionWillBeAddedTo"))}"></textarea></label>
      <div class="gallery-upload-file-summary" data-upload-file-summary>${escapeHtml(selectedFiles.length ? fileSummary(selectedFiles) : t("editor.galleryUploadDialog.linuxDropNeedsFileSelection"))}</div>
      <div class="gallery-upload-status" data-upload-status>${selectedFiles.length ? t("editor.galleryUploadDialog.afterUploadResourceWillBeAssigned") : t("editor.galleryUploadDialog.selectFilesToContinue")}</div>
      <input data-upload-files type="file" multiple ${accept ? `accept="${escapeAttr(accept)}"` : ""} hidden>
      <div class="gallery-upload-actions"><button type="button" data-upload-cancel>${t("gallery.galleryView.cancel")}</button><button type="button" data-upload-choose ${pickerNeeded ? "" : "hidden"}>${t("gallery.galleryView.selectFiles")}</button><button class="primary" type="button" data-upload-submit ${selectedFiles.length ? "" : "disabled"}>${t("gallery.galleryView.uploadAction")}</button></div>
    </div>`;
  dialog.append(form);
  document.body.append(dialog);

  const topicSelect = dialog.querySelector("[data-upload-topic]");
  const newTopicField = dialog.querySelector("[data-upload-new-topic]");
  const topicName = dialog.querySelector("[data-upload-topic-name]");
  const caption = dialog.querySelector("[data-upload-caption]");
  const title = dialog.querySelector("[data-upload-title]");
  const summary = dialog.querySelector("[data-upload-file-summary]");
  const fileInput = dialog.querySelector("[data-upload-files]");
  const choose = dialog.querySelector("[data-upload-choose]");
  const submit = dialog.querySelector("[data-upload-submit]");
  const cancel = dialog.querySelector("[data-upload-cancel]");
  const closeButton = dialog.querySelector("[data-upload-close]");
  const status = dialog.querySelector("[data-upload-status]");
  textareaSizing?.attach?.(caption, {
    key: "editor:media-upload-caption",
    defaultRows: 1,
    minRows: 1
  });
  if (!availableTopics.length) topicSelect.value = "__new__";
  else if (availableTopics.some(topic => Number(topic.threadId) === Number(initialThreadId))) {
    topicSelect.value = String(Number(initialThreadId));
  }
  const syncTopicMode = () => { newTopicField.hidden = topicSelect.value !== "__new__"; };
  topicSelect.addEventListener("change", syncTopicMode);
  syncTopicMode();

  const showSelectedFiles = () => {
    title.textContent = t("editor.galleryUploadDialog.title", { 0: selectedFiles.length });
    summary.textContent = selectedFiles.length
      ? fileSummary(selectedFiles)
      : t("editor.galleryUploadDialog.linuxDropNeedsFileSelection");
    status.textContent = selectedFiles.length
      ? t("editor.galleryUploadDialog.afterUploadResourceWillBeAssigned")
      : t("editor.galleryUploadDialog.selectFilesToContinue");
    status.classList.remove("error");
    submit.disabled = selectedFiles.length === 0;
  };
  choose.addEventListener("click", () => {
    fileInput.value = "";
    try { fileInput.click(); } catch {}
  });
  fileInput.addEventListener("change", () => {
    const nextFiles = Array.from(fileInput.files || []).filter(isBlobLike);
    if (!nextFiles.length) return;
    selectedFiles = nextFiles;
    choose.hidden = false;
    showSelectedFiles();
  });

  return new Promise(resolve => {
    let settled = false;
    let uploading = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (dialog.open) dialog.close();
      else dialog.remove();
    };
    const close = () => { if (!uploading) finish(null); };
    closeButton.addEventListener("click", close);
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      if (!uploading) finish(null);
    });
    const offProgress = events?.on?.("gallery:upload-progress", progress => {
      if (!dialog.isConnected || progress?.state !== "uploading") return;
      status.textContent = t("gallery.galleryView.uploading", { 0: progress.current, 1: progress.total, 2: progress.fileName });
    });
    dialog.addEventListener("close", () => {
      offProgress?.();
      dialog.remove();
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, { once: true });
    submit.addEventListener("click", async () => {
      if (!selectedFiles.length) {
        showSelectedFiles();
        return;
      }
      const createNew = topicSelect.value === "__new__";
      if (createNew && !topicName.value.trim()) {
        status.textContent = t("gallery.galleryView.enterNewTopicTitle");
        status.classList.add("error");
        topicName.focus();
        return;
      }
      status.classList.remove("error");
      uploading = true;
      for (const control of [submit, choose, fileInput, cancel, closeButton, topicSelect, topicName, caption]) control.disabled = true;
      let threadId = Number(topicSelect.value || 0);
      try {
        if (createNew) {
          status.textContent = t("gallery.galleryView.creatingTopic");
          const topic = await gallery.createTopic(topicName.value.trim());
          threadId = Number(topic.threadId);
          const option = document.createElement("option");
          option.value = String(threadId);
          option.textContent = topic.name || topicName.value.trim() || `Topic ${threadId}`;
          topicSelect.insertBefore(option, topicSelect.querySelector('option[value="__new__"]'));
          topicSelect.value = String(threadId);
          syncTopicMode();
        }
        const result = await gallery.uploadFiles(selectedFiles, { threadId, caption: caption.value });
        finish({ ...result, threadId, caption: caption.value, partialError: null });
      } catch (error) {
        if (error?.uploadResult?.assets?.length) {
          finish({ ...error.uploadResult, threadId, caption: caption.value, partialError: error });
          return;
        }
        uploading = false;
        for (const control of [choose, fileInput, cancel, closeButton, topicSelect, topicName, caption]) control.disabled = false;
        submit.disabled = selectedFiles.length === 0;
        status.textContent = error?.message || String(error);
        status.classList.add("error");
      }
    });
    dialog.showModal();
    if (pickerNeeded && autoOpenFilePicker) {
      queueMicrotask(() => {
        try { fileInput.click(); } catch {}
      });
    }
  });
}

function fileSummary(files) {
  const names = files.slice(0, 3).map(file => file.name || t("app.appNotifications.resource"));
  const remainder = files.length - names.length;
  return remainder > 0 ? `${names.join(", ")} +${remainder}` : names.join(", ");
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
