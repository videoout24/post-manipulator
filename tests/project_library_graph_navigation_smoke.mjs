import fs from 'node:fs';
import assert from 'node:assert/strict';

const library = fs.readFileSync(new URL('../js/project/ProjectLibraryView.js', import.meta.url), 'utf8');
const cards = fs.readFileSync(new URL('../js/project/ProjectPostCard.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

// Project overview is a strict vertical card stream.
assert.match(css, /\.project-library-posts\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/);

// The view resolves graph identity with ProjectIndex, not Telegram links.
assert.match(library, /new ProjectIndex\(project\)/);
assert.match(library, /hostPostForMap\(targetMapId\)/);
assert.match(library, /#navigateToProjectPost\(project, activeId, targetPostId\)/);
assert.match(library, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
assert.match(library, /selectedPosts\.set\(project\.id, postId\)/);
assert.match(library, /project-post-preview-map/);
assert.match(library, /flash\(map\)/);

// Map slots and Back to Map are interactive only inside overview preview.
assert.match(cards, /case "project_post_map"/);
assert.match(cards, /case "project_map_backlink"/);
assert.match(cards, /dataset\.targetPostId = target\.id/);
assert.match(cards, /onNavigatePost\(target\.id\)/);
assert.match(cards, /dataset\.targetMapId = targetMapId/);
assert.match(cards, /onNavigateMap\(targetMapId\)/);
assert.match(cards, /dataset\.mapId = mapId/);

// Navigation controls are visually link-like and blue-highlight destinations.
assert.match(css, /\.project-post-preview-nav-link/);
assert.match(css, /color:\s*#69a8ff/);
assert.match(css, /\.project-post-card\.nav-highlight/);
assert.match(css, /\.project-post-preview-map\.nav-highlight/);

console.log('project library graph navigation smoke: OK');
