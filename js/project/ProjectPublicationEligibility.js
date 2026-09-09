import { ProjectIndex } from "./ProjectIndex.js?v=1.5.9";
import { isLinearProject } from "./ProjectStore.js?v=1.7.6";

export function getProjectPostPublicationEligibility(project, postId, index = null) {
  const post = project?.posts?.find?.(item => String(item.id) === String(postId)) || null;
  if (!post) return { eligible: false, prerequisitePostIds: [], blockingPostIds: [] };

  // A structured Project is a sequence. A child is not merely dependent on the
  // map host: every preceding Project post must already have a publication.
  if (isLinearProject(project)) {
    const position = project.posts.findIndex(item => String(item.id) === String(postId));
    const prerequisitePostIds = project.posts.slice(0, Math.max(0, position)).map(item => String(item.id));
    const blockingPostIds = prerequisitePostIds.filter(id => {
      const prerequisite = project.posts.find(item => String(item.id) === id);
      return prerequisite?.publication?.state !== "published";
    });
    return { eligible: blockingPostIds.length === 0, prerequisitePostIds, blockingPostIds };
  }

  const graph = index instanceof ProjectIndex ? index : new ProjectIndex(project);
  const prerequisitePostIds = [...new Set(
    graph.mapSlotsForPost(post.id)
      .map(relation => String(relation?.hostPostId || ""))
      .filter(id => id && id !== String(post.id))
  )];

  const blockingPostIds = prerequisitePostIds.filter(hostPostId => {
    const host = project.posts.find(item => String(item.id) === hostPostId);
    return !host || host?.publication?.state !== "published";
  });

  return {
    eligible: blockingPostIds.length === 0,
    prerequisitePostIds,
    blockingPostIds
  };
}

export function getProjectPostScheduleEligibility(project, postId, index = null) {
  const publication = getProjectPostPublicationEligibility(project, postId, index);
  const post = project?.posts?.find(item => String(item.id) === String(postId));
  if (!post) return { ...publication, minScheduledAt: 0, maxScheduledAt: null, scheduledDependentPostIds: [] };
  const prerequisites = publication.prerequisitePostIds.map(id => project.posts.find(item => String(item.id) === id));
  const scheduledTime = item => item?.publication?.state === "scheduled" && Number.isFinite(Number(item.schedule?.scheduledAt))
    ? Math.max(0, Number(item.schedule.scheduledAt)) : 0;
  const blockingPostIds = prerequisites
    .filter(item => item?.publication?.state !== "published" && !scheduledTime(item))
    .map(item => String(item.id));
  const minScheduledAt = Math.max(0, ...prerequisites.map(item => scheduledTime(item)
    || Number(item?.publication?.publishedAt || item?.deployments?.production?.publishedAt || 0)));
  const scheduledDependents = project.posts.filter(item => scheduledTime(item)
    && getProjectPostPublicationEligibility(project, item.id, index).prerequisitePostIds.includes(String(postId)));
  return {
    eligible: blockingPostIds.length === 0,
    prerequisitePostIds: publication.prerequisitePostIds,
    blockingPostIds,
    minScheduledAt,
    maxScheduledAt: scheduledDependents.length ? Math.min(...scheduledDependents.map(scheduledTime)) : null,
    scheduledDependentPostIds: scheduledDependents.map(item => String(item.id))
  };
}
