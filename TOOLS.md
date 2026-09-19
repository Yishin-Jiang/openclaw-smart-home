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
- `switch.smart_wi_fi_plug` — TP-Link Tapo P110M 智慧插座（device_class: outlet）
- `camera.aqara_g350` — 客廳 Aqara G350 攝影機；即時狀態由 HA MCP 查詢，畫面由本機 `ha-camera-snapshot` skill 取得
- 客廳一般天花板燈（無 HA entity）— 非智慧燈，Home Assistant 無法查詢或控制，只能從攝影機畫面判斷房間是否受到照明

### Distinguish Smart-Light State from Visible Room Lighting

The MOES Matter bulb and the ordinary ceiling light are separate physical lights. Never treat either one as the state of the other.

- For a generic question such as 「客廳燈有開嗎？」, MUST use both `GetLiveContext` and one fresh `ha-camera-snapshot` image.
- Report the two observations separately: (1) the authoritative HA state of `light.moes_matter_light`, and (2) whether the room visibly appears illuminated in the camera frame.
- MOES `off` does not mean the room is dark; the ordinary ceiling light may be on. A bright frame does not prove the MOES bulb is on.
- The ordinary ceiling light has no HA entity, so describe its apparent visual state with appropriate uncertainty and never claim it was queried or controlled through HA.

### Scenes (confirm in `GetLiveContext`, then activate with `HassTurnOn`)
- `scene.yue_du_mo_shi` ("閱讀模式") — light.moes_matter_light 調到約70%亮度(178/255)、暖色溫4000K。適用指令：「我要看書了」「閱讀模式」「看書燈光」
- `scene.ju_yuan_mo_shi` ("劇院模式") — light.moes_matter_light 開啟並調至約10%亮度(26/255)，Smart Wi-Fi Plug 維持原狀。適用指令：「劇院模式」「電影模式」「我要看電影」
- `scene.jie_neng_mo_shi` ("節能模式") — 關閉 light.moes_matter_light 與 Smart Wi-Fi Plug；G350 攝影機維持監控。適用指令：「節能模式」「離家模式」「我出門了」「全部關掉」

### Departure Verification Workflow

- For 「我要出門了，幫我確認家裡狀況」「離家檢查」「啟動離家模式並確認設備」, read and follow `skills/ha-departure-check/SKILL.md`.
- This is more than a scene alias: it must activate 節能模式, verify the MOES light and P110M outlet with fresh MCP context, check G350 metadata, and send one final summary.
- A normal departure check does not authorize a camera snapshot. Only perform the optional visual step when the request explicitly asks to look at the room.
- Never imply that the ordinary ceiling light was turned off; it is not connected to Home Assistant.

<!-- 新增更多場景時，比照上面格式繼續往下加 -->

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

### Camera Snapshot and Confirmation Policy

The MCP allowlist has no camera image tool, but the local `ha-camera-snapshot` skill can securely retrieve one fresh JPEG from the Aqara G350 through Home Assistant. Follow that skill whenever the user explicitly asks to inspect the current room image.

1. An action-oriented request such as 「客廳現在有人嗎？」「幫我看看客廳」「客廳燈有開嗎？」 or 「取得客廳最新畫面」 is itself explicit authorization for one fresh snapshot. Do not ask for a second confirmation.
2. A loose mention of "camera"/「監視器」/「畫面」/「看看」 that does not request current visual information is not authorization. If intent is ambiguous, ask whether the user wants a fresh snapshot.
3. For an authorized snapshot request, read and follow `skills/ha-camera-snapshot/SKILL.md`. Never improvise another credential, endpoint, output path, or retention policy.
4. Camera online/offline or connection questions are metadata-only and do not authorize a snapshot. Read the same skill and run its `status.sh`; if the camera is absent from `GetLiveContext`, do not infer connectivity from an earlier snapshot.
5. Do not identify people. Report only whether a person is visibly present in the single frame, and state uncertainty when visibility is limited.
6. For 「客廳燈有開嗎？」 and equivalent generic room-light questions, follow the lighting-source distinction above and use both MCP state and visual evidence.
