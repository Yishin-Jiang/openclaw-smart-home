---
name: ha-camera-snapshot
version: "1.1.0"
description: >
  Check connectivity or capture and inspect a fresh still image from the Aqara
  G350 living-room camera through Home Assistant. Use when the user asks if the
  camera is online, asks to look at the living room, check what the camera sees,
  determine whether someone appears present, or visually verify lighting.
author: local
tags:
  - home-assistant
  - camera
  - snapshot
  - aqara
  - vision
---

# Home Assistant Camera Snapshot

Use this skill only for an explicit user request to inspect the living-room
camera. An ambiguous request such as "幫我看看客廳" is not sufficient
authorization by itself; ask for confirmation before retrieving an image. A
request that clearly asks to obtain, display, or analyze one fresh/current
snapshot authorizes only that single retrieval. Do not capture images
proactively or on a schedule.

## Fixed Local Configuration

- Camera: Aqara G350
- Home Assistant entity: `camera.aqara_g350`
- Capture script:
  `~/.openclaw/workspace/skills/ha-camera-snapshot/snapshot.sh`
- Metadata-only status script:
  `~/.openclaw/workspace/skills/ha-camera-snapshot/status.sh`
- Script default output: `/tmp/g350.jpg` (manual testing only)
- Vision-safe temporary output:
  `~/.openclaw/workspace/skills/ha-camera-snapshot/cache/g350.jpg`
- Token file: `~/.config/openclaw/ha_token`

Never print, quote, summarize, transmit, or include the token in a response.

## Choose the Correct Workflow

- For Home Assistant entity metadata questions, use only the metadata workflow.
  Do not capture or inspect an image. Do not use `idle` alone as proof that the
  physical G350 is online.
- For questions about current visible contents, people, objects, or room
  lighting, use the snapshot analysis workflow.
- For requests that only ask to get, show, send, or receive a snapshot, use the
  snapshot delivery workflow. Capturing an image does not by itself authorize
  or require visual analysis.

## Metadata-Only Status Workflow

Run:

```bash
"$HOME/.openclaw/workspace/skills/ha-camera-snapshot/status.sh"
```

Interpret `reachable: true` only as confirmation that Home Assistant returned
usable entity metadata. It does not prove that the physical G350 is online.
Interpret `unavailable` or `unknown` as not currently available. Because G350
is not paired like an ordinary Home Assistant device and may remain `idle`
after it goes offline, describe `idle` as metadata only. For the website's
online/offline result, use its G350 stream-probe status flow instead of this
metadata-only script. Report `last_updated` when useful, but never infer current
connectivity from an earlier update or successful snapshot.

## Snapshot Capture

1. Run the capture script with the execution tool and explicitly write into
   the private, vision-accessible workspace cache. Set a two-minute automatic
   cleanup timer so no separate cleanup tool call is needed:

   ```bash
   HA_SNAPSHOT_TTL_SECONDS=120 \
     "$HOME/.openclaw/workspace/skills/ha-camera-snapshot/snapshot.sh" \
     "$HOME/.openclaw/workspace/skills/ha-camera-snapshot/cache/g350.jpg"
   ```

2. Continue only if the command exits successfully and reports a JPEG image.
After a successful capture, choose exactly one of the following workflows from
the user's request. Do not automatically analyze every captured image.

## Snapshot Delivery Workflow

Use this workflow when the user asks only to get, show, send, provide, attach,
or receive the snapshot.

1. Do not call the image-reading or vision tool.
2. Include the newly captured file as a `MEDIA:` attachment.
3. Reply briefly that the latest snapshot was obtained. Do not describe people,
   objects, lighting, or room conditions because the image was not analyzed.

## Snapshot Analysis Workflow

Use this workflow only when the user asks what is visible, whether someone is
present, requests a description or judgment, or asks about visible lighting.

1. Inspect the vision-safe temporary output with the available image-reading
   or vision tool. Always use the newly captured image, never an earlier
   description or stale session memory.
2. Prepare a concise user-visible description containing only what can
   reasonably be seen in that single frame. Clearly state uncertainty caused
   by darkness, blur, occlusion, glare, or limited view.
3. If capture or image inspection fails, report the failure plainly. Never
   invent a person, object, activity, device state, or scene detail.
4. Do not include a `MEDIA:` attachment unless the user explicitly asks to
   receive the image. The capture script's timer handles deletion automatically;
   do not make a separate cleanup tool call after image analysis.
5. Immediately after the image tool returns, send the prepared description as
   ordinary visible response text. Never use `NO_REPLY` for a snapshot request.

If the user explicitly requests both delivery and analysis, perform the
snapshot analysis workflow and also include the new file as a `MEDIA:`
attachment.

## Interpretation Rules

- "客廳現在有人嗎" means report whether a person is visibly present in this
  frame. It is not proof that the entire room is empty.
- "客廳燈有開嗎" and equivalent generic room-light questions require two
  sources: call Home Assistant MCP Live Context for the authoritative state of
  `light.moes_matter_light`, and inspect a fresh frame for visible illumination.
  Report them separately. The room also has an ordinary ceiling light with no
  HA entity, so MOES `off` does not mean the room is dark, and a bright frame
  does not prove the MOES bulb is on.
- "幫我看看客廳" means give a brief description of visible, non-sensitive
  conditions without attempting identity recognition.
- Do not identify or guess the identity of a person from the image.
- Do not forward or persist the image outside the local VM unless the user
  explicitly asks.

## Error Meanings

- HTTP 401: the Home Assistant token is invalid or expired.
- HTTP 404: the camera entity or endpoint is unavailable.
- HTTP 500: Home Assistant could not produce the snapshot.
- Non-JPEG output: reject the file and do not analyze it.

The script writes through a temporary file and only replaces the requested
output after both HTTP and JPEG validation succeed. With
`HA_SNAPSHOT_TTL_SECONDS`, it deletes only the same captured file instance, so
an older timer cannot delete a newer snapshot written to the same path.
