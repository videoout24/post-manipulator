import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const library = await readFile(new URL('../js/project/ProjectLibraryView.js', import.meta.url), 'utf8');
const telegramControls = await readFile(new URL('../js/editor/EditorTelegramControls.js', import.meta.url), 'utf8');
const rightPanel = await readFile(new URL('../js/editor/EditorRightPanel.js', import.meta.url), 'utf8');
const draftList = await readFile(new URL('../js/editor/DraftListView.js', import.meta.url), 'utf8');
const postList = await readFile(new URL('../js/editor/ProjectPostListView.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

assert.doesNotMatch(html, /id="editorAutoTelegram"/);
assert.match(html, /id="editorOpenTelegram"/);
assert.match(html, /id="editorToggleAllBlocks"/);
assert.doesNotMatch(telegramControls, /confirm\(/);
assert.doesNotMatch(rightPanel, /confirm\(/);
assert.doesNotMatch(rightPanel, /prompt\(/);
assert.match(postList, /t\("editor\.projectPostListView\.closeProject"\)/);
assert.match(postList, /project-post-rename-editor/);
assert.doesNotMatch(postList, /#createPost/);
assert.match(postList, /showCardDeleteConfirmation/);
assert.match(postList, /const showDocumentAi = post\.id === activePostId/,
  "Whole-post prompt controls must always be visible on the active Project post card");
assert.doesNotMatch(postList, /astHasAiPrompt/,
  "Whole-post prompt visibility must not depend on prompts in Canvas blocks");
assert.match(postList, /post\.ai\?\.documentPrompt/,
  "The active post card must expose its own whole-post prompt");
assert.doesNotMatch(postList, /input\.type = "checkbox"/,
  "The obsolete extended-context checkbox must be removed from Project posts");
assert.match(postList, /project-post-ai-json/,
  "The active Project post card must expose Post AI JSON under the full-context condition");
assert.match(postList, /el\("details", "project-post-ai-settings document-ai-prompt-disclosure"\)/,
  "the whole-post AI prompt must be collapsible");
assert.match(draftList, /el\("details", "draft-document-ai-settings document-ai-prompt-disclosure"\)/,
  "the whole-draft AI prompt must be collapsible");
for (const source of [draftList, postList]) {
  assert.match(source, /openAi\.disabled = !documentPrompt\.trim\(\)/,
    "the whole-document AI JSON action must start disabled for an empty prompt");
  assert.match(source, /openAi\.disabled = !filled/,
    "the whole-document AI JSON action must track prompt input");
}
assert.match(postList, /cardActions\.push\(openAi\)/,
  "Post AI JSON must live in the card's shared action group");
assert.match(rightPanel, /onOpenAi: \(post, documentPrompt\) => this\.#openProjectPostAi\(post, documentPrompt\)/,
  "Project post AI JSON must be wired through the right panel");
assert.match(postList, /t\("editor\.projectPostListView\.theStartingPostContainsAMapAnd"\)/);
assert.match(rightPanel, /onDelete: post => this\.#deleteProjectPost\(post\)/);
assert.doesNotMatch(rightPanel, /#createPost/);
assert.match(html, /id="editorProjectDeployment"/);
assert.match(html, /class="canvas-context-bar"/);
assert.doesNotMatch(library, /previewSync\.(sync|clear)/);
assert.doesNotMatch(library, /previewSync\.sync/);
assert.doesNotMatch(app, /reason === "restored"[\s\S]{0,600}projectPreviewSync\.sync/);
assert.doesNotMatch(app, /beforeOpenPost|beforeOpenProject|editorAutoOpenTelegram/);
assert.match(app, /setBeforeOpenProject\([\s\S]*reason !== "project-opened"[\s\S]*clearAllDeployments/);
console.log('editor_project_ui_contract_smoke: OK');
