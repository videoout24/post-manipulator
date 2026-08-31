import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const library = await readFile(new URL('../js/project/ProjectLibraryView.js', import.meta.url), 'utf8');
const telegramControls = await readFile(new URL('../js/editor/EditorTelegramControls.js', import.meta.url), 'utf8');
const rightPanel = await readFile(new URL('../js/editor/EditorRightPanel.js', import.meta.url), 'utf8');
const postList = await readFile(new URL('../js/editor/ProjectPostListView.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

assert.doesNotMatch(html, /id="editorAutoTelegram"/);
assert.match(html, /id="editorOpenTelegram"/);
assert.match(html, /id="editorToggleAllBlocks"/);
assert.doesNotMatch(telegramControls, /confirm\(`Удалить Telegram-выгрузку/);
assert.doesNotMatch(rightPanel, /confirm\(`Удалить пост/);
assert.doesNotMatch(rightPanel, /prompt\("Название поста"/);
assert.match(postList, /Закрыть проект/);
assert.match(postList, /project-post-rename-editor/);
assert.doesNotMatch(postList, /\+ Пост/);
assert.doesNotMatch(postList, /showCardDeleteConfirmation/);
assert.doesNotMatch(rightPanel, /#createPost|#deletePost/);
assert.match(html, /id="editorProjectDeployment"/);
assert.match(html, /class="canvas-context-bar"/);
assert.doesNotMatch(library, /Выгрузить в предпросмотр|Обновить предпросмотр|Удалить из предпросмотра/);
assert.doesNotMatch(library, /previewSync\.sync/);
assert.doesNotMatch(app, /reason === "restored"[\s\S]{0,600}projectPreviewSync\.sync/);
assert.doesNotMatch(app, /beforeOpenPost|beforeOpenProject|editorAutoOpenTelegram/);
assert.match(app, /setBeforeOpenProject\([\s\S]*reason !== "project-opened"[\s\S]*clearAllDeployments/);
console.log('editor_project_ui_contract_smoke: OK');
