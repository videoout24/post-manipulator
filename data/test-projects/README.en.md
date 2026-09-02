# Test projects

This directory contains 20 independent import files: one JSON file per project,
with 10 posts in each project. Select the required files using
“Projects → Import”; the file dialog supports multiple selection.

Each post contains a required heading, at least five randomly arranged content
blocks, and a structural project block. The heading is always first, the map or
backlink is directly below it, and the footer (when present) is always last. The
first post contains a map of the remaining nine posts, while every other post
contains a backlink to that map.

The combined bundle is located one level above at
`data/test-projects-bundle.json`. Do not import it together with the individual
files unless you intentionally want duplicate copies of the same projects with
new IDs.

To regenerate the fixtures, run:

```bash
node scripts/generate-test-projects.mjs
```
