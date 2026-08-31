export class ProjectDeploymentResolver {
  constructor({ project, index, deployment = "preview" } = {}) {
    this.project = project;
    this.index = index;
    this.deployment = deployment;
  }

  resolvePost(postId) {
    const post = this.project?.posts?.find(item => item.id === postId);
    if (!post) return null;
    const record = post.deployments?.[this.deployment];
    if (!record?.messageId || !record?.chatId) return null;
    return {
      postId: post.id,
      deployment: this.deployment,
      chatId: Number(record.chatId),
      messageId: Number(record.messageId),
      url: record.url || telegramMessageUrl(record.chatId, record.messageId),
      ...structuredClone(record)
    };
  }

  resolveMap(mapId) {
    const hostPostId = this.index?.hostPostForMap?.(mapId);
    if (!hostPostId) return null;
    const resolved = this.resolvePost(hostPostId);
    return resolved ? { ...resolved, mapId, hostPostId } : null;
  }
}

export function telegramMessageUrl(chatId, messageId) {
  const id = String(chatId ?? "").trim();
  const message = Number(messageId);
  if (!id || !Number.isFinite(message) || message <= 0) return "";
  if (/^-100\d+$/.test(id)) return `https://t.me/c/${id.slice(4)}/${Math.trunc(message)}`;
  // Preview channels are private and normally use -100... ids. Keep a deterministic
  // fallback for tests/imported data without pretending it is a valid public username URL.
  const digits = id.replace(/^-/, "");
  return digits ? `https://t.me/c/${digits}/${Math.trunc(message)}` : "";
}
