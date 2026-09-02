import { t } from "../i18n/index.js?v=1.8.0";

export const PROJECT_IMPORT_FORMAT = "rich-current-project";
export const PROJECT_BUNDLE_FORMAT = "rich-current-projects";
export const PROJECT_IMPORT_VERSION = 1;
export const MAX_PROJECT_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Project imports deliberately operate above the IndexedDB backup layer: a file
 * adds one or more projects and never replaces unrelated local application data.
 */
export function parseProjectImportText(text, { baseUrl = "" } = {}) {
  let document;
  try { document = JSON.parse(String(text || "")); }
  catch { throw new Error(t("project.projectImport.invalidJson")); }

  const projects = projectsFromDocument(document);
  if (!projects.length) throw new Error(t("project.projectImport.noProjects"));
  return projects.map(project => resolveRelativeMedia(structuredClone(project), baseUrl));
}

export function createProjectImportDocument(project, { createdAt = Date.now() } = {}) {
  return {
    format: PROJECT_IMPORT_FORMAT,
    version: PROJECT_IMPORT_VERSION,
    createdAt: Number(createdAt) || Date.now(),
    project: structuredClone(project)
  };
}

export function createProjectBundleDocument(projects, { createdAt = Date.now() } = {}) {
  return {
    format: PROJECT_BUNDLE_FORMAT,
    version: PROJECT_IMPORT_VERSION,
    createdAt: Number(createdAt) || Date.now(),
    projects: structuredClone(projects || [])
  };
}

function projectsFromDocument(document) {
  if (Array.isArray(document)) return validateProjects(document);
  if (!document || typeof document !== "object") throw new Error(t("project.projectImport.invalidDocument"));

  if (document.format === PROJECT_IMPORT_FORMAT) {
    validateVersion(document.version);
    return validateProjects([document.project]);
  }
  if (document.format === PROJECT_BUNDLE_FORMAT) {
    validateVersion(document.version);
    return validateProjects(document.projects);
  }
  if (document.format) throw new Error(t("project.projectImport.unsupportedFormat", { 0: document.format }));

  // Raw Project objects and { projects: [...] } are accepted for hand-authored
  // fixtures, while generated/exported files should use the versioned envelope.
  if (Array.isArray(document.projects)) return validateProjects(document.projects);
  if (Array.isArray(document.posts)) return validateProjects([document]);
  throw new Error(t("project.projectImport.invalidDocument"));
}

function validateVersion(version) {
  if (Number(version) !== PROJECT_IMPORT_VERSION) {
    throw new Error(t("project.projectImport.unsupportedVersion", { 0: version }));
  }
}

function validateProjects(projects) {
  if (!Array.isArray(projects)) throw new Error(t("project.projectImport.invalidDocument"));
  for (const project of projects) {
    if (!project || typeof project !== "object" || !Array.isArray(project.posts)) {
      throw new Error(t("project.projectImport.invalidProject"));
    }
  }
  return projects;
}

function resolveRelativeMedia(project, baseUrl) {
  const normalizedBase = String(baseUrl || "").trim();
  if (!normalizedBase) return project;
  for (const post of project.posts || []) walk(post?.messageAst, node => {
    if (!MEDIA_TYPES.has(node?.type)) return;
    node.props ||= {};
    for (const key of ["fileId", "url"]) {
      const source = String(node.props[key] || "");
      if (!source.startsWith("./") && !source.startsWith("../")) continue;
      try { node.props[key] = new URL(source, normalizedBase).href; }
      catch { /* The normal block validator will report an unusable media source. */ }
    }
  });
  return project;
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

const MEDIA_TYPES = new Set(["animation", "audio", "document", "photo", "video", "voice_note"]);
