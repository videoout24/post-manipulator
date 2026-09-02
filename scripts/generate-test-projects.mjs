import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { createProjectBundleDocument, createProjectImportDocument } from "../js/project/ProjectImport.js";

const PROJECT_COUNT = 20;
const POSTS_PER_PROJECT = 10;
const MIN_RANDOM_BLOCKS = 5;
const CREATED_AT = Date.parse("2026-09-02T08:00:00.000Z");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");
const projectsDir = join(rootDir, "data", "test-projects");
const bundlePath = join(rootDir, "data", "test-projects-bundle.json");

const themes = [
  "Городские маршруты", "Продуктовые эксперименты", "Полевая экспедиция", "Книжный клуб",
  "Домашняя лаборатория", "Командная ретроспектива", "Креативная мастерская", "Истории района",
  "Недельный дайджест", "Образовательный спринт", "Фестиваль идей", "Путевой журнал",
  "Технологический обзор", "Кулинарная серия", "Архив наблюдений", "Спортивный дневник",
  "Музыкальная подборка", "Экологический проект", "Фотоисследование", "Календарь событий"
];

await mkdir(projectsDir, { recursive: true });
const projects = Array.from({ length: PROJECT_COUNT }, (_, index) => createProject(index + 1));
for (let index = 0; index < projects.length; index += 1) {
  const filename = `project-${pad(index + 1)}.json`;
  const document = createProjectImportDocument(projects[index], { createdAt: CREATED_AT + index });
  await writeFile(join(projectsDir, filename), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}
await writeFile(
  bundlePath,
  `${JSON.stringify(createProjectBundleDocument(projects, { createdAt: CREATED_AT }), null, 2)}\n`,
  "utf8"
);

console.log(`Generated ${PROJECT_COUNT} projects × ${POSTS_PER_PROJECT} posts`);
console.log(relative(rootDir, projectsDir));
console.log(relative(rootDir, bundlePath));

function createProject(projectNumber) {
  const rng = mulberry32(0x5eed0000 + projectNumber * 7919);
  const projectKey = pad(projectNumber);
  const mapId = `test_map_${projectKey}`;
  const postIds = Array.from({ length: POSTS_PER_PROJECT }, (_, index) => `test_post_${projectKey}_${pad(index + 1)}`);
  const slotIds = postIds.slice(1).map((_, index) => `test_slot_${projectKey}_${pad(index + 2)}`);
  const projectCreatedAt = CREATED_AT + projectNumber * 60_000;

  const posts = postIds.map((postId, postIndex) => {
    const postNumber = postIndex + 1;
    const title = `${pad(postNumber)}. ${postTitle(projectNumber, postNumber)}`;
    const required = postIndex === 0
      ? projectMap(projectKey, mapId, postIds, slotIds)
      : projectBacklink(projectKey, postNumber, mapId, slotIds[postIndex - 1]);
    const content = createRandomContent({ rng, projectNumber, postNumber, theme: themes[projectNumber - 1] });
    if (postIndex === 0) content[0] = photoBlock(projectKey, postNumber, projectNumber);
    const children = shuffle(rng, [heading(projectKey, postNumber, title), required, ...content]);
    const timestamp = projectCreatedAt + postNumber * 1000;
    return {
      id: postId,
      title,
      messageAst: { id: "root", type: "document", props: {}, children },
      schedule: null,
      publication: { state: "draft" },
      deployments: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
  });

  return {
    id: `test_project_${projectKey}`,
    schemaVersion: 2,
    title: `Тест ${projectKey} · ${themes[projectNumber - 1]}`,
    structure: { mode: "linear", rootPostId: postIds[0], rootMapId: mapId },
    posts,
    createdAt: projectCreatedAt,
    updatedAt: projectCreatedAt + POSTS_PER_PROJECT * 1000
  };
}

function createRandomContent({ rng, projectNumber, postNumber, theme }) {
  const count = MIN_RANDOM_BLOCKS + Math.floor(rng() * 4);
  const factories = shuffle(rng, [
    paragraphBlock, preformattedBlock, footerBlock, dividerBlock, formulaBlock, listBlock,
    quoteBlock, tableBlock, detailsBlock, locationBlock, photoBlock, buttonBlock
  ]);
  return factories.slice(0, count).map((factory, index) => factory(pad(projectNumber), postNumber, projectNumber, {
    index,
    theme,
    rng
  }));
}

function heading(projectKey, postNumber, text) {
  return node(`heading_${projectKey}_${pad(postNumber)}`, "heading", { text, level: 2 });
}

function projectMap(projectKey, mapId, postIds, slotIds) {
  return node(`project_map_${projectKey}`, "project_post_map", {
    mapId,
    slots: postIds.slice(1).map((targetPostId, index) => ({
      id: slotIds[index],
      targetPostId,
      text: `${pad(index + 2)}. ${postTitle(Number(projectKey), index + 2)}`,
      derivedFromPostId: targetPostId
    })),
    numbering: "numeric",
    emptyText: "Карта пока пуста"
  });
}

function projectBacklink(projectKey, postNumber, mapId, slotId) {
  return node(`project_backlink_${projectKey}_${pad(postNumber)}`, "project_map_backlink", {
    targetMapId: mapId,
    targetSlotId: slotId,
    text: "Назад к карте",
    managedByMap: true
  });
}

function paragraphBlock(projectKey, postNumber, _projectNumber, context = {}) {
  const text = `${context.theme}: наблюдение ${postNumber}.${context.index + 1}. Этот абзац нужен для проверки редактирования, переноса и форматирования.`;
  return node(id("paragraph", projectKey, postNumber, context.index), "paragraph", {
    text: [{ type: "bold", text: `${context.theme}. ` }, text.slice(context.theme.length + 2)]
  });
}

function preformattedBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("pre", projectKey, postNumber, context.index), "preformatted", {
    text: `project=${projectKey}\npost=${pad(postNumber)}\nvariant=${context.index + 1}`,
    language: "text"
  });
}

function footerBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("footer", projectKey, postNumber, context.index), "footer", {
    text: `Тестовый подвал · проект ${projectKey} · пост ${pad(postNumber)}`
  });
}

function dividerBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("divider", projectKey, postNumber, context.index), "divider", {});
}

function formulaBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("formula", projectKey, postNumber, context.index), "mathematical_expression", {
    expression: `x_${Number(projectKey)} + y_${postNumber} = ${Number(projectKey) + postNumber}`
  });
}

function listBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("list", projectKey, postNumber, context.index), "list", {
    items: [
      { blocks: [{ type: "paragraph", text: `Проверить карточку ${postNumber}` }], has_checkbox: true, is_checked: false },
      { blocks: [{ type: "paragraph", text: "Изменить порядок блоков" }], has_checkbox: true, is_checked: true },
      { blocks: [{ type: "paragraph", text: "Выгрузить в тестовый чат" }], type: "1", value: 3 }
    ]
  });
}

function quoteBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("quote", projectKey, postNumber, context.index), "block_quotation", {
    text: `«Тестовый контент должен быть разнообразным — вариант ${projectKey}.${pad(postNumber)}».`,
    credit: "Набор автотестов"
  });
}

function tableBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("table", projectKey, postNumber, context.index), "table", {
    cells: [
      [{ text: "Параметр", is_header: true }, { text: "Значение", is_header: true }],
      [{ text: "Проект" }, { text: projectKey }],
      [{ text: "Пост" }, { text: String(postNumber) }]
    ],
    isBordered: true,
    isStriped: context.index % 2 === 0,
    isCompact: context.index % 3 === 0,
    caption: "Контрольные значения"
  });
}

function detailsBlock(projectKey, postNumber, _projectNumber, context = {}) {
  const details = node(id("details", projectKey, postNumber, context.index), "details", {
    summary: `Дополнительные данные ${projectKey}.${pad(postNumber)}`,
    open: context.index % 2 === 0
  });
  details.children.push(node(`${details.id}_child`, "paragraph", {
    text: "Этот вложенный абзац проверяет раскрывающиеся блоки и глубину AST."
  }));
  return details;
}

function locationBlock(projectKey, postNumber, projectNumber, context = {}) {
  return node(id("map", projectKey, postNumber, context.index), "map", {
    location: {
      latitude: 11.5564 + projectNumber * 0.001,
      longitude: 104.9282 + postNumber * 0.001
    },
    zoom: 12 + (postNumber % 3),
    width: 640,
    height: 360,
    caption: `Тестовая точка ${projectKey}.${pad(postNumber)}`
  });
}

function photoBlock(projectKey, postNumber, projectNumber, context = {}) {
  const imageNumber = ((projectNumber + postNumber + Number(context.index || 0) - 2) % 10) + 1;
  return node(id("photo", projectKey, postNumber, context.index || 0), "photo", {
    fileId: `./assets/test-projects/test-${pad(imageNumber)}.png`,
    caption: `Тестовое изображение ${pad(imageNumber)} · ${projectKey}.${pad(postNumber)}`,
    captionCredit: "Post Manipulator fixture",
    hasSpoiler: (projectNumber + postNumber) % 7 === 0
  });
}

function buttonBlock(projectKey, postNumber, _projectNumber, context = {}) {
  return node(id("button", projectKey, postNumber, context.index), "url_button", {
    text: `Открыть тест ${projectKey}.${pad(postNumber)}`,
    url: `https://example.com/post-manipulator/${projectKey}/${pad(postNumber)}`,
    buttonStyle: ["primary", "success", "danger"][context.index % 3]
  });
}

function node(nodeId, type, props) {
  return { id: nodeId, type, props, children: [] };
}

function id(type, projectKey, postNumber, index = 0) {
  return `test_${type}_${projectKey}_${pad(postNumber)}_${pad(index + 1)}`;
}

function postTitle(projectNumber, postNumber) {
  const labels = ["Старт и карта", "Контекст", "Наблюдения", "Материалы", "Сравнение", "Практика", "Проверка", "Варианты", "Итоги", "Следующий шаг"];
  return `${labels[postNumber - 1]} · ${themes[projectNumber - 1]}`;
}

function shuffle(rng, values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function pad(value) { return String(value).padStart(2, "0"); }
