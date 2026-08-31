const SETTINGS_KEY = "formulaTemplateLibrary";

const DEFAULT_LIBRARY = Object.freeze({
  sections: [
    {
      title: "Физика",
      subsections: [
        { title: "Механика", templates: [
          { label: "Второй закон Ньютона", latex: "F=ma" },
          { label: "Кинетическая энергия", latex: "E_k=\\frac{mv^2}{2}" }
        ] }
      ]
    },
    {
      title: "Химия",
      subsections: [
        { title: "Общее", templates: [
          { label: "Количество вещества", latex: "n=\\frac{m}{M}" }
        ] }
      ]
    }
  ]
});

export class FormulaTemplateLibrary {
  constructor({ db = null, events = null } = {}) {
    this.db = db;
    this.events = events;
    this.cache = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    // Browser-only Telegram file bytes are not readable because the Telegram file endpoint
    // does not expose CORS headers. Small template packs can still be imported through the
    // bot when their JSON is placed in the document caption; full files use the local picker.
    this.events?.on("gallery:ingested", asset => {
      if (asset?.type !== "document") return;
      if (!/\.json$/i.test(asset.fileName || "") && !/json/i.test(asset.mimeType || "")) return;
      const payload = String(asset.caption || "").trim();
      if (!payload.startsWith("{")) return;
      this.importJson(payload, { source: `telegram:${asset.id}` })
        .then(result => this.events?.emit("ui:editor-notice", { message: `LaTeX-шаблоны импортированы: ${result.added}`, type: "success" }))
        .catch(error => this.events?.emit("ui:editor-notice", { message: `LaTeX JSON: ${error.message}`, type: "error" }));
    });
  }

  async getLibrary() {
    if (this.cache) return structuredClone(this.cache);
    const stored = this.db ? await this.db.get("settings", SETTINGS_KEY, null) : null;
    this.cache = normalizeLibrary(stored || DEFAULT_LIBRARY);
    return structuredClone(this.cache);
  }

  async importJson(input, { source = "manual" } = {}) {
    const parsed = typeof input === "string" ? JSON.parse(input) : structuredClone(input);
    const incoming = normalizeLibrary(parsed);
    const current = await this.getLibrary();
    let added = 0;
    for (const section of incoming.sections) {
      let targetSection = current.sections.find(item => item.title === section.title);
      if (!targetSection) {
        targetSection = { title: section.title, subsections: [] };
        current.sections.push(targetSection);
      }
      for (const subsection of section.subsections) {
        let targetSub = targetSection.subsections.find(item => item.title === subsection.title);
        if (!targetSub) {
          targetSub = { title: subsection.title, templates: [] };
          targetSection.subsections.push(targetSub);
        }
        for (const template of subsection.templates) {
          const existing = targetSub.templates.find(item => item.label === template.label || item.latex === template.latex);
          if (existing) Object.assign(existing, template);
          else { targetSub.templates.push(template); added += 1; }
        }
      }
    }
    current.updatedAt = Date.now();
    current.lastSource = source;
    this.cache = normalizeLibrary(current);
    if (this.db) await this.db.put("settings", SETTINGS_KEY, this.cache);
    this.events?.emit("formula:templates-updated", structuredClone(this.cache));
    return { added, library: structuredClone(this.cache) };
  }

  async reset() {
    this.cache = normalizeLibrary(DEFAULT_LIBRARY);
    if (this.db) await this.db.put("settings", SETTINGS_KEY, this.cache);
    this.events?.emit("formula:templates-updated", structuredClone(this.cache));
    return structuredClone(this.cache);
  }
}

function normalizeLibrary(input) {
  const sourceSections = Array.isArray(input?.sections) ? input.sections : [];
  const sections = [];
  for (const section of sourceSections) {
    const title = String(section?.title || "Раздел").trim() || "Раздел";
    const rawSubs = Array.isArray(section?.subsections)
      ? section.subsections
      : [{ title: "Общее", templates: Array.isArray(section?.templates) ? section.templates : [] }];
    const subsections = rawSubs.map(sub => ({
      title: String(sub?.title || "Общее").trim() || "Общее",
      templates: (Array.isArray(sub?.templates) ? sub.templates : [])
        .map(template => ({ label: String(template?.label || template?.latex || "Шаблон"), latex: String(template?.latex || "") }))
        .filter(template => template.latex)
    })).filter(sub => sub.templates.length);
    if (subsections.length) sections.push({ title, subsections });
  }
  return { sections, updatedAt: Number(input?.updatedAt || 0) || null, lastSource: input?.lastSource || null };
}
