# The Playbook lives in the repository; Artifacts reference a Playbook edition

The Playbook (Templates, Plain Russian, `GLOSSARY.md`, Tutor and Methodologist instructions, code Checks) is plain files under `content/` in this repository, changed by pull request at the Team's request. A Playbook edition is the content hash of `content/`; Processing fixes the current edition when it starts and every Artifact stores it, so results on reference materials can be compared edition against edition.

**Why:** no editor to build or host now, and git already gives history, diffs and rollback. The edition reference is the part that is expensive to retrofit, so it goes in from the first feature.

**Considered options:** a CMS (Payload, EmDash, SonicJS, git-based CMSs, hosted ones) brings a second login and its own schema, and none of them models "an Artifact remembers its edition". When the Team needs an editor in the UI, the planned path is our own D1 tables with immutable versions and a CodeMirror page behind the Team role (`docs/research/content-editor.md`).
