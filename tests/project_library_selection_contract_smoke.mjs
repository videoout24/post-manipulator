import fs from 'node:fs';
import assert from 'node:assert/strict';

const library = fs.readFileSync(new URL('../js/project/ProjectLibraryView.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../js/project/ProjectPostPanel.js', import.meta.url), 'utf8');

assert.match(library, /this\.selectedProjectId = project\.id/);
assert.match(library, /this\.selectedPosts\.set\(project\.id, selectedPost\.id\)/);
assert.match(library, /project:session-changed", \(\{ activeProjectId, activePostId \} = \{\}\) => \{[\s\S]*?this\.selectedPosts\.set\(activeProjectId, activePostId\)/);
assert.match(library, /projectPostOpenButton\(\(\) => this\.#openProject\(project, post\)\)/);
assert.match(library, /#activateProject\(project\.id, selectedPost\?\.id \|\| null\)/);
assert.match(library, /session\.openProject\(projectId, \{ postId \}\)/);
assert.doesNotMatch(library, /onclick\s*=\s*\(\)\s*=>\s*this\.session\.openProject/);
assert.match(panel, /variant:\s*"compact"/);
assert.match(library, /variant:\s*"overview"/);

console.log('project library selection contract smoke: OK');
