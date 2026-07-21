# SillyTavern Prompt Assembly Clean-Room Research

Research date: 2026-07-06

Purpose: capture prompt assembly architecture and behavior patterns that can inform RoleAgent Tavern. This document is a clean-room summary. It does not contain copied SillyTavern source code, implementation text, secrets, request headers, or provider credentials.

## Scope

This research focuses on how a roleplay chat application can assemble an OpenAI-compatible message list from:

- a base roleplay preset
- user persona context
- character card fields
- active worldbook entries
- example dialogues
- chat history
- near-generation notes
- the current user message

It intentionally avoids copying SillyTavern source code. RoleAgent implementations should use local project types, local helpers, and clean-room code.

## High-Level Architecture

SillyTavern-style prompt assembly is best understood as a pipeline, not a single string concatenation step.

1. Collect character card fields and apply safe macro replacement.
2. Collect optional user/persona context.
3. Select relevant worldbook entries based on recent conversation text.
4. Convert example dialogues into prompt messages or compact style guidance.
5. Fit recent chat history into a context budget from newest to oldest.
6. Add near-generation instructions such as author notes or post-history instructions.
7. Send an ordered list of role-tagged messages to the model provider.

The important clean-room takeaway is that prompt sections should be explicit, ordered, and individually skippable when empty.

## Prompt Message Structure

A robust MVP should prefer multiple messages over one large system blob:

- system messages for base roleplay guidance and character context
- user and assistant messages for real chat history
- optional system messages for worldbook entries and example dialogue guidance
- final user message for the current turn

This structure keeps responsibilities clear and makes debugging safer. It also lets RoleAgent apply budget rules to history without accidentally removing character identity or active worldbook context.

## Recommended Assembly Order

For RoleAgent Tavern, a practical clean-room order is:

1. base roleplay preset
2. user persona, if present
3. character identity and name
4. character description
5. character personality or persona fallback
6. character scenario
7. character system prompt, if present
8. active worldbook context
9. example dialogues, if present
10. trimmed recent chat history
11. author's note, if present
12. post-history instructions, if present
13. role boundary reminder, if used
14. current user message

Keeping the current user message last makes the immediate task clear while still placing high-impact guidance close to generation time.

## Character Card Fields

High-impact fields for roleplay quality:

- name: used for identity and macro replacement
- description: durable character facts
- personality: behavioral and voice guidance
- scenario: current setting and situation
- first message: best stored as the first assistant message in a new conversation
- message examples: useful as few-shot style guidance
- system prompt: optional character-specific override or extension
- post-history instructions: high-priority guidance near the generation point

Creator notes are better treated as metadata by default. They can be displayed in UI but should not enter the prompt unless RoleAgent intentionally adds a setting for that behavior.

## Macro Replacement

Minimum useful macros:

- `{{char}}`
- `{{user}}`
- `{{persona}}`
- `{{date}}`
- `{{time}}`

Replacement should be pure string substitution. It should not evaluate code, execute templates with side effects, or support unsafe dynamic behavior. Unknown macros can be left unchanged so imported cards do not lose information.

Macro replacement should be applied consistently to:

- roleplay preset
- user persona
- author's note
- character fields
- worldbook content
- example dialogue content
- chat history
- current user message

## Worldbook Activation

A clean-room MVP does not need the full SillyTavern worldbook feature set. The useful minimum is:

- constant entries are always active
- non-constant entries activate when any configured key appears in recent chat text
- scan the current user message plus the last few history messages
- sort active entries by an explicit order field, then by stable source order
- enforce a character budget so worldbooks cannot crowd out core prompt sections
- skip entries with empty content

Out of scope for the MVP:

- recursive activation
- cooldown or sticky behavior
- weighted random selection
- secondary key logic
- depth injection
- model-provider-specific formatting

## History Budgeting

History should be trimmed only for the prompt being sent. Database messages and UI-visible chat history should remain unchanged.

Recommended MVP behavior:

- reserve space for preset, character context, active worldbook content, notes, and the current user message
- keep recent history from newest to oldest
- drop older messages when the budget is exceeded
- never drop the current user message
- never let old history remove core character context

A character-count budget is acceptable for the MVP because it avoids adding tokenizer dependencies.

## Example Dialogues

Example dialogues are one of the most useful roleplay-quality signals. A safe MVP can:

- split imported examples on `<START>`
- apply macro replacement
- inject each useful block as style guidance
- optionally parse simple speaker prefixes when that is low-risk

The MVP does not need a complete parser for every imported card format.

## Author's Note And Post-History Instructions

These sections are most useful near the generation point.

Recommended RoleAgent placement:

- history first
- author's note after history
- post-history instructions after author's note
- current user message last

This keeps the current user request clear while giving near-generation guidance strong influence.

## RoleAgent MVP Implications

The highest-value RoleAgent improvements are:

1. Persist editable Prompt Settings separately from LLM connection settings.
2. Feed Prompt Settings into all generation paths: send, stream send, regenerate, and stream regenerate.
3. Use a stable multi-message prompt builder.
4. Support user name and persona macros.
5. Keep worldbook activation selective and budgeted.
6. Keep history trimming prompt-local.
7. Preserve existing chat controls and streaming behavior.

## Explicit Non-Goals

RoleAgent should not attempt to clone a full prompt manager in this MVP. The following remain out of scope:

- multi-preset management
- prompt debug UI
- automatic summarization
- system-message squashing
- depth injection
- complex tokenizer budgeting
- provider-specific request transformations
- copied source code from other projects

## Safety Notes

Prompt settings are user-editable context, not credential storage. They should never include secrets or provider request metadata. Logging should remain summary-oriented and should not print full upstream request payloads or sensitive configuration.
