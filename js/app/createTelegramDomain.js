import { TelegramClient } from "../telegram/TelegramClient.js?v=1.7.6";
import { BotIdentityService } from "../telegram/BotIdentityService.js?v=1.5.9";
import { OwnerBindingService } from "../telegram/OwnerBindingService.js?v=1.6.5";
import { PreviewChannelBindingService } from "../telegram/PreviewChannelBindingService.js?v=1.5.9";
import { TopicTransport } from "../telegram/TopicTransport.js?v=1.5.9";
import { ProjectPreviewTransport } from "../telegram/ProjectPreviewTransport.js?v=1.5.9";
import { TelegramCore } from "../telegram/TelegramCore.js?v=1.7.13";
import { TelegramRuntime } from "../telegram/TelegramRuntime.js?v=1.7.3";
import { TelegramServiceMessageCleaner } from "../telegram/TelegramServiceMessageCleaner.js?v=1.7.9";
import { PreviewController } from "../telegram/PreviewController.js?v=1.7.6";
import { TelegramNavigation } from "../telegram/TelegramNavigation.js?v=1.7.1";
import { PublicationTargetService } from "../telegram/PublicationTargetService.js?v=1.7.9";
import { PublicationService } from "../telegram/PublicationService.js?v=1.7.13";
import { LinkRelationStore } from "../links/LinkRelationStore.js?v=1.7.13";

export function createTelegramDomain({ db, events, renderer, validator, tree, treeProvider = null, previewSyncGuard = null, drafts = null, draftSession = null, documents = null, initialToken = "", verifiedBot = null } = {}) {
  const client = new TelegramClient({ events, token: initialToken });
  const botIdentity = new BotIdentityService({ db, client, events });
  const navigation = new TelegramNavigation({ db, events, botIdentity });
  const ownerBinding = new OwnerBindingService({ db, events });
  const previewChannelBinding = new PreviewChannelBindingService({ db, events, client, ownerBinding });
  const publicationTargets = new PublicationTargetService({ db, events, client, previewChannelBinding });
  const linkRelations = new LinkRelationStore({ db, events });
  const publications = new PublicationService({ db, events, client, renderer, validator, targets: publicationTargets, drafts, draftSession, documents, linkRelations });
  const serviceMessages = new TelegramServiceMessageCleaner({
    client,
    ownerBinding,
    previewChannelBinding,
    publicationTargets,
    events
  });
  const topics = new TopicTransport({ events, client, ownerBinding });
  const runtime = new TelegramRuntime({
    db,
    events,
    client,
    ownerBinding,
    previewChannelBinding,
    publicationTargets,
    publications,
    serviceMessages,
    linkRelations,
    botIdentity
  });
  const previewController = new PreviewController({
    db,
    events,
    client,
    previewChannelBinding,
    renderer,
    validator,
    tree,
    treeProvider,
    syncGuard: previewSyncGuard
  });
  const projectPreviewTransport = new ProjectPreviewTransport({
    client,
    previewChannelBinding,
    renderer,
    validator,
    events
  });
  const core = new TelegramCore({
    db,
    client,
    runtime,
    ownerBinding,
    previewChannelBinding,
    publicationTargets,
    publications,
    previewController,
    topics,
    projectPreview: projectPreviewTransport,
    events
  });

  return Object.freeze({
    client,
    botIdentity,
    navigation,
    ownerBinding,
    previewChannelBinding,
    publicationTargets,
    publications,
    serviceMessages,
    linkRelations,
    topics,
    runtime,
    previewController,
    projectPreviewTransport,
    core
  });
}
