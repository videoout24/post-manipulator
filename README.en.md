# Post Manipulator

**English** · [Русский](README.md)

Post Manipulator is a practical MVP for composing, publishing, and managing
interconnected posts. It is built around Telegram capabilities and requires
neither a deployed backend nor paid hosting.

## Features

- compose and edit Rich Messages;
- save groups of blocks as reusable custom templates;
- quickly change the order and nesting of blocks in a message;
- manage projects, drafts, publications, and media;
- schedule regular drafts and Projects (the internal abstraction for linked
  posts), and edit them after publication;
- assemble posts from blocks taken from drafts, publications, and Project posts
  using the internal collector;
- create cross-links in the editor to published messages in bot-accessible
  channels and groups, with automatic link resolution during publication;
- receive media from the linked owner through the bot;
- display a live preview in a separate private channel;
- delete accessible Bot API service messages from the owner's private chat and preview channel;
- create and restore IndexedDB backups through Telegram;
- import `.csv` and `.md` tables into native Rich Message blocks;
- import LaTeX formula templates from prepared `.json` files;
- use any AI model to generate a post through the `handleCopyPaste` protocol:
  export structured AI JSON, pass it to the model, and apply the response
  through copy/paste or a local `.json` file.

## Project import and test set

The **Import** button in the Projects section adds a project from a `.json` file
to the current IndexedDB database. Multiple files can be selected at once: one
file normally contains one project, while a `rich-current-projects` bundle can
contain several. Import does not clear the database; an ID collision produces a
new ID and creates a project copy. Publication state, scheduling, and Telegram
`chat_id` / `message_id` values are always reset so an imported project cannot
control messages from its source environment.

A ready-made load-test set is available in
[`data/test-projects`](data/test-projects): 20 separate projects with 10 posts
each, at least 5 content blocks in every post, a map in the starting post, and
10 images from [`assets/test-projects`](assets/test-projects). All projects can
be loaded at once from
[`data/test-projects-bundle.json`](data/test-projects-bundle.json). Rebuild the
deterministic set with:

```bash
node scripts/generate-test-projects.mjs
```

## Intentionally out of scope

Direct AI API integration is intentionally absent: the tool is primarily
designed for working with author-written text. The editor could be extended with
a connector to a specific AI provider's API, but that would effectively defeat
the whole idea—the enjoyment of expressing your own thoughts instead of
generating everything.

## AI JSON: requests without requiring an AI API

Every block on the Canvas has a collapsible **AI prompt** field directly below
its title and buttons. A request can allow changes to the entire block or to only
one of its fields. The instruction is stored in the service object `node.ai`,
survives in the AST after a response, and is not included in the Telegram Rich
Message when it is published.

The `AI JSON` button creates a portable `rich-current-ai-draft` package containing:

- the ID and version of the source draft or Project post;
- either the complete structured AST or the target block's local context;
- the exact permitted change scope (`message`, `block`, or `field`);
- block instructions and a contract requiring the complete JSON to be returned without structural changes;
- `task.blockSchemas`, the expected `props` and `children` shapes derived from
  the block and property registries. Each encountered block type is described
  once: for example, three lists share `task.blockSchemas.list`, while two tables
  share `task.blockSchemas.table`;
- `task.richTextSchema`, the single description of accepted Rich Text value shapes;
- `task.formatSets`, the unique Rich Text format sets. Text properties use a
  short `formatSet: "f1"`, so neither value representations nor format lists are
  repeated across heading, table, and caption schemas.

The package contains only internal application identifiers: `request.id`, the
draft/project/post IDs, and AST block IDs. It does not include `chat_id`,
`message_id`, a channel ID, or the ID of an edited Telegram publication.

The `Block AI JSON` button always creates an isolated package containing only
the target block and its nested content and uses only that block's prompt. Every
regular draft card and the active Project post card always show a
**Whole-draft prompt** or **Whole-post prompt** section, regardless of whether
Canvas blocks have their own AI prompts. The field uses the full width of the
card and shares the editor's common height
sizing behavior: by default it fits the hint's line count, then grows with its
content and remembers a manually selected height for the current session. The
compact `{}` button that opens the document
AI JSON lives in the card's shared action group. This separate prompt receives
the complete AST and can describe relationships between blocks, such as filling
a list and the paragraphs that follow it. When the document prompt is empty,
only the local block prompts apply. For a selected regular draft, **Close** saves
it and clears the Canvas.

The package can be copied or downloaded and then passed to any AI model. Paste
the response manually into the AI JSON field with the operating system's normal
Paste command, or select a local `.json` file. **Apply response** validates the
complete package; an invalid response opens a dialog with the reason while the
original text remains available for correction. Because of CORS constraints,
the application does not send JSON through the bot, read responses from chat, or
provide a separate clipboard-reading button. Any JSON document received by the
bot is ignored and is not added to Gallery. **Open bot** remains available as a
separate navigation action. A future AI API integration can use the same package
and importer without changing the draft format.

An isolated response is applied only to the permitted block or field. If the
source version changed after export, the application shows a conflict dialog
instead of changing data automatically. The owner can apply the response to the
current version, create a separate draft, or cancel without changing anything.
A response for the entire message is still imported as a separate draft.

For Animation, Audio, Document, Photo, Video, and Voice note blocks, AI can
return a direct public HTTPS URL that Telegram loads when sending the message.
In blocks backed by Gallery, the external URL and internal resource are mutually
exclusive: entering a URL clears `galleryId` and the Telegram `file_id`, while
selecting a Gallery resource clears the URL. The link must point directly to a
file with the correct MIME type and may be temporary, so Gallery is preferable
for durable publications. Under the general Bot API rules, URL uploads are
limited to 5 MB for photos and 20 MB for other files; documents are guaranteed
for PDF and ZIP, and voice messages for OGG up to 1 MB. See the
[Telegram Bot API](https://core.telegram.org/bots/api#sending-files) for details.

## Map block

The Map block extracts latitude and longitude from any text or link without
identifying a provider. Arbitrary surrounding text and separators are accepted;
`lat`/`lon` or `latitude`/`longitude` labels allow the values to appear in either
order. Inputs without coordinates, including short redirect links, are rejected
because the static application cannot follow a redirect to its final address.
Zoom is limited to `1–20`. Pixel dimensions are not edited directly; the
**Landscape 2:1** and **Portrait 1:2** buttons are converted into
[Telegram InputRichBlockMap](https://core.telegram.org/bots/api#inputrichblockmap)
compatible `width` and `height` values. Location accuracy is not used.

## Internal block collector

Every author-controlled block has a diamond toggle immediately before its title
in the Canvas header. Enabling it adds a neon border and stores a persistent internal reference to the source
draft or Project post and the block ID. Blocks can be collected while browsing
different posts and drafts.

Next to **Drafts**, **Insert buffer** appends independent copies of all collected
blocks to the current Canvas. Copies receive new internal IDs and keep their
nested content; inserting does not clear the collector. **Clear buffer** removes
all references and resets the active block toggles. Both commands have a neon
border while the buffer is non-empty. Project-managed Map and Back
to Map blocks are excluded because their identities and relations are maintained
by the Project structure.

The collector validates its references whenever the current tree, a draft, a
post, or a project changes. Deleting an original block, its post, its draft, or
its project automatically removes stale references. A full validation also runs
immediately before insertion.

The selector to the right of **Clear buffer** controls automatic active-block
positioning: `0` disables scrolling, `1` is slow, `2` is approximately half the
former speed and is the default, and `3` is the former speed. The preference is
stored locally for the entire editor.

## Why there is no backend

The MVP does not need a backend. It is intended for one owner working with their own bot, while Telegram already provides the required capabilities: Mini Apps, CloudStorage, the Bot API, and a private bot chat for backups. This allows free static hosting and avoids creating a separate server-side database containing the token.

This design has several limitations:

- long polling works only while Post Manipulator is open and running in Telegram Desktop;
- the bot must not have an active webhook because Telegram does not allow webhooks and `getUpdates` at the same time;
- the application does not replace server automation, background jobs, or collaboration between multiple operators;
- only use a trusted, published copy of the application when entering a token.

A future backend is planned as an independent optional service rather than a mandatory centralized component. Its purpose would be to remove client-only limitations while keeping deployment and operating costs low.

## Scheduled publication limitations

Project posts are scheduled in order: every predecessor must be published or
scheduled, and the next time cannot be earlier than its predecessors. Equal
times are allowed and send posts sequentially, starting with the project map.
Immediate publication still requires all predecessors to be published. Cancel
schedules from the end; moving a predecessor later requires adjusting any
earlier successor schedules first.

Schedules are stored in the local IndexedDB database. While the Mini App is open, a timer starts the publication. A closed static application cannot run background jobs: if a scheduled time has already passed, the post is sent immediately after the next successful launch. After a temporary failure, the service retries once per minute while the application remains open. Scheduling is therefore not a server-side job system and depends on the local database remaining available, a valid Bot API token, and access to the selected chat.

## Main modules

| Directory / module | Purpose |
| --- | --- |
| `js/bootstrap.js`, `js/security/` | Secure sign-in: Telegram Desktop and `initData` verification, first launch, password handling, CloudStorage, and token encryption. While a password or token is being checked, the form is replaced by a blocking progress state. |
| `js/app.js`, `js/app/` | Assembles application domains, UI, and lifecycle; starts only after a successful security bootstrap. |
| `js/editor/`, `js/blocks/`, `js/core/` | Rich Message editor: block tree, properties, formatting, validation, change history, and workspace. |
| `js/project/` | Projects made of connected posts: model, relation graph, compilation, preview synchronization, and publication. |
| `js/telegram/` | Bot API integration: long polling, owner, preview channel, publications, navigation, and Telegram transport. |
| `js/gallery/` | Receives owner media, stores metadata, and caches thumbnails. |
| `js/storage/` | IndexedDB, database-state inspection, and Telegram backups. |
| `js/i18n/` | Shared `t("key")` function, `ru` / `en` dictionaries, Telegram locale selection, and localization of the early secure-launch screen. |
| `js/links/`, `js/publications/` | Relations between posts and the publication user interface. |
| `tests/` | Independent smoke tests for the main user and security scenarios. |

## Implementation overview

Post Manipulator is a static client-only application. It can be hosted on GitHub Pages or any HTTPS host without an application server.

| Component | Runtime and responsibility |
| --- | --- |
| Interface and editor | Runs entirely in the Telegram Desktop browser environment. The site consists of static HTML, CSS, and JavaScript files. |
| Local data | A separate `post-manipulator-bot-<botId>` IndexedDB database is created for every Publisher Bot ID. It stores projects, drafts, settings, preview state, and non-secret bindings. |
| Bot API token | Never saved to IndexedDB. After the first launch, the token is encrypted with a password and stored in Telegram CloudStorage; the decrypted token exists only in the memory of the active session. |
| Telegram integration | The browser calls the Telegram Bot API directly. `TelegramRuntime` receives updates through long polling, while other modules publish, edit, and delete messages. |
| Owner binding | Signed `initData` immediately binds the Mini App user to the local database. Pressing Start in the private bot chat is required only to let the Bot API send messages to the owner and receive media from them. |
| Backups | A backup of the current local storage is sent as a pinned document to the owner's private bot chat. On every launch, the application checks the newest pinned entry by its send date and offers recovery when the backup is newer than the local database. |

### Threat model and residual risks

The design protects the Bot API token at rest, but it does not turn Telegram WebView into trusted hardware and does not encrypt working data. Secure launch verifies Telegram's Ed25519 signature, the Bot ID, and the age of `initData` when the security session opens—a maximum of 30 seconds. Once the launch has been accepted, password entry is not limited by that window. The token is stored in CloudStorage as an AES-256-GCM container with separate salt and IV values; its key is derived from the password using PBKDF2-SHA-256 with 600,000 iterations. Telegram isolates CloudStorage by the bot-and-user pair, so the fixed `rmb_token_v2` key, Bot ID, and User ID are not secrets.

The model assumes a trusted operating system and Telegram Desktop installation, the exact HTTPS origin configured in BotFather, and unmodified application JavaScript. If any of these conditions is compromised, the cryptographic container alone cannot protect the application.

Storing the encrypted token in CloudStorage is a convenience for repeated sign-in, not a requirement for Bot API access. A session-only mode could request the token at every launch and never create a cloud container. That would reduce the number of persistent token copies and remove the risk of offline password guessing against the container, but it would not solve the main active-session risk: after entry, the token still exists in WebView memory and is used in Bot API request URLs. Avoiding CloudStorage therefore changes convenience and at-rest protection, but does not protect against compromised JavaScript, WebView, or a compromised device during use.

A stricter operating procedure is possible without disabling CloudStorage. After finishing work, the owner can manually regenerate the token through `@BotFather`. The stored container then holds an invalid token and cannot grant bot access even if its password is recovered. On the next launch, the application receives `401`, asks for a new token belonging to the same bot, verifies the Bot ID and signed `initData`, and replaces the container. The existing IndexedDB database for that bot remains on the device; if browser storage has been cleared, it must be restored from a backup as usual. This approach limits the useful lifetime of a stolen token, but cannot undo actions already performed with it or remove previously downloaded thumbnail bytes from the WebView HTTP cache.

| Risk | What can happen | Owner mitigation |
| --- | --- | --- |
| Site replacement, XSS, or third-party JavaScript | Any script running on the page, including `telegram-web-app.js`, can access the password form, decrypted token, CloudStorage, and IndexedDB. Compromise of the hosting account, GitHub account, WebView, or a browser extension bypasses encryption. | Use only the exact trusted URL, protect the account and publication branch, review changes before deployment, and never enter a token into untrusted copies. |
| Token exposure during an active session | After sign-in, the token is a string in memory and appears in Bot API URLs such as `https://api.telegram.org/bot<token>/...`. Thumbnail URLs also enter the DOM and browser HTTP cache. A debugger, malicious process, or injected script can read it; clearing JavaScript references does not guarantee physical memory erasure. | Use a dedicated bot with minimal permissions. If exposure is suspected, regenerate the token immediately through `@BotFather`: anyone holding the token has full control over the bot and every chat it can access. |
| Offline password guessing | A stolen CloudStorage container allows password guesses to be checked against the AES-GCM authentication tag without server-side rate limiting. PBKDF2 slows attacks, but cannot compensate for a short or dictionary password; the minimum requirement of eight characters, one letter, and one digit does not guarantee sufficient entropy. | Use a unique long passphrase or a password-manager-generated password that is different from the Telegram password. |
| Unencrypted local data and backups | IndexedDB and exported JSON are not encrypted. A backup does not contain the Bot API token, but it does contain projects, drafts, settings, Telegram chat/file IDs, and bindings. Anyone with access to the WebView profile, Telegram account, private bot chat, or downloaded file can read it. | Protect the device with a local password, enable a Telegram passcode and two-step verification, delete unnecessary downloaded copies, and do not store data requiring end-to-end encryption in the editor. |
| Backup substitution | JSON is checked for format compatibility, but is not signed, has no MAC, and completely replaces the local database when imported. A crafted file can replace content, settings, and Telegram bindings or attempt to exploit a rendering bug in imported data. | Restore only your own backups created by this bot; never accept backup files from third parties. |
| Compromised Telegram account or device | Another Telegram account cannot access the backup. The risk begins when an attacker gains an authorized session for the owner's account: the private bot chat is an ordinary Telegram cloud chat, so its messages and pinned JSON synchronize across that account's devices. CloudStorage contents are not shown in the Telegram UI; JavaScript running as the same bot-and-user pair can request the encrypted container, but cannot recover the token without the password. If the Mini App is already unlocked on a compromised device, the token and local database are available in the active WebView. | Regularly review active Telegram sessions, enable two-step verification and a local passcode, and terminate unknown sessions. |
| Limits of client-only verification | The `initData` signature proves that the data came from Telegram and has not been altered, but verification happens in the same WebView. It is not device attestation, a server session, an audit system, or remote revocation. Captured valid `initData` can open a security session only inside the 30-second window, although it still cannot decrypt the token without the password. An already accepted session may remain open longer. | Do not treat Telegram verification as protection against someone controlling a compromised device. Move authentication and the Bot API token to a backend for multi-user or server-side scenarios. |
| Loss of availability | IndexedDB can be cleared by the client, CloudStorage or the Bot API can become temporarily unavailable, and a pinned backup can be deleted or replaced. Encryption does not protect against data loss. | Create backups after important changes, periodically store copies elsewhere, and test the recovery process. |

Telegram documents CloudStorage scoping and signed `initData` verification in the [Mini Apps documentation](https://core.telegram.org/bots/webapps#cloudstorage) and [third-party validation guide](https://core.telegram.org/bots/webapps#validating-data-for-third-party-use). According to Telegram's documentation, anyone who obtains a Bot API token gains [full control over the bot](https://core.telegram.org/bots#how-do-i-create-a-bot).

### Backup inspection and recovery

Telegram allows several pinned messages. The Bot API `getChat` method returns the newest one by send date, so that message is used as the candidate for automatic recovery. If the newest pinned item is not a backup, the Bot API cannot enumerate older pinned messages. The required JSON file can still be restored manually under **Settings → Backups**. See [`ChatFullInfo.pinned_message`](https://core.telegram.org/bots/api/#chatfullinfo).

Freshness is determined by comparing the pinned document's server-side send date with the latest modification time of content records in local IndexedDB. The check runs after secure sign-in but before the editor starts, for both empty and populated databases. The application never overwrites data automatically: it displays an offer, the user downloads the selected JSON from Telegram, and recovery requires explicit confirmation. Import completely replaces the local database, remembers the applied backup, and continues startup on the same page without `reload`. As a result, a Linux WebView that resets IndexedDB no longer traps recovery in a loop.

The Bot API lets a bot obtain a path for files up to 20 MB through `getFile`, but a static Mini App is not a server-side Bot API client. The Telegram file endpoint does not allow JavaScript to read its response through CORS, while `Telegram.WebApp.downloadFile()` only displays the system download dialog and does not return file bytes to the application. Without a separate backend, the user must therefore download the JSON once and select it in the recovery form. See [`getFile`](https://core.telegram.org/bots/api/#getfile) and [`downloadFile`](https://core.telegram.org/bots/webapps#initializing-mini-apps).

### Confirmed Telegram Desktop issue on Linux

In the tested Telegram Desktop Linux client, WebView storage is reset between restarts: IndexedDB is created correctly and works during the active session, but the local database is missing after reopening the Mini App. The same build has been confirmed to preserve IndexedDB across restarts on Windows. Telegram Desktop for macOS has not yet been tested. This is a Linux client WebView limitation, and the application cannot prevent deletion of its browser storage.

The encrypted Bot API token remains in Telegram CloudStorage, but projects, drafts, settings, and other local data must be restored from the latest backup. Until the Linux client is fixed:

- create a backup after meaningful changes;
- keep the current backup pinned in the private bot chat;
- after entering the password, restore the suggested latest backup: import runs before the application starts and does not trigger another page reload; when the local database is not empty, the application also offers the pinned backup if it is newer;
- use a tested Windows Telegram Desktop installation when persistent local storage is required.

A similar WebView storage reset in Telegram Desktop for Linux is tracked in [telegramdesktop/tdesktop#31051](https://github.com/telegramdesktop/tdesktop/issues/31051).

## Quick start

### 1. Prepare a bot and choose the Mini App address

Post Manipulator is not technically tied to a particular bot or hosting provider. You can use the project's published page or deploy the same codebase yourself; the remaining setup and first-launch flow are identical.

Create a bot through `@BotFather`. Once you have chosen an address, configure both **Main Mini App** and **Menu Button**. Main Mini App adds a launch button to the bot profile, while the menu button opens the application directly from the chat.

There are two deployment options:

**Option A — use the shared project page.**

After GitHub Pages deployment, configure this Mini App URL in BotFather:

```text
https://videoout24.github.io/post-manipulator/?build=1.11.1
```

Your bot token remains encrypted in Telegram CloudStorage, while application data stays in the local IndexedDB database for the selected bot. The page does not require a preconfigured Bot ID.

**Option B — deploy your own copy.**

Clone or fork the repository and publish it on GitHub Pages, Cloudflare Pages, Vercel, Netlify, or any other HTTPS host. For GitHub Pages:

1. Create a public GitHub repository, for example `post-manipulator`.
2. Connect the local directory to the repository and push the code:

   ```bash
   git branch -M main
   git remote add origin https://github.com/<your-username>/post-manipulator.git
   git push -u origin main
   ```

3. Open **Settings → Pages** in the repository.
4. Select **Deploy from a branch**, the `main` branch, and the `/(root)` directory.
5. The resulting address will look like this:

   ```text
   https://<your-username>.github.io/post-manipulator/
   ```

The only difference between these options is who controls updates to the page. Because the page receives a Bot API token, use only hosting and published code that you trust.

### Configure BotFather buttons

Once an HTTPS Mini App address is available:

1. Run `/mybots` in `@BotFather` and select your bot.
2. Set the URL as the **Main Mini App** in the **Mini App** settings.
3. In **Menu Button** settings, or with `/setmenubutton`, configure:
   - button text: `Post Manipulator`;
   - URL: the same HTTPS Mini App address.

Both settings use the same URL. The application can then be opened from either the bot profile or the chat menu.

### 2. First sign-in and owner binding

1. Open the bot chat in Telegram Desktop and press **Start**.
2. Open Post Manipulator through the Mini App button.
3. Create and confirm a password.
4. Enter the Bot API token for this bot.
5. The application calls `getMe`, obtains the Bot ID, verifies signed Telegram `initData`, and only then stores the user binding and encrypted token.

Telegram automatically isolates CloudStorage by the bot-and-user pair, so the encrypted token is stored under the shared `rmb_token_v2` key. Its value contains only the format version, PBKDF2 salt/iterations, and AES-GCM IV/ciphertext—no plaintext Bot ID or User ID. After decryption, the application obtains the Bot ID through `getMe`, verifies the `initData` signature, and only then opens `post-manipulator-bot-<botId>` IndexedDB. Neither the password nor the token is saved to IndexedDB.

### 3. Link a preview channel

Only after the first successful sign-in, create a **private channel** (not a group) and add the bot as an administrator. Grant permission to post, edit, and delete messages.

Administrator permissions are configured when adding the bot to the specific channel, not in BotFather. For automatic binding, keep only the current owner and the bot in that channel.

The channel is linked automatically when all of these conditions are true:

- the channel is private;
- the bot is an administrator;
- the current owner is a channel member;
- the channel has exactly two members: the owner and the bot.

After binding, the application creates and pins a service message for live preview. If these conditions are not met, use manual binding with a confirmation code in Settings.

## Updating the site

After making changes:

```bash
git add <files>
git commit -m "Describe the change"
git push
```

GitHub Pages updates the site automatically.

GitHub Pages and Telegram Desktop may retain an older `index.html`. Increase the `build` query parameter in the BotFather Mini App URL after every release, for example `?build=1.11.1`. The parameter must match for Main Mini App and Menu Button; a `#fragment` cannot be used for this purpose. GitHub Pages cannot fully disable this cache. A host that supports a controlled `Cache-Control: no-store` header, such as Cloudflare Pages, is required for that.

## Local verification

Run smoke tests with Node.js:

```bash
for test_file in tests/*_smoke.mjs; do node "$test_file"; done
```

For the browser theme check, run `python3 -m http.server 8000` and open
`http://localhost:8000/tests/theme_browser_smoke.html` in a regular browser.
The console reports `theme_browser_smoke: OK`; details are in
`window.themeSmokeResult`. This isolated UI fixture does not connect a bot.
Use `showThemeFixture("light", "settings")` for visual checks; `dark` and the
`editor` / `gate` pages are also available.

The complete authorization and Telegram CloudStorage flow can be tested only in Telegram Desktop. Never publish the Bot API token in source code, commits, or GitHub Pages settings.
