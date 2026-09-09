import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { ProjectStore } from "../js/project/ProjectStore.js";
import { ProjectCompiler } from "../js/project/ProjectCompiler.js";
import { ProjectPublicationService } from "../js/project/ProjectPublicationService.js";
import { getProjectPostPublicationEligibility, getProjectPostScheduleEligibility } from "../js/project/ProjectPublicationEligibility.js";

const values = new Map();
const db = {
  async get(store, key, fallback = null) { return structuredClone(values.get(`${store}:${key}`) ?? fallback); },
  async put(store, key, value) { values.set(`${store}:${key}`, structuredClone(value)); return value; },
  async delete(store, key) { values.delete(`${store}:${key}`); },
  async all(store) { return [...values].filter(([key]) => key.startsWith(`${store}:`)).map(([key, value]) => ({ key: key.slice(store.length + 1), value: structuredClone(value) })); }
};
const events = new EventBus();
const store = new ProjectStore({ db, events });
let project = await store.createProject({ title: "Sequence", firstPostTitle: "Map" });
for (let i = 1; i <= 3; i++) await store.createPost(project.id, { title: `Post ${i}` });
project = await store.getProject(project.id);
const [map, first, second, last] = project.posts;
const target = { chatId: -100550, title: "Channel", type: "channel", status: "ready", commentsEnabled: false };
let sent = 0, active = 0, maxActive = 0, failSend = false;
const starts = [];
const errors = [];
events.on("project:publication", event => {
  if (event.state === "publishing") starts.push(event.postId);
  if (event.state === "schedule-error") errors.push(event.error);
});
const dependencies = {
  db, events, store, compiler: new ProjectCompiler(), validator: { validate: () => [] },
  targets: { list: async () => [target, { ...target, chatId: -100551 }] },
  renderer: { renderEnvelope: tree => ({ richMessage: tree.toJSON(), replyMarkup: { inline_keyboard: [] } }) },
  client: {
    async sendRichMessage() {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      if (failSend) throw new Error("offline");
      return { message_id: ++sent, date: Math.floor(Date.now() / 1000) };
    },
    async editRichMessage() { return {}; }
  }
};
let service = new ProjectPublicationService(dependencies);
const time = Date.now() + 60_000;
const schedule = (post, scheduledAt = time, chatId = target.chatId) => service.schedulePost(project.id, post.id, chatId, { scheduledAt });
await assert.rejects(schedule(first));
await schedule(map);
project = await store.getProject(project.id);
assert.equal(getProjectPostScheduleEligibility(project, first.id).eligible, true);
assert.equal(getProjectPostPublicationEligibility(project, first.id).eligible, false, "scheduling must not relax immediate publication order");
await assert.rejects(service.publishPost(project.id, first.id, target.chatId));
await assert.rejects(schedule(first, time - 1000));
await assert.rejects(schedule(first, time, -100551), "the project channel remains locked");
await schedule(first);
await assert.rejects(schedule(last), "every predecessor must be published or scheduled");
await schedule(second, time + 60_000);
await schedule(last, time + 60_000);
await assert.rejects(schedule(map, time + 1000), "rescheduling a predecessor cannot overtake its successor");
await assert.rejects(service.cancelPostSchedule(project.id, first.id), "cancellation must preserve the scheduled sequence");
await service.cancelPostSchedule(project.id, last.id);
await service.cancelPostSchedule(project.id, second.id);
await schedule(second);
await schedule(last);
service.stop();

// Restart after all four equal timestamps are overdue. Multiple timer callbacks
// and slow Telegram calls must still produce each post once in Project order.
project = await store.getProject(project.id);
for (const post of project.posts) {
  post.schedule.scheduledAt = Date.now() - 1000;
  post.publication.scheduledAt = post.schedule.scheduledAt;
}
await db.put("projects", project.id, project);
service = new ProjectPublicationService(dependencies);
await service.initialize();
const deadline = Date.now() + 3000;
while ((await store.getProject(project.id)).posts.some(post => post.publication.state !== "published") && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 10));
}
service.stop();
assert.equal(sent, 4);
assert.equal(maxActive, 1);
assert.deepEqual(starts, project.posts.map(post => post.id));
assert.deepEqual(errors, []);

// A failed predecessor blocks later sends; all schedules remain available for retry.
project = await store.getProject(project.id);
for (const post of project.posts) {
  post.deployments.production = null;
  post.publication = { state: "scheduled", scheduledAt: Date.now() - 1000 };
  post.schedule = { scheduledAt: post.publication.scheduledAt, chatId: target.chatId };
}
await db.put("projects", project.id, project);
starts.length = 0;
failSend = true;
service = new ProjectPublicationService(dependencies);
await service.initialize();
await new Promise(resolve => setTimeout(resolve, 80));
service.stop();
assert.deepEqual(starts, [map.id]);
assert.equal(errors.length, 1);
assert.equal((await store.getProject(project.id)).posts.every(post => post.publication.state === "scheduled"), true);
console.log("project_sequential_schedule_smoke: OK");
