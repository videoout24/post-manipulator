import { ProjectStore } from "../project/ProjectStore.js?v=1.7.14";
import { ProjectIndex } from "../project/ProjectIndex.js?v=1.5.9";
import { ProjectGraphReconciler } from "../project/ProjectGraphReconciler.js?v=1.5.9";
import { ProjectEditorSession } from "../project/ProjectEditorSession.js?v=1.7.6";
import { ProjectCompiler } from "../project/ProjectCompiler.js?v=1.7.11";
import { ProjectValidator } from "../project/ProjectValidator.js?v=1.5.9";
import { ProjectDeploymentResolver } from "../project/ProjectDeploymentResolver.js?v=1.5.9";

export function createProjectDomain({ db, events, tree, storage, richMessageValidator = null } = {}) {
  const store = new ProjectStore({ db, events });
  const index = new ProjectIndex();
  const session = new ProjectEditorSession({ store, tree, storage, db, events });
  const graphReconciler = new ProjectGraphReconciler({ store, events });
  const compiler = new ProjectCompiler();
  const validator = new ProjectValidator({ richMessageValidator });

  const buildPreviewTree = () => {
    if (!session.isProjectActive() || !session.activePostId || !session.project) return tree;
    const project = structuredClone(session.project);
    const active = project.posts.find(post => post.id === session.activePostId);
    if (!active) return tree;
    active.messageAst = tree.toJSON();
    const previewIndex = new ProjectIndex(project);
    const resolver = new ProjectDeploymentResolver({ project, index: previewIndex, deployment: "preview" });
    return compiler.compilePost(project, active.id, {
      deployment: "preview",
      index: previewIndex,
      resolver,
      sourceAst: active.messageAst
    });
  };

  return Object.freeze({
    store,
    index,
    session,
    graphReconciler,
    compiler,
    validator,
    buildPreviewTree
  });
}
