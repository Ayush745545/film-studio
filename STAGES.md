# AI Film Studio — 15-Stage Production Pipeline

**Fifteen stages, one project. Each keeps its own state — generate, review, approve, then move on. Nothing is lost when you go back.**

---

## Stage Overview

| # | Stage | ID | Purpose | Output |
|---|-------|-----|---------|--------|
| 1 | **Idea** | `idea` | Logline, genre, tone, theme, characters, setting | `Idea` brief |
| 2 | **Story** | `story` | Beat sheet, structure, act breaks, character arcs | `Story` |
| 3 | **Script** | `script` | Full screenplay with scenes, dialogue, action | `Screenplay` |
| 4 | **Cast** | `characters` | Character bios, casting, visual references | `Character[]` |
| 5 | **World** | `world` | Locations, props, wardrobe, lore, art direction | `WorldBible`, `Location[]` |
| 6 | **Scenes** | `scenes` | Scene breakdown: sluglines, time, cast, logistics | `Scene[]` |
| 7 | **Board** | `storyboard` | Storyboard frames per shot, composition notes | `Shot[]` (board) |
| 8 | **Shots** | `shots` | Shot list: camera, lens, movement, duration, VFX tags | `Shot[]` (technical) |
| 9 | **Video** | `video` | Generate/previz every shot (image→video or text→video) | `Asset[]` (video) |
| 10 | **Voice** | `voice` | TTS or recorded dialogue per line, emotion control | `VoiceLine[]`, `Asset[]` (audio) |
| 11 | **Sound** | `sound` | SFX, ambience, score cues, mixing plan | `SoundCue[]`, `Asset[]` (audio) |
| 12 | **AI Edit** | `aiedit` | Assemble rough cut from generated assets + script | `Timeline` (rough) |
| 13 | **Editor** | `editor` | Full NLE: trim, ripple, transitions, effects, grade | `Timeline` (final) |
| 14 | **Color** | `color` | Primary grade, curves, wheels, LUTs, split toning | `Timeline.grade` |
| 15 | **Export** | `export` | Render master, stems, proxies, deliverables | `ExportJob[]` |

---

## State Machine

Each stage has a `stageState` persisted on the project:

```
empty → generating → ready → approved → (locked)
              ↓
            error
```

- **empty** — Nothing generated yet
- **generating** — AI job in progress
- **ready** — Output exists, awaiting review
- **approved** — Human signed off; stage locks (can still revisit)
- **error** — Generation failed; retry available

---

## Data Flow

```
Idea → Story → Script → Cast/World (parallel)
  ↓
Scenes → Board → Shots → Video/Voice/Sound (parallel)
  ↓
AI Edit → Editor → Color → Export
```

- **Parallel branches**: Cast + World, then Video + Voice + Sound can run concurrently
- **Artifacts flow forward**: Each stage's output becomes the next stage's input
- **Versioned**: Every `generate` creates a project version; `restore` rolls back all downstream stages

---

## Stage Details

### 1. Idea (`idea`)
- Free-form brief: logline, genre, tone, theme, setting, conflict, characters, visual style, time period, audience, duration, ending, pacing
- **Generate**: AI expands into structured concept
- **Approve**: Lock the creative foundation

### 2. Story (`story`)
- Beat sheet (Save the Cat / 3-act / 5-act / custom)
- Character arcs mapped to beats
- **Generate**: AI proposes beats from Idea
- **Approve**: Structure is fixed

### 3. Script (`script`)
- Full screenplay: scenes, sluglines, action, dialogue, parentheticals
- **Generate**: AI writes from Story + Cast + World
- **Approve**: Dialogue and action locked

### 4. Cast (`characters`)
- Name, role, age, archetype, backstory, visual description, reference images
- **Generate**: AI designs cast from Script + World
- **Approve**: Characters fixed for consistency

### 5. World (`world`)
- Locations (INT/EXT, time of day, description, refs)
- Props, wardrobe, vehicles, creatures, tech
- Lore bible: rules, history, factions, magic/tech systems
- **Generate**: AI builds world from Script + Cast
- **Approve**: World rules locked

### 6. Scenes (`scenes`)
- Scene breakdown from Script: number, slugline, location, cast, time, duration estimate, VFX flag, complexity
- **Generate**: AI breaks down Script
- **Approve**: Scene list fixed for scheduling

### 7. Board (`storyboard`)
- One frame per shot: composition, camera angle, character blocking, mood
- **Generate**: AI storyboards from Scenes + Cast + World
- **Approve**: Visual plan locked

### 8. Shots (`shots`)
- Technical shot list: camera, lens, focal length, movement, duration, frame rate, VFX tags, plate requirements
- **Generate**: AI technical breakdown from Board
- **Approve**: Shoot plan locked

### 9. Video (`video`)
- Generate/previz every shot:
  - Image-to-video (start/end frame)
  - Text-to-video (prompt from Shot)
  - ComfyUI workflows for control
- Assets land in project library automatically
- **Approve**: Shot media approved

### 10. Voice (`voice`)
- TTS per dialogue line: speaker, emotion, pace, voice model
- Scratch takes (demo engine) → Final takes (ElevenLabs, OpenAI, custom)
- Lip-sync metadata for later
- **Approve**: Dialogue audio locked

### 11. Sound (`sound`)
- SFX cues: type, trigger, layer, spatial position
- Ambience beds per location
- Score cues: mood, tempo, stem assignments
- **Generate**: AI builds cue sheet from Scenes
- **Approve**: Sound plan locked

### 12. AI Edit (`aiedit`)
- Assemble rough cut:
  - Script-matched editing (dialogue-driven)
  - Pacing from Story beats
  - Music/VFX placeholders
- Output: Timeline with clips on tracks
- **Approve**: Rough cut structure locked

### 13. Editor (`editor`)
- **Full non-linear editor** (four-pane: Media / Preview+Inspector / Timeline)
- Drag-drop, trim, ripple, split, razor, snap
- Transitions, effects stack, keyframes
- Adjustment layers, text, solids, shapes
- Multi-track audio mixing
- **Real-time canvas preview** (WebGL grade pipeline)
- AudioContext-clocked playback (sample-accurate sync)

### 14. Color (`color`)
- Primary grade: exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, vibrance, sharpness, fade, vignette, grain
- Color wheels: lift/gamma/gain with luminance
- Curves: RGB + per-channel
- LUT support (.cube import)
- Split toning: shadows/highlights + balance
- Target: timeline (global) or clip (local)
- **Shared renderer** with Preview/Export

### 15. Export (`export`)
- Render queue with presets:
  - Master (ProRes 4444 / DNxHR HQX)
  - Mezzanine (ProRes 422 HQ)
  - Delivery (H.264/H.265, various bitrates)
  - Stems: video, dialogue, effects, music, ambience
  - Proxies: 720p/1080p for review
- In-browser render (WebCodecs) or cloud (ffmpeg)
- Watermarking, burn-ins, slate

---

## Navigation

- **Linear**: `Next` / `Previous` buttons (workflow order)
- **Jump**: Stage selector in header (any stage, any time)
- **URL**: `/project/:id?stage=editor` — deep-linkable, shareable
- **Persisted**: `stageStates` saved per project; reload restores position

---

## Key Principles

1. **One project, one source of truth** — All stages read/write the same project document
2. **Generate → Review → Approve** — Human-in-the-loop at every step
3. **Never lose work** — Version snapshots before each generate; restore rolls back downstream
4. **Parallel where possible** — Cast/World, Video/Voice/Sound run concurrently
5. **Real media, not placeholders** — Every generation produces real assets (video, audio, images) in the library
6. **Editor is the hub** — Stage 13 is a professional NLE; stages 1-12 feed it, stages 14-15 polish its output