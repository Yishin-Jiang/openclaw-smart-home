# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup: camera names and locations, SSH hosts and aliases, preferred TTS voices, speaker/room names, device nicknames, anything environment-specific.

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)

## Home Assistant

Home Assistant state and control go through the configured `homeassistant` MCP server using the Home Assistant Assist API at `/api/mcp`.

For every home-related request, call `GetLiveContext` first and treat its exposed entities and current states as the source of truth. Only operate on entities exposed by Home Assistant. Never invent a device, scene, or state when no matching entity exists.

The OpenClaw MCP tool allowlist intentionally contains only:

- `GetLiveContext` — read the current exposed home context.
- `HassTurnOn` — turn on an exposed device or activate an exposed scene.
- `HassTurnOff` — turn off an exposed device.
- `HassLightSet` — adjust an exposed light.

The device and scene entries below are contextual hints for local names, aliases, and intent. Entity availability and current state always come from MCP Live Context, so a stale note must not override Home Assistant.

**Important**: if a request sounds like it could relate to home devices, lighting, temperature, or a "mode"/"scenario" (e.g. "我要看書了", "閱讀模式", "太熱了"), ALWAYS inspect `GetLiveContext` and the notes below before falling back to a generic (non-smart-home) interpretation. Do not assume "閱讀模式" or similar phrases refer to text-reading/TTS assistant features — this home has a literal HA scene for it.

### Devices
- `light.moes_matter_light` — 客廳 MOES Matter 燈泡
- `switch.smart_wi_fi_plug` — TP-Link Tapo P100M 智慧插座（device_class: outlet）

### Scenes (confirm in `GetLiveContext`, then activate with `HassTurnOn`)
- `scene.yue_du_mo_shi` ("閱讀模式") — light.moes_matter_light 調到約70%亮度(178/255)、暖色溫4000K。適用指令：「我要看書了」「閱讀模式」「看書燈光」

<!-- 之後插座/攝影機到貨、新增更多場景（劇院模式、節能模式）時，比照上面格式繼續往下加 -->

### Self-Updating Notes — How You Learn New Phrases

When a conversation reveals a new way the user refers to an existing scene/device, follow this exact protocol:

1. **Trigger condition**: the user's request sounds home-related (lighting/climate/mode/scenario) AND does not match any phrase already listed under Scenes/Devices above.
2. **Resolve, don't guess**: call `GetLiveContext` and check the contextual lists above for a plausible match. If nothing matches, tell the user honestly that no such exposed scene exists yet. Do NOT invent a mapping or silently pick the closest one.
3. **Confirm before writing**: if you find a plausible match, execute it with the matching MCP tool and verify the resulting state with `GetLiveContext` when applicable. Then ask in one short sentence, e.g. 「已經幫你開啟閱讀模式了，之後你說「OOO」我都可以理解成這個意思嗎？」 Only proceed to step 4 if the user confirms.
4. **Write it down** (only after confirmation): append the new phrase to the matching Scene/Device's existing 適用指令 list. Do not create a new entity, duplicate an existing entry, or reformat unrelated lines. Append only, using 、 as separator, keeping everything on the same 適用指令 line.
5. **Hard limits — never do these**:
   - Never call any `/api/config/*` endpoint or otherwise create/edit HA scenes, automations, or entities.
   - Never write to this file without the user's explicit confirmation from step 3.
   - Never remove or overwrite existing entries — append only.

**Worked example** (already done once, for reference):
User: 「我要看書了」→ matched reading_mode's existing phrases → executed `scene.yue_du_mo_shi` → phrase already covered, no new write needed.

### Never Go Silent After a Real Action

MCP tool results are visible to you but are **NOT automatically sent to the user** — only your own response is delivered. After executing any Home Assistant action, you MUST always produce your own final text reply confirming what happened, in your own words. This applies even if the tool already returned a clear confirmation — restate it yourself, do not assume it was already delivered.

**Never emit `NO_REPLY` after taking a real-world action.** Reserve `NO_REPLY` only for turns where you took no action and truly have nothing to add (e.g. a redundant heartbeat ping). If you catch yourself thinking "I already responded to this" right after a tool call in the same turn chain, that is a sign you are confusing the tool result with a delivered reply — write the reply anyway.

### Camera Actions Require Explicit Confirmation (Security Mitigation)

The previous third-party `home-assistant-skill` audit showed why generic camera trigger words are unsafe. The MCP allowlist currently exposes no camera snapshot tool. If camera tools are added later, the following confirmation policy still applies to the Aqara Camera Hub G350 via RTSP:

1. **Never call any tool that retrieves actual image/video content just because the word "camera"/"監視器"/"畫面"/"看看" appeared somewhere in the conversation.** A loose mention is not a request.
2. Before retrieving a snapshot, always confirm explicitly first, e.g.: 「你是想看客廳攝影機現在的畫面嗎？」 Only proceed after the user gives a clear yes/confirmation — same confirm-before-act pattern as the Self-Updating Notes protocol above.
3. Listing camera entities or online/offline metadata through `GetLiveContext` does NOT need confirmation — it is low-risk metadata only, not the sensitive part.
4. If a request is ambiguous about whether the user wants an actual snapshot vs. just camera status, default to asking — never default to pulling the image.
5. This rule exists because of a specific, documented audit finding, not general caution — do not relax it without the user explicitly revisiting this decision.
