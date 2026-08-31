import assert from 'node:assert/strict';
import { EditorTelegramControls, hasPreviewDeployment, hasCurrentPostDeployment, syncStatusLabel } from '../js/editor/EditorTelegramControls.js?v=1.5.9';

const project = {
  posts: [
    { id: 'a', deployments: {} },
    { id: 'b', deployments: { preview: { chatId: -100123, messageId: 2 } } }
  ]
};
assert.equal(hasPreviewDeployment(project), true);
assert.equal(hasCurrentPostDeployment({ project, activePostId: 'a' }), false);
assert.equal(hasCurrentPostDeployment({ project, activePostId: 'b' }), true);
assert.equal(hasCurrentPostDeployment({
  project: { posts: [{ id: 7, deployments: { preview: { chatId: -100123, messageId: 8 } } }] },
  activePostId: '7'
}), true);
assert.equal(hasPreviewDeployment({ posts: [] }), false);
assert.equal(syncStatusLabel({ state: 'resolving', current: 2, total: 4 }), 'Связи 2/4');
assert.equal(syncStatusLabel({ state: 'synced' }), 'Синхронизировано');
assert.equal(syncStatusLabel(null), '');

const destinations = [];
const controls = new EditorTelegramControls({
  session: { isProjectActive: () => true, project, activePostId: 'b' },
  navigation: {
    openProjectPost(targetProject, postId, deployment) {
      destinations.push({ targetProject, postId, deployment });
      return true;
    },
    openPrivateMessage() { throw new Error('Project must not open standalone live-preview'); }
  }
});
assert.equal(controls.openCurrent(), true);
assert.deepEqual(destinations[0], { targetProject: project, postId: 'b', deployment: 'preview' });

console.log('editor_telegram_controls_smoke: OK');
